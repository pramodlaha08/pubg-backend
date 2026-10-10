import { Router } from "express";
import { login, me, changePassword } from "../controllers/auth.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.post("/login", login);
router.get("/me", requireAdmin, me);
router.post("/change-password", requireAdmin, changePassword);

export default router;
