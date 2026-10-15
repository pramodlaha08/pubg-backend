import { Router } from "express";
import {
  getRoundInfo,
  setRoundInfo,
} from "../controllers/roundInfo.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getRoundInfo);
router.put("/", requireAdmin, setRoundInfo);

export default router;
