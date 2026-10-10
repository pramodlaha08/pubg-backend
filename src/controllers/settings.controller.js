import { Settings } from "../models/settings.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_KEYS = [
  "headerFrom",
  "headerTo",
  "rankFrom",
  "rankTo",
  "teamFrom",
  "teamTo",
  "cellBg",
  "border",
  "borderSoft",
  "accent",
  "aliveBar",
  "deadBar",
  "textPrimary",
];

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const sanitizePointsTable = (input, current) => {
  const base = current.pointsTable.toObject();
  const next = JSON.parse(JSON.stringify(base));
  const source = input && typeof input === "object" ? input : {};

  if (typeof source.preset === "string") {
    next.preset = source.preset.slice(0, 40);
  }

  if (source.colors && typeof source.colors === "object") {
    for (const key of COLOR_KEYS) {
      const value = source.colors[key];
      if (typeof value === "string" && HEX.test(value.trim())) {
        next.colors[key] = value.trim();
      }
    }
  }

  if (source.columns && typeof source.columns === "object") {
    for (const key of ["alive", "pts", "elims"]) {
      if (typeof source.columns[key] === "boolean") {
        next.columns[key] = source.columns[key];
      }
    }
  }

  if (source.header && typeof source.header === "object") {
    if (typeof source.header.title === "string") {
      next.header.title = source.header.title.slice(0, 80);
    }
    if (typeof source.header.logoUrl === "string") {
      next.header.logoUrl = source.header.logoUrl.slice(0, 500);
    }
  }

  if (source.layout && typeof source.layout === "object") {
    next.layout.width = clampNumber(source.layout.width, 200, 640, next.layout.width);
    next.layout.rowHeight = clampNumber(
      source.layout.rowHeight,
      26,
      60,
      next.layout.rowHeight
    );
    next.layout.fontScale = clampNumber(
      source.layout.fontScale,
      0.7,
      1.6,
      next.layout.fontScale
    );
    if (typeof source.layout.showTrophy === "boolean") {
      next.layout.showTrophy = source.layout.showTrophy;
    }
  }

  return next;
};

export const getSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne({ key: "app" });
  if (!settings) {
    settings = await Settings.create({ key: "app" });
  }
  res.status(200).json(new ApiResponse(200, settings, "Settings fetched"));
});

export const updateSettings = asyncHandler(async (req, res) => {
  let settings = await Settings.findOne({ key: "app" });
  if (!settings) {
    settings = await Settings.create({ key: "app" });
  }

  settings.pointsTable = sanitizePointsTable(req.body?.pointsTable, settings);
  await settings.save();

  req.app.io?.emit("settings_updated", settings);

  res.status(200).json(new ApiResponse(200, settings, "Settings updated"));
});
