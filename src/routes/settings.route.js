import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settings.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getSettings);
router.put("/", requireAdmin, updateSettings);

export default router;
