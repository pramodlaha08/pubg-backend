// Optional free-AI vision extraction (hybrid with Tesseract OCR).
// Disabled by default. Set AI_VISION_PROVIDER (ollama|gemini|groq|openrouter)
// to enable. Any failure returns null so the caller falls back to Tesseract.
import { ApiError } from "./ApiError.js";

const PROVIDER = String(process.env.AI_VISION_PROVIDER || "off")
  .trim()
  .toLowerCase();
const MODEL = String(process.env.AI_VISION_MODEL || "").trim();
const TIMEOUT_MS = Number(process.env.AI_VISION_TIMEOUT_MS || 30000);

const DEFAULT_MODELS = {
  gemini: "gemini-2.0-flash",
  groq: "qwen/qwen3.8-27b",
  openrouter: "meta-llama/llama-3.2-11b-vision-instruct:free",
  ollama: "llama3.2-vision",
};

export const isAiVisionEnabled = () =>
  PROVIDER !== "" && PROVIDER !== "off" && PROVIDER !== "none";

export const buildVisionPrompt = (kind, context = {}) => {
  const { knownPlayers = [], knownTeams = [] } = context;

  const target =
    kind === "results"
      ? `a "match results" / final standings screenshot listing teams OR individual players with their placement (rank) and eliminations (kills).`
      : `an in-game lobby / player register screenshot listing players with their team slot numbers and player names.`;

  const shape =
    kind === "results"
      ? `{"players":[["name",kills,rank]]}`
      : `{"players":[["name",slot]]}`;

  const lines = [
    `You are an esports data extractor. The image is ${target}`,
    `Return ONLY strict JSON, no markdown, no explanation, using this exact shape:`,
    shape,
    `Rules:`,
    `- Each inner array is one row, in the order shown top-to-bottom.`,
    `- First item is the name/team exactly as shown (keep any clan tags).`,
    `- ${kind === "results" ? `Second item is kills (eliminations), third is rank (placement).` : `Second item is the numeric team slot/position.`}`,
    `- Never invent players. If a value is unreadable or not present, use null.`,
    `- Do not merge two rows into one. Preserve every row you can read.`,
    `- Output compact JSON only (no spaces or newlines needed).`,
  ];

  if (kind === "results" && (knownTeams.length || knownPlayers.length)) {
    lines.push(
      `Reference lists — when a row clearly refers to one of these, output the name EXACTLY as written here:`
    );
    if (knownTeams.length) lines.push(`Teams: ${knownTeams.join(", ")}`);
    if (knownPlayers.length) {
      lines.push(
        `Players: ${knownPlayers
          .map((player) => `${player.name}${player.teamName ? ` (${player.teamName})` : ""}`)
          .join(", ")}`
      );
    }
  }

  return lines.join("\n");
};


const extractJson = (text) => {
  if (!text) return null;
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
};

const toIntOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
};

// Pure: validate/normalize a raw AI JSON payload into clean entry objects.
export const parseAiPlayers = (payload, kind = "lobby") => {
  const data = typeof payload === "string" ? extractJson(payload) : payload;
  const players = Array.isArray(data) ? data : data?.players;
  if (!Array.isArray(players)) return [];

  return players
    .map((player) => {
      // Compact tuple form: [name, slot] (lobby) or [name, kills, rank] (results).
      if (Array.isArray(player)) {
        const [name, first, second] = player;
        return {
          name: String(name ?? "").replace(/\s+/g, " ").trim(),
          slot: kind === "results" ? null : toIntOrNull(first),
          kills: kind === "results" ? toIntOrNull(first) : null,
          rank: kind === "results" ? toIntOrNull(second) : null,
        };
      }
      // Verbose object form (kept for backward compatibility).
      return {
        name: String(player?.name ?? "").replace(/\s+/g, " ").trim(),
        slot: toIntOrNull(player?.slot),
        kills: kind === "results" ? toIntOrNull(player?.kills) : null,
        rank: kind === "results" ? toIntOrNull(player?.rank) : null,
      };
    })
    .filter((player) => (player.name.match(/[a-z0-9]/gi) || []).length >= 2);
};

const withTimeout = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const callGemini = async ({ base64, mimeType, prompt }) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ApiError(500, "GEMINI_API_KEY is not set");
  const model = MODEL || DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await withTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new ApiError(res.status, `Gemini error: ${await res.text()}`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("");
};

const callOpenAiCompatible = async (
  url,
  apiKey,
  { base64, mimeType, prompt },
  model,
  extra = {}
) => {
  if (!apiKey) throw new ApiError(500, "API key is not set for this provider");
  const res = await withTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_completion_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      ...extra,
    }),
  });
  if (!res.ok) throw new ApiError(res.status, `Vision API error: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
};

const callOllama = async ({ base64, prompt }) => {
  const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const model = MODEL || DEFAULT_MODELS.ollama;
  const res = await withTimeout(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [{ role: "user", content: prompt, images: [base64] }],
    }),
  });
  if (!res.ok) throw new ApiError(res.status, `Ollama error: ${await res.text()}`);
  const data = await res.json();
  return data?.message?.content || "";
};

const callProvider = ({ base64, mimeType, prompt }) => {
  switch (PROVIDER) {
    case "gemini":
      return callGemini({ base64, mimeType, prompt });
    case "groq":
      return callOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        process.env.GROQ_API_KEY,
        { base64, mimeType, prompt },
        MODEL || DEFAULT_MODELS.groq,
        {
          reasoning_effort: process.env.GROQ_REASONING_EFFORT || "none",
          response_format: { type: "json_object" },
        }
      );
    case "openrouter":
      return callOpenAiCompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        process.env.OPENROUTER_API_KEY,
        { base64, mimeType, prompt },
        MODEL || DEFAULT_MODELS.openrouter
      );
    case "ollama":
      return callOllama({ base64, prompt });
    default:
      throw new ApiError(500, `Unknown AI vision provider: ${PROVIDER}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Free tiers (e.g. Groq) enforce output-tokens-per-minute. Serialize AI calls and
// keep them spaced apart so a batch of screenshots never bursts the quota.
const MIN_INTERVAL_MS = Number(process.env.AI_VISION_MIN_INTERVAL_MS || 20000);
let aiQueue = Promise.resolve();
let lastCallAt = 0;

const pacedCall = (fn) => {
  const run = aiQueue.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastCallAt = Date.now();
    }
  });
  aiQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

// Honor the provider's own hint ("try again in 2.6s") before falling back.
const retryDelayMs = (error, attempt) => {
  const match = /try again in ([\d.]+)s/i.exec(error?.message || "");
  if (match) return Math.ceil(Number(match[1]) * 1000) + 1500;
  return 8000 * (attempt + 1);
};

// Returns { entries, raw, engine } or null (caller falls back to Tesseract).
export const extractPlayersWithAI = async ({
  buffer,
  mimeType,
  kind = "lobby",
  knownPlayers = [],
  knownTeams = [],
}) => {
  if (!isAiVisionEnabled() || !buffer) return null;
  const base64 = buffer.toString("base64");
  const prompt = buildVisionPrompt(kind, { knownPlayers, knownTeams });
  const maxRetries = Number(process.env.AI_VISION_RETRIES || 4);

  return pacedCall(async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const text = await callProvider({ base64, mimeType, prompt });
        const entries = parseAiPlayers(text, kind);
        if (!entries.length) return null;
        return { entries, raw: text, engine: `ai:${PROVIDER}` };
      } catch (error) {
        const rateLimited =
          error?.statusCode === 429 || /rate_limit|429/i.test(error?.message || "");
        if (rateLimited && attempt < maxRetries) {
          await sleep(retryDelayMs(error, attempt));
          continue;
        }
        console.error(`[aiVision] ${PROVIDER} extraction failed:`, error?.message);
        return null;
      }
    }
    return null;
  });
};
