import { Router } from "express";
import multer from "multer";
import {
  uploadLobby,
  saveRoster,
  getRoster,
  uploadResults,
  previewResults,
  applyResults,
  clearMatchData,
} from "../controllers/match.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

// Screenshots are processed from memory: no temp files are written to disk.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router();

router.get("/roster", getRoster);
router.post("/roster", requireAdmin, saveRoster);
router.post("/lobby", requireAdmin, uploadImage.array("images", 10), uploadLobby);
router.post("/results", requireAdmin, uploadImage.array("images", 10), uploadResults);
router.post("/preview", requireAdmin, previewResults);
router.post("/apply", requireAdmin, applyResults);
router.delete("/data", requireAdmin, clearMatchData);

export default router;
