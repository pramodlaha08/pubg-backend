// Optional free-AI vision extraction (hybrid with Tesseract OCR).
// Disabled by default. Set AI_VISION_PROVIDER to a comma-separated fallback
// chain (e.g. "groq,gemini,zai") to enable. Any failure returns null so the
// caller falls back to Tesseract.
import { ApiError } from "./ApiError.js";

// AI_VISION_PROVIDER may be a single provider or a comma-separated fallback
// chain, e.g. "groq,gemini". The first provider that has credentials and a
// working quota wins; otherwise the caller falls back to Tesseract OCR.
const PROVIDERS = String(process.env.AI_VISION_PROVIDER || "off")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter((name) => name && name !== "off" && name !== "none");
const MODEL = String(process.env.AI_VISION_MODEL || "").trim();
const TIMEOUT_MS = Number(process.env.AI_VISION_TIMEOUT_MS || 30000);

// OpenAI-compatible chat-completions vision endpoints. Adding any of these is
// just a matter of setting the API-key env var and listing the provider in
// AI_VISION_PROVIDER — every entry accepts the same body shape.
//   - groq, openrouter : already used
//   - zai (Zhipu GLM)  : glm-4.6v-flash is permanently free, no card
//   - mistral          : pixtral vision on the free tier
//   - nvidia           : build.nvidia.com hosts Llama 3.2 vision
//   - github           : GitHub Models (GPT-4o family) with a GitHub token
//   - cloudflare       : Workers AI Llama 3.2 vision (needs account id)
const OPENAI_COMPATIBLE = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    model: "qwen/qwen3.8-27b",
    extra: {
      reasoning_effort: process.env.GROQ_REASONING_EFFORT || "none",
      response_format: { type: "json_object" },
    },
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    model: "google/gemma-4-31b-it:free",
  },
  zai: {
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    keyEnv: "ZAI_API_KEY",
    model: "glm-4.6v-flash",
  },
  meta: {
    url: "https://api.llama.com/compat/v1/chat/completions",
    keyEnv: "META_API_KEY",
    model: "Llama-4-Scout-17B-16E-Instruct",
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    keyEnv: "MISTRAL_API_KEY",
    model: "pixtral-12b-2409",
  },
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    keyEnv: "NVIDIA_API_KEY",
    model: "meta/llama-3.2-11b-vision-instruct",
  },
  github: {
    url: "https://models.inference.ai.azure.com/chat/completions",
    keyEnv: "GITHUB_MODELS_TOKEN",
    model: "gpt-4o-mini",
  },
  cloudflare: {
    keyEnv: "CLOUDFLARE_API_TOKEN",
    accountEnv: "CLOUDFLARE_ACCOUNT_ID",
    model: "@cf/meta/llama-3.2-11b-vision-instruct",
    url: (accountId) =>
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
  },
};

// Providers with a bespoke (non-OpenAI) API.
const NATIVE_MODELS = {
  gemini: "gemini-3.8-flash",
  ollama: "llama3.2-vision",
};

const KEY_ENV = {
  gemini: "GEMINI_API_KEY",
  ...Object.fromEntries(
    Object.entries(OPENAI_COMPATIBLE).map(([name, cfg]) => [name, cfg.keyEnv])
  ),
};

// API keys may be a comma-separated list per provider so several free-tier
// accounts can be rotated before a daily quota forces a fallback.
const keysFor = (provider) => {
  if (provider === "ollama") return [null];
  const envName = KEY_ENV[provider];
  if (!envName) return [];
  return String(process.env[envName] || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
};

const describeKey = (key) =>
  key ? `${key.slice(0, 6)}…${key.slice(-4)}` : "local";

const modelFor = (provider) =>
  process.env[`AI_VISION_MODEL_${provider.toUpperCase()}`] ||
  (PROVIDERS.length === 1 ? MODEL : "") ||
  OPENAI_COMPATIBLE[provider]?.model ||
  NATIVE_MODELS[provider];

const providerReady = (provider) => {
  if (provider === "cloudflare") {
    return (
      keysFor(provider).length > 0 && Boolean(process.env.CLOUDFLARE_ACCOUNT_ID)
    );
  }
  return keysFor(provider).length > 0;
};

export const isAiVisionEnabled = () =>
  PROVIDERS.some((provider) => providerReady(provider));

export const buildVisionPrompt = (kind, context = {}) => {
  const { knownPlayers = [], knownTeams = [] } = context;

  if (kind === "results") {
    const lines = [
      `You are an esports data extractor. The image is a PUBG Mobile / BGMI post-match results / live scoreboard screen. It shows team blocks. Each block header has a team identifier (a colored slot/registration number and/or a TEAM NAME) and the team's final placement; inside are up to four player rows, each with a player name and that player's elimination count (e.g. "3 eliminations", "/0 Eliminations").`,
      `Return ONLY strict JSON, no markdown, no explanation, using this exact shape:`,
      `{"players":[["name",kills,rank,"teamName"]]}`,
      `Rules:`,
      `- Output ONE row for EVERY player in EVERY team block (all teammates, all blocks). Never collapse a team to a single player.`,
      `- name: the player name exactly as shown (keep any clan tags). Never output a team name as a player.`,
      `- kills: that player's eliminations (the number shown next to their name; use 0 when it shows "0 eliminations").`,
      `- rank: the team's FINAL PLACEMENT (1 = winner). If a placement number is shown next to the block, use it; otherwise the blocks are ordered by placement, so assign 1 to the first (top) block and increase in reading order. Every row of the same block shares the same rank.`,
      `- teamName: the TEAM NAME shown in that block's header, copied EXACTLY as written (keep clan tags). Repeat the same teamName on every row of that block. This is required — it is how rows are matched to teams.`,
      `- If a block shows only a team total (no per-player numbers), output ONE row using the team name as "name" and that total as kills.`,
      `- Never invent players or teams. Use null only for genuinely unreadable values.`,
      `- Output compact JSON only (no spaces or newlines needed).`,
    ];

    // Reference lists cost input tokens (counted against free-tier daily
    // quotas), so cap them — fuzzy name matching still covers the rest.
    const MAX_REF_TEAMS = 40;
    const MAX_REF_PLAYERS = 60;
    if (knownTeams.length || knownPlayers.length) {
      lines.push(
        `Reference lists — when a row clearly refers to one of these, output the name EXACTLY as written here:`
      );
      if (knownTeams.length)
        lines.push(`Teams: ${knownTeams.slice(0, MAX_REF_TEAMS).join(", ")}`);
      if (knownPlayers.length) {
        lines.push(
          `Players: ${knownPlayers
            .slice(0, MAX_REF_PLAYERS)
            .map((player) => `${player.name}${player.teamName ? ` (${player.teamName})` : ""}`)
            .join(", ")}`
        );
      }
    }

    return lines.join("\n");
  }

  return [
    `You are an esports data extractor. The image is a PUBG Mobile / BGMI live scoreboard or in-game lobby / player register screenshot. It shows team panels arranged in a grid of several columns; each panel has a LARGE, brightly-colored team slot number, a team name, and up to four player rows.`,
    `Return ONLY strict JSON, no markdown, no explanation, using this exact shape:`,
    `{"players":[["name",slot,"teamName"]]}`,
    `Rules:`,
    `- Each panel header shows a LARGE, COLORED team slot number (a big digit sitting on the team's colored bar or badge, e.g. 1-25), usually the biggest text in the panel. Read that number carefully — it is the team's slot. The exact same slot number repeats for every player of that team.`,
    `- Output ONE row for EVERY individual PLAYER you can read, including every teammate. Never collapse a team to a single player: if a team shows 4 players, emit 4 rows.`,
    `- First item is the player name exactly as shown (keep any clan tags). Do NOT output team names as rows and do NOT skip players that share a team.`,
    `- Second item is the NUMERIC team slot that player belongs to; every player of the same team repeats the same slot number. If the big colored slot digit is unreadable, use null but still fill teamName.`,
    `- Third item is the team name shown in that same panel header, copied EXACTLY as written (keep clan tags), repeated on every row of the team. Use null only if the team name is genuinely unreadable.`,
    `- If the screen shows a total team or player count, use it to make sure you did not miss any panel.`,
    `- Preserve the exact reading order (top-to-bottom down each column, then the next column).`,
    `- Never invent players. If a value is unreadable or not present, use null.`,
    `- Output compact JSON only (no spaces or newlines needed).`,
  ].join("\n");
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
      if (Array.isArray(player)) {
        if (kind === "results") {
          // Current shape: [name, kills, rank, teamName].
          // Legacy shapes: [name, slot, kills, rank] and [name, kills, rank].
          const fourthIsText = typeof player[3] === "string";
          if (player.length >= 4 && fourthIsText) {
            const [name, kills, rank, teamName] = player;
            return {
              name: String(name ?? "").replace(/\s+/g, " ").trim(),
              slot: null,
              kills: toIntOrNull(kills),
              rank: toIntOrNull(rank),
              teamName: teamName ? String(teamName).replace(/\s+/g, " ").trim() : null,
            };
          }
          if (player.length >= 4) {
            const [name, slot, kills, rank] = player;
            return {
              name: String(name ?? "").replace(/\s+/g, " ").trim(),
              slot: toIntOrNull(slot),
              kills: toIntOrNull(kills),
              rank: toIntOrNull(rank),
              teamName: null,
            };
          }
          const [name, kills, rank] = player;
          return {
            name: String(name ?? "").replace(/\s+/g, " ").trim(),
            slot: null,
            kills: toIntOrNull(kills),
            rank: toIntOrNull(rank),
            teamName: null,
          };
        }
        // Lobby shape: [name, slot] or [name, slot, teamName].
        const [name, slot, teamName] = player;
        return {
          name: String(name ?? "").replace(/\s+/g, " ").trim(),
          slot: toIntOrNull(slot),
          kills: null,
          rank: null,
          teamName: teamName ? String(teamName).replace(/\s+/g, " ").trim() : null,
        };
      }
      // Verbose object form (kept for backward compatibility).
      return {
        name: String(player?.name ?? "").replace(/\s+/g, " ").trim(),
        slot: toIntOrNull(player?.slot),
        kills: kind === "results" ? toIntOrNull(player?.kills) : null,
        rank: kind === "results" ? toIntOrNull(player?.rank) : null,
        teamName: player?.teamName ? String(player.teamName).replace(/\s+/g, " ").trim() : null,
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

const callGemini = async ({ base64, mimeType, prompt }, key) => {
  if (!key) throw new ApiError(500, "GEMINI_API_KEY is not set");
  const model = modelFor("gemini");
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
  const model = modelFor("ollama");
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

const callProvider = (provider, { base64, mimeType, prompt }, key) => {
  if (provider === "gemini") return callGemini({ base64, mimeType, prompt }, key);
  if (provider === "ollama") return callOllama({ base64, prompt });

  const cfg = OPENAI_COMPATIBLE[provider];
  if (!cfg) throw new ApiError(500, `Unknown AI vision provider: ${provider}`);
  const url =
    typeof cfg.url === "function" ? cfg.url(process.env[cfg.accountEnv]) : cfg.url;
  return callOpenAiCompatible(
    url,
    key,
    { base64, mimeType, prompt },
    modelFor(provider),
    cfg.extra || {}
  );
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

// Honor the provider's own hint ("try again in 2.6s") before moving on, but
// never wait longer than this inside a single request — long back-offs (e.g.
// daily quota exhaustion) are pointless to wait out here. A daily-quota error
// trips a short per-provider circuit-breaker so later uploads skip that
// provider and fall through to the next one (or OCR) instead of hanging again.
const MAX_RETRY_WAIT_MS = Number(process.env.AI_VISION_MAX_WAIT_MS || 8000);
const QUOTA_COOLDOWN_MS = Number(process.env.AI_VISION_COOLDOWN_MS || 300000);

const parseRetryAfterMs = (message) => {
  const match = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(message || "");
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  return Math.ceil((minutes * 60 + Number(match[2])) * 1000);
};

// Only a *daily* cap is worth a long cooldown; per-minute limits just retry.
const isDailyQuotaError = (message) =>
  /per day|tokens per day|\bTPD\b|per-day|PerDay|RequestsPerDay/i.test(message || "");

const retryDelayMs = (error, attempt) => {
  const hint = parseRetryAfterMs(error?.message || "");
  if (hint != null) return Math.min(hint + 1500, MAX_RETRY_WAIT_MS);
  return Math.min(8000 * (attempt + 1), MAX_RETRY_WAIT_MS);
};

const cooldownUntil = {};

const tryProvider = async ({ provider, base64, mimeType, prompt, kind, maxRetries }) => {
  const keys = keysFor(provider);
  if (!keys.length) return null;
  let allKeysExhausted = false;

  for (const key of keys) {
    let keyUsable = true;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const text = await callProvider(provider, { base64, mimeType, prompt }, key);
        const entries = parseAiPlayers(text, kind);
        if (!entries.length) return null;
        return { entries, raw: text, engine: `ai:${provider}` };
      } catch (error) {
        const message = error?.message || "";
        // 503 "high demand" is transient, so treat it like a rate limit.
        const retryable =
          error?.statusCode === 429 ||
          error?.statusCode === 503 ||
          /rate_limit|429|UNAVAILABLE|high demand/i.test(message);
        const authError = error?.statusCode === 401 || error?.statusCode === 403;

        if (isDailyQuotaError(message)) {
          // This key is spent for the day; move on to the next key.
          allKeysExhausted = true;
          keyUsable = false;
          console.error(
            `[aiVision] ${provider} key ${describeKey(key)} hit its daily quota; rotating`
          );
          break;
        }
        if (authError) {
          keyUsable = false;
          console.error(`[aiVision] ${provider} key ${describeKey(key)} rejected; rotating`);
          break;
        }
        if (retryable && attempt < maxRetries) {
          await sleep(retryDelayMs(error, attempt));
          continue;
        }
        console.error(`[aiVision] ${provider} extraction failed:`, message);
        return null;
      }
    }
    if (keyUsable) return null;
  }

  if (allKeysExhausted) {
    cooldownUntil[provider] = Date.now() + QUOTA_COOLDOWN_MS;
    console.error(
      `[aiVision] ${provider} out of daily quota on all keys; skipping it for ${Math.round(
        QUOTA_COOLDOWN_MS / 1000
      )}s`
    );
  }
  return null;
};

// Resize huge screenshots down before sending them to a vision model. Vision
// tokens scale with pixel count, so large images burn the free daily quota fast.
const MAX_AI_DIMENSION = Number(process.env.AI_VISION_MAX_DIMENSION || 1280);

const prepareImage = async (buffer, mimeType) => {
  if (MAX_AI_DIMENSION <= 0) return { base64: buffer.toString("base64"), mimeType };
  try {
    const { Jimp } = await import("jimp");
    const image = await Jimp.read(buffer);
    const longest = Math.max(image.width, image.height);
    if (longest <= MAX_AI_DIMENSION) {
      return { base64: buffer.toString("base64"), mimeType };
    }
    image.scale(MAX_AI_DIMENSION / longest);
    const resized = await image.getBuffer("image/png");
    return { base64: resized.toString("base64"), mimeType: "image/png" };
  } catch {
    return { base64: buffer.toString("base64"), mimeType };
  }
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
  const prepared = await prepareImage(buffer, mimeType);
  const prompt = buildVisionPrompt(kind, { knownPlayers, knownTeams });
  const maxRetries = Number(process.env.AI_VISION_RETRIES || 4);

  return pacedCall(async () => {
    for (const provider of PROVIDERS) {
      if (!providerReady(provider)) continue;
      if (Date.now() < (cooldownUntil[provider] || 0)) continue;
      const result = await tryProvider({
        provider,
        base64: prepared.base64,
        mimeType: prepared.mimeType,
        prompt,
        kind,
        maxRetries,
      });
      if (result) return result;
    }
    return null;
  });
};
