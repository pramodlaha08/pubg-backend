import { Tournament } from "../models/tournament.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
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
  "panelFrom",
  "panelTo",
  "placeColor",
  "elimColor",
  "totalColor",
  "danger",
  "warning",
  "notificationFrom",
  "notificationTo",
];

const COLUMN_KEYS = ["logo", "alive", "pts", "elims"];
const NOTIFICATION_BOOLEANS = [
  "showLogo",
  "showKills",
  "showRank",
  "showRound",
];
const LEADERBOARD_BOOLEANS = [
  "showLogo",
  "showPlace",
  "showElims",
  "showTotal",
  "showChickens",
];
const MATCH_BOOLEANS = [
  "showLogo",
  "showRank",
  "showElims",
  "showPlace",
  "showTotal",
];

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const sanitizePointsTable = (input, base) => {
  const baseObj = base?.toObject ? base.toObject() : JSON.parse(JSON.stringify(base || {}));
  const next = JSON.parse(JSON.stringify(baseObj));
  next.colors ??= {};
  next.columns ??= {};
  next.header ??= {};
  next.layout ??= {};
  next.notifications ??= {};
  next.leaderboard ??= {};
  next.match ??= {};
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
    for (const key of COLUMN_KEYS) {
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

  if (source.notifications && typeof source.notifications === "object") {
    for (const key of NOTIFICATION_BOOLEANS) {
      if (typeof source.notifications[key] === "boolean") {
        next.notifications[key] = source.notifications[key];
      }
    }
    if (source.notifications.durationMs !== undefined) {
      next.notifications.durationMs = Math.round(
        clampNumber(
          source.notifications.durationMs,
          1000,
          15000,
          next.notifications.durationMs
        )
      );
    }
  }

  if (source.leaderboard && typeof source.leaderboard === "object") {
    for (const key of LEADERBOARD_BOOLEANS) {
      if (typeof source.leaderboard[key] === "boolean") {
        next.leaderboard[key] = source.leaderboard[key];
      }
    }
  }

  if (source.match && typeof source.match === "object") {
    for (const key of MATCH_BOOLEANS) {
      if (typeof source.match[key] === "boolean") {
        next.match[key] = source.match[key];
      }
    }
  }

  return next;
};

export const getSettings = asyncHandler(async (req, res) => {
  res.status(200).json(
    new ApiResponse(
      200,
      {
        key: "app",
        tournamentId: req.tournamentId,
        pointsTable: req.tournament.design,
      },
      "Settings fetched"
    )
  );
});

export const updateSettings = asyncHandler(async (req, res) => {
  const tournament = req.tournament;
  const current = await Tournament.findById(tournament._id);
  if (!current) {
    throw new ApiError(404, "Tournament not found");
  }

  current.design = sanitizePointsTable(req.body?.pointsTable, current.design);
  await current.save();

  const payload = {
    tournamentId: String(current._id),
    pointsTable: current.design,
  };

  req.app.io?.to(`t_${current._id}`).emit("settings_updated", payload);
  req.app.io?.emit("settings_updated", payload);

  res.status(200).json(
    new ApiResponse(
      200,
      { key: "app", tournamentId: current._id, pointsTable: current.design },
      "Settings updated"
    )
  );
});
