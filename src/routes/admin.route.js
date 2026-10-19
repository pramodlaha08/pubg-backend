import { Router } from "express";
import {
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminPassword,
  deleteAdmin,
} from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

// Managing accounts is restricted to the admin role.
router.use(requireAdmin);

router.get("/", listAdmins);
router.post("/", createAdmin);
router.patch("/:adminId", updateAdmin);
router.post("/:adminId/reset-password", resetAdminPassword);
router.delete("/:adminId", deleteAdmin);

export default router;
