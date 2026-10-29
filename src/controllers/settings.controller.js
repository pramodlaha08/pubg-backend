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

const COLUMN_KEYS = ["logo", "alive", "place", "pts", "elims"];
const NOTIFICATION_BOOLEANS = [
  "showLogo",
  "showKills",
  "showRank",
  "showRound",
];
const LEADERBOARD_BOOLEANS = [
  "showTitle",
  "showLogo",
  "showPlace",
  "showElims",
  "showTotal",
  "showChickens",
];
const LEADERBOARD_TEXTS = ["title", "subtitle"];
const MATCH_BOOLEANS = [
  "showTitle",
  "showLogo",
  "showRank",
  "showElims",
  "showPlace",
  "showTotal",
];
const MATCH_TEXTS = ["title", "subtitle"];
const OVERLAY_TEMPLATES = [
  "classic",
  "lower-third",
  "card-stack",
  "big-board",
  "hairline",
];
const SURFACE_STYLES = [
  "solid",
  "gradient",
  "glass",
  "transparent",
  "none",
];
const VERTICAL_ANCHORS = ["top", "middle", "bottom"];
const HORIZONTAL_ANCHORS = ["left", "center", "right"];
const WATERMARK_CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const HEADER_LABEL_KEYS = ["rank", "team", "place", "elims", "total"];
const MAX_IMAGE_LENGTH = 3_000_000;
const IMAGE_RE = /^(https?:\/\/|data:image\/|\/)/i;

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const safeImage = (value, max = MAX_IMAGE_LENGTH) =>
  typeof value === "string" && IMAGE_RE.test(value.trim())
    ? value.trim().slice(0, max)
    : undefined;

const applyTypography = (next, source) => {
  if (!source || typeof source !== "object") return;
  if (typeof source.fontFamily === "string") {
    next.typography.fontFamily = source.fontFamily.slice(0, 120);
  }
  if (source.fontScale !== undefined) {
    next.typography.fontScale = clampNumber(
      source.fontScale,
      0.5,
      2,
      next.typography.fontScale
    );
  }
  if (typeof source.uppercase === "boolean") {
    next.typography.uppercase = source.uppercase;
  }
  if (source.letterSpacing !== undefined) {
    next.typography.letterSpacing = clampNumber(
      source.letterSpacing,
      -0.1,
      0.5,
      next.typography.letterSpacing
    );
  }
};

const applySurface = (next, source) => {
  if (!source || typeof source !== "object") return;
  if (SURFACE_STYLES.includes(source.style)) {
    next.surface.style = source.style;
  }
  if (source.opacity !== undefined) {
    next.surface.opacity = clampNumber(
      source.opacity,
      0,
      1,
      next.surface.opacity
    );
  }
  if (source.blur !== undefined) {
    next.surface.blur = Math.round(
      clampNumber(source.blur, 0, 40, next.surface.blur)
    );
  }
  if (source.radius !== undefined) {
    next.surface.radius = Math.round(
      clampNumber(source.radius, 0, 48, next.surface.radius)
    );
  }
  if (source.borderWidth !== undefined) {
    next.surface.borderWidth = Math.round(
      clampNumber(source.borderWidth, 0, 8, next.surface.borderWidth)
    );
  }
  for (const key of ["shadow", "scanline", "animate"]) {
    if (typeof source[key] === "boolean") next.surface[key] = source[key];
  }
  const bg = safeImage(source.backgroundImage);
  if (bg !== undefined) next.surface.backgroundImage = bg;
  if (source.backgroundImageOpacity !== undefined) {
    next.surface.backgroundImageOpacity = clampNumber(
      source.backgroundImageOpacity,
      0,
      1,
      next.surface.backgroundImageOpacity
    );
  }
  if (source.backgroundImageBlur !== undefined) {
    next.surface.backgroundImageBlur = Math.round(
      clampNumber(
        source.backgroundImageBlur,
        0,
        40,
        next.surface.backgroundImageBlur
      )
    );
  }
  if (typeof source.gradientFrom === "string" && HEX.test(source.gradientFrom)) {
    next.surface.gradientFrom = source.gradientFrom.trim();
  }
  if (typeof source.gradientTo === "string" && HEX.test(source.gradientTo)) {
    next.surface.gradientTo = source.gradientTo.trim();
  }
  if (source.gradientAngle !== undefined) {
    next.surface.gradientAngle = Math.round(
      clampNumber(source.gradientAngle, 0, 360, next.surface.gradientAngle)
    );
  }
};

const applyPosition = (target, source) => {
  if (!source || typeof source !== "object") return;
  if (VERTICAL_ANCHORS.includes(source.vertical)) {
    target.vertical = source.vertical;
  }
  if (HORIZONTAL_ANCHORS.includes(source.horizontal)) {
    target.horizontal = source.horizontal;
  }
  if (source.offsetX !== undefined) {
    target.offsetX = Math.round(clampNumber(source.offsetX, 0, 4000, target.offsetX));
  }
  if (source.offsetY !== undefined) {
    target.offsetY = Math.round(clampNumber(source.offsetY, 0, 4000, target.offsetY));
  }
};

const applyWatermark = (next, source) => {
  if (!source || typeof source !== "object") return;
  if (typeof source.enabled === "boolean") {
    next.watermark.enabled = source.enabled;
  }
  const image = safeImage(source.image);
  if (image !== undefined) next.watermark.image = image;
  if (WATERMARK_CORNERS.includes(source.corner)) {
    next.watermark.corner = source.corner;
  }
  if (source.size !== undefined) {
    next.watermark.size = Math.round(
      clampNumber(source.size, 16, 320, next.watermark.size)
    );
  }
  if (source.opacity !== undefined) {
    next.watermark.opacity = clampNumber(
      source.opacity,
      0,
      1,
      next.watermark.opacity
    );
  }
  if (source.offset !== undefined) {
    next.watermark.offset = Math.round(
      clampNumber(source.offset, 0, 400, next.watermark.offset)
    );
  }
};

const sanitizePointsTable = (input, base) => {
  const baseObj = base?.toObject ? base.toObject() : JSON.parse(JSON.stringify(base || {}));
  const next = JSON.parse(JSON.stringify(baseObj));
  next.colors ??= {};
  next.typography ??= {};
  next.surface ??= {};
  next.columns ??= {};
  next.header ??= {};
  next.layout ??= {};
  next.notifications ??= {};
  next.leaderboard ??= {};
  next.match ??= {};
  next.watermark ??= {};
  const source = input && typeof input === "object" ? input : {};

  if (typeof source.preset === "string") {
    next.preset = source.preset.slice(0, 40);
  }

  applyTypography(next, source.typography);
  applySurface(next, source.surface);
  applyWatermark(next, source.watermark);

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
    if (typeof source.header.subtitle === "string") {
      next.header.subtitle = source.header.subtitle.slice(0, 80);
    }
    if (typeof source.header.logoUrl === "string") {
      next.header.logoUrl = source.header.logoUrl.slice(0, 500);
    }
  }

  if (source.layout && typeof source.layout === "object") {
    if (OVERLAY_TEMPLATES.includes(source.layout.template)) {
      next.layout.template = source.layout.template;
    }
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
    if (source.layout.gap !== undefined) {
      next.layout.gap = Math.round(
        clampNumber(source.layout.gap, 0, 24, next.layout.gap)
      );
    }
  }

  if (source.notifications && typeof source.notifications === "object") {
    if (OVERLAY_TEMPLATES.includes(source.notifications.template)) {
      next.notifications.template = source.notifications.template;
    }
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
    applyPosition(next.notifications.position, source.notifications.position);
  }

  if (source.leaderboard && typeof source.leaderboard === "object") {
    if (OVERLAY_TEMPLATES.includes(source.leaderboard.template)) {
      next.leaderboard.template = source.leaderboard.template;
    }
    for (const key of LEADERBOARD_BOOLEANS) {
      if (typeof source.leaderboard[key] === "boolean") {
        next.leaderboard[key] = source.leaderboard[key];
      }
    }
    for (const key of LEADERBOARD_TEXTS) {
      if (typeof source.leaderboard[key] === "string") {
        next.leaderboard[key] = source.leaderboard[key].slice(0, 80);
      }
    }
    const banner = safeImage(source.leaderboard.bannerImage, 2_000_000);
    if (banner !== undefined) next.leaderboard.bannerImage = banner;
    if (source.leaderboard.logoSize !== undefined) {
      next.leaderboard.logoSize = Math.round(
        clampNumber(source.leaderboard.logoSize, 16, 96, next.leaderboard.logoSize)
      );
    }
    if (source.leaderboard.logoRounding !== undefined) {
      next.leaderboard.logoRounding = Math.round(
        clampNumber(
          source.leaderboard.logoRounding,
          0,
          48,
          next.leaderboard.logoRounding
        )
      );
    }
    if (typeof source.leaderboard.footerNote === "string") {
      next.leaderboard.footerNote = source.leaderboard.footerNote.slice(0, 80);
    }
    if (
      source.leaderboard.headerLabels &&
      typeof source.leaderboard.headerLabels === "object"
    ) {
      next.leaderboard.headerLabels ??= {};
      for (const key of HEADER_LABEL_KEYS) {
        const value = source.leaderboard.headerLabels[key];
        if (typeof value === "string") {
          next.leaderboard.headerLabels[key] = value.slice(0, 20);
        }
      }
    }
  }

  if (source.match && typeof source.match === "object") {
    if (OVERLAY_TEMPLATES.includes(source.match.template)) {
      next.match.template = source.match.template;
    }
    for (const key of MATCH_BOOLEANS) {
      if (typeof source.match[key] === "boolean") {
        next.match[key] = source.match[key];
      }
    }
    for (const key of MATCH_TEXTS) {
      if (typeof source.match[key] === "string") {
        next.match[key] = source.match[key].slice(0, 80);
      }
    }
    const banner = safeImage(source.match.bannerImage, 2_000_000);
    if (banner !== undefined) next.match.bannerImage = banner;
    if (typeof source.match.footerNote === "string") {
      next.match.footerNote = source.match.footerNote.slice(0, 80);
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
