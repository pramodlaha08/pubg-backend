// Thin, lazily-initialised wrapper around tesseract.js with a small
// accuracy boost: the same image is OCR'd with a couple of page-segmentation
// modes and the pass that yields the most plausible text (plus the OCR
// engine's own confidence) wins. A single worker is reused across requests.
import os from "os";
import path from "path";
import { ApiError } from "./ApiError.js";

const OCR_LANG = process.env.OCR_LANG || "eng";
const CACHE_DIR =
  process.env.OCR_CACHE_PATH || path.join(os.tmpdir(), "pubg-ocr-cache");
const MULTIPASS = process.env.OCR_MULTIPASS !== "false";

let workerPromise = null;
let PSM = null;

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = (async () => {
      let mod;
      try {
        mod = await import("tesseract.js");
      } catch {
        throw new ApiError(
          503,
          "OCR engine is not available on the server. Install tesseract.js."
        );
      }
      PSM = mod.PSM || null;
      return mod.createWorker(OCR_LANG, 1, { cachePath: CACHE_DIR });
    })().catch((err) => {
      // Allow a later request to retry after a transient failure.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
};

// Cheap heuristic: count letter-bearing words and eliminations-like tokens.
// The pass that recovers the most real content wins.
export const scoreOCRText = (text) => {
  const tokens = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const words = tokens.filter((token) => /[a-z]{3,}/i.test(token)).length;
  const elim = tokens.filter((token) => /m[i1l]?n?[a-z]?tion|minions?/i.test(token))
    .length;
  return words + elim * 3;
};

// Run OCR on an image. `input` may be a Buffer, file path, or base64 string.
// Returns `{ text, confidence, psm }` (text is never null).
export const recognizeImage = async (input) => {
  if (!input) throw new ApiError(400, "No image provided for OCR");
  const worker = await getWorker();

  const modes =
    MULTIPASS && PSM
      ? [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT, PSM.SINGLE_COLUMN]
      : [null];

  try {
    let best = { text: "", confidence: 0, score: -1, psm: null };

    for (const mode of modes) {
      if (mode != null) {
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: String(mode),
            preserve_interword_spaces: "1",
          });
        } catch {
          // setParameters unsupported on this build; keep default mode.
        }
      }

      const { data } = await worker.recognize(input);
      const text = String(data?.text ?? "");
      const confidence = Number(data?.confidence) || 0;
      const score = scoreOCRText(text) + confidence / 1000;

      if (score > best.score) {
        best = { text, confidence, score, psm: mode };
      }
      // A strong first pass is good enough; skip the slower alternatives.
      if (scoreOCRText(text) >= 60) break;
    }

    return { text: best.text, confidence: best.confidence, psm: best.psm };
  } catch (error) {
    throw new ApiError(422, `OCR failed: ${error.message}`);
  }
};

export const terminateOcrWorker = async () => {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // Worker never finished initialising or already gone; ignore.
  }
  workerPromise = null;
};
