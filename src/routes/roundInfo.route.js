import { Router } from "express";
import {
  getRoundInfo,
  setRoundInfo,
} from "../controllers/roundInfo.controller.js";
import { requireScorer } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getRoundInfo);
router.put("/", requireScorer, setRoundInfo);

export default router;
