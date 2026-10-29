import { Router } from "express";
import {
  getBroadcast,
  updateBroadcast,
} from "../controllers/broadcast.controller.js";
import { requireScorer } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getBroadcast);
router.patch("/", requireScorer, updateBroadcast);

export default router;
