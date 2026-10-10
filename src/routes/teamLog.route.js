import { Router } from "express";
import {
  getTeamLogs,
  getLatestLogFeed,
  getCommentarySnapshot,
  resetTeamLogs,
  getLogById,
} from "../controllers/teamLog.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getTeamLogs);
router.get("/feed", getLatestLogFeed);
router.get("/snapshot", getCommentarySnapshot);
router.get("/:logId", getLogById);
router.delete("/reset", requireAdmin, resetTeamLogs);

export default router;
