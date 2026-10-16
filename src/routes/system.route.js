import { Router } from "express";
import multer from "multer";
import {
  getBranding,
  updateBranding,
  uploadImage,
} from "../controllers/system.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

const router = Router();

router.get("/branding", getBranding);
router.put(
  "/branding",
  requireAdmin,
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  updateBranding
);

router.post(
  "/upload-image",
  requireAdmin,
  upload.single("image"),
  uploadImage
);

export default router;
