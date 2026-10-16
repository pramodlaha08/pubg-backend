import { Settings } from "../models/settings.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  cloudinaryConfigured,
  uploadDataUriOnCloudinary,
} from "../utils/cloudinary.js";

const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
];

const getOrCreateSettings = () =>
  Settings.findOneAndUpdate(
    { key: "app" },
    { $setOnInsert: { key: "app" } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

const toBranding = (source) => ({
  systemName: source?.systemName?.trim() || "PMWC",
  logoUrl: source?.logoUrl || "",
  faviconUrl: source?.faviconUrl || "",
});

const resolveBrandingImage = async (file, folder) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw new ApiError(400, "Only PNG, JPEG, WEBP, SVG or ICO images are allowed");
  }
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  if (cloudinaryConfigured()) {
    try {
      return await uploadDataUriOnCloudinary(dataUri, folder);
    } catch {
      // Fall back to an inline data URL if Cloudinary is unreachable.
    }
  }
  return dataUri;
};

const isTrue = (value) => value === true || value === "true" || value === "1";

// POST /api/v1/system/upload-image  (admin, multipart: image, folder?)
export const uploadImage = asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) {
    throw new ApiError(400, "No image uploaded");
  }
  const folder =
    typeof req.body?.folder === "string" && req.body.folder.trim()
      ? `overlay/${req.body.folder.trim().replace(/[^a-z0-9/_-]/gi, "").slice(0, 40)}`
      : "overlay";
  const url = await resolveBrandingImage(file, folder);
  res.status(200).json(new ApiResponse(200, { url }, "Image uploaded"));
});

// GET /api/v1/system/branding  (public)
export const getBranding = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSettings();
  res
    .status(200)
    .json(new ApiResponse(200, toBranding(settings.branding), "Branding fetched"));
});

// PUT /api/v1/system/branding  (admin, multipart: systemName, logo, favicon)
export const updateBranding = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSettings();
  const branding = {
    ...(settings.branding?.toObject?.() ?? settings.branding ?? {}),
  };
  const body = req.body || {};

  if (typeof body.systemName === "string" && body.systemName.trim()) {
    branding.systemName = body.systemName.trim().slice(0, 60);
  }

  const logoFile = req.files?.logo?.[0];
  const faviconFile = req.files?.favicon?.[0];

  if (logoFile) {
    branding.logoUrl = await resolveBrandingImage(logoFile, "branding/logo");
  } else if (isTrue(body.clearLogo)) {
    branding.logoUrl = "";
  }

  if (faviconFile) {
    branding.faviconUrl = await resolveBrandingImage(
      faviconFile,
      "branding/favicon"
    );
  } else if (isTrue(body.clearFavicon)) {
    branding.faviconUrl = "";
  }

  settings.branding = branding;
  await settings.save();

  const payload = toBranding(branding);
  req.app.io?.emit("branding_updated", payload);

  res.status(200).json(new ApiResponse(200, payload, "Branding updated"));
});
