// Thin, lazily-initialised wrapper around tesseract.js with a small
// accuracy boost: the same image is OCR'd with a couple of page-segmentation
// modes and the pass that yields the most plausible text (plus the OCR
// engine's own confidence) wins. A single worker is reused across requests.
//
// Real PUBG/BGMI screenshots use small white-on-dark text, which Tesseract
// reads poorly. A jimp preprocessing pass (upscale + greyscale + contrast
// normalisation, and an inverted copy for light-on-dark HUDs) is applied
// first and the best-scoring variant is used.
import os from "os";
import path from "path";
import { ApiError } from "./ApiError.js";

const OCR_LANG = process.env.OCR_LANG || "eng";
const CACHE_DIR =
  process.env.OCR_CACHE_PATH || path.join(os.tmpdir(), "pubg-ocr-cache");
const MULTIPASS = process.env.OCR_MULTIPASS !== "false";
const OCR_SCALE = Number(process.env.OCR_SCALE || 2);
const OCR_MAX_WIDTH = Number(process.env.OCR_MAX_WIDTH || 2400);

let workerPromise = null;
let Jimp = null;
let PSM = null;

const loadJimp = async () => {
  if (Jimp !== null) return Jimp;
  try {
    ({ Jimp } = await import("jimp"));
  } catch {
    Jimp = false;
  }
  return Jimp;
};

// Build enhanced copies of the image for OCR. Falls back to the raw input if
// jimp is unavailable or the file cannot be decoded.
const buildOcrVariants = async (input) => {
  if (!Buffer.isBuffer(input)) return [input];
  const lib = await loadJimp();
  if (!lib) return [input];

  try {
    const image = await lib.read(input);
    const width = Number(image.width) || 0;
    const scale = width && width * OCR_SCALE <= OCR_MAX_WIDTH ? OCR_SCALE : 1;
    const enhance = (region) => {
      const copy = region.clone().greyscale().normalize();
      if (scale !== 1) copy.scale(scale);
      return copy;
    };

    const variants = [];
    const push = async (region) => {
      variants.push(await enhance(region).getBuffer("image/png"));
    };

    // Whole image first — it keeps the blocks in reading order.
    await push(image);

    // Scoreboards are laid out in columns and Tesseract's default page
    // segmentation merges them badly. Splitting into halves (and, when the
    // image is wide enough, thirds) makes each pass read one column at a time.
    const pieces = width >= 900 ? 2 : 1;
    const pieceWidth = Math.floor(width / pieces);
    for (let i = 0; i < pieces; i += 1) {
      await push(
        image.clone().crop({
          x: i * pieceWidth,
          y: 0,
          w: i === pieces - 1 ? width - i * pieceWidth : pieceWidth,
          h: Number(image.height) || 0,
        })
      );
    }

    // Light-on-dark HUD text reads better inverted.
    variants.push(await enhance(image).invert().getBuffer("image/png"));
    return variants;
  } catch {
    return [input];
  }
};

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
export const scoreOCRText = (text) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const words = tokens.filter((token) => /[a-z]{2,}/i.test(token)).length;
  const alnum = (s.match(/[a-z0-9]/gi) || []).length;
  const elim = tokens.filter((token) =>
    /m[i1l]?n?[a-z]?tion|minions?|eliminations?|kills?|placement|rank|slot|[0-9]+/i.test(token)
  ).length;
  const score = words * 2 + elim * 2 + alnum / 20;
  return score;
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

    for (const variant of await buildOcrVariants(input)) {
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

        const { data } = await worker.recognize(variant);
        const text = String(data?.text ?? "");
        const confidence = Number(data?.confidence) || 0;
        const score = scoreOCRText(text) + confidence / 1000;

        if (score > best.score) {
          best = { text, confidence, score, psm: mode };
        }
        // A strong first pass is good enough; skip the slower alternatives.
        if (scoreOCRText(text) >= 120) break;
      }
      if (best.score >= 120) break;
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
