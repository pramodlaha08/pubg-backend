import mongoose from "mongoose";
import { Tournament } from "../models/tournament.model.js";
import { Team } from "../models/team.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const trimmed = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : undefined;

const DEFAULT_LAYOUT = {
  pointsTable: { x: 3.5, y: 16, width: 0, scale: 100 },
  killFeed: { x: 80, y: 66, width: 0, scale: 100 },
  notification: { x: 4, y: 64, width: 24, scale: 100 },
  lowerThird: { x: 4, y: 80, width: 34, scale: 100 },
  countdown: { x: 42.5, y: 4, width: 0, scale: 100 },
  winner: { x: 22, y: 25, width: 56, scale: 100 },
};

const LAYOUT_KEYS = Object.keys(DEFAULT_LAYOUT);

const serializeLayout = (layout = {}) =>
  Object.fromEntries(
    LAYOUT_KEYS.map((key) => {
      const fallback = DEFAULT_LAYOUT[key];
      const entry = layout?.[key] || {};
      return [
        key,
        {
          x: clampNumber(entry.x, 0, 100, fallback.x),
          y: clampNumber(entry.y, 0, 100, fallback.y),
          width: clampNumber(entry.width, 0, 100, fallback.width),
          scale: clampNumber(entry.scale, 40, 200, fallback.scale),
        },
      ];
    })
  );

const remainingFor = (countdown, now) => {
  if (countdown?.running && countdown?.endsAt) {
    return Math.max(
      0,
      Math.ceil((new Date(countdown.endsAt).getTime() - now) / 1000)
    );
  }
  const stored = Number(countdown?.remainingSeconds);
  if (Number.isFinite(stored)) return Math.max(0, Math.round(stored));
  const duration = Number(countdown?.durationSeconds);
  return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 300;
};

export const serializeBroadcast = (tournament) => {
  const broadcast = tournament?.broadcast || {};
  const overlays = broadcast.overlays || {};
  const lowerThird = broadcast.lowerThird || {};
  const countdown = broadcast.countdown || {};
  const winner = broadcast.winner || {};
  const now = Date.now();

  const layout = serializeLayout(broadcast.layout);

  return {
    tournamentId: String(tournament?._id ?? ""),
    serverTime: new Date(now).toISOString(),
    overlays: {
      pointsTable: overlays.pointsTable !== false,
      leaderboard: overlays.leaderboard !== false,
      killFeed: overlays.killFeed !== false,
      notification: overlays.notification !== false,
    },
    lowerThird: {
      visible: Boolean(lowerThird.visible),
      title: lowerThird.title || "",
      subtitle: lowerThird.subtitle || "",
      eventLogoUrl: lowerThird.eventLogoUrl || "",
      sponsorLogos: Array.isArray(lowerThird.sponsorLogos)
        ? lowerThird.sponsorLogos.filter(Boolean).slice(0, 6)
        : [],
      mapName: lowerThird.mapName || "",
      mapImageUrl: lowerThird.mapImageUrl || "",
    },
    countdown: {
      visible: Boolean(countdown.visible),
      running: Boolean(countdown.running),
      title: countdown.title || "Starting in",
      durationSeconds: Number(countdown.durationSeconds ?? 300),
      remainingSeconds: remainingFor(countdown, now),
      endsAt:
        countdown.running && countdown.endsAt
          ? new Date(countdown.endsAt).toISOString()
          : null,
    },
    winner: {
      visible: Boolean(winner.visible),
      teamId: winner.teamId ? String(winner.teamId) : null,
      title: winner.title || "CHAMPIONS",
      subtitle: winner.subtitle || "",
      auto: Boolean(winner.auto),
      backgroundImageUrl: winner.backgroundImageUrl || "",
      playerImageUrl: winner.playerImageUrl || "",
      playerName: winner.playerName || "",
      teamLogoUrl: winner.teamLogoUrl || "",
    },
    layout,
  };
};

export const getBroadcast = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        serializeBroadcast(req.tournament),
        "Broadcast state fetched"
      )
    );
});

export const updateBroadcast = asyncHandler(async (req, res) => {
  const tournament = await Tournament.findById(req.tournamentId);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }

  const body = req.body || {};
  if (!tournament.broadcast) tournament.broadcast = {};
  const broadcast = tournament.broadcast;
  if (!broadcast.overlays) broadcast.overlays = {};
  if (!broadcast.lowerThird) broadcast.lowerThird = {};
  if (!broadcast.countdown) broadcast.countdown = {};
  if (!broadcast.winner) broadcast.winner = {};
  if (!broadcast.layout) broadcast.layout = {};

  if (body.overlays && typeof body.overlays === "object") {
    for (const key of [
      "pointsTable",
      "leaderboard",
      "killFeed",
      "notification",
    ]) {
      if (typeof body.overlays[key] === "boolean") {
        broadcast.overlays[key] = body.overlays[key];
      }
    }
  }

  if (body.lowerThird && typeof body.lowerThird === "object") {
    const source = body.lowerThird;
    if (typeof source.visible === "boolean") {
      broadcast.lowerThird.visible = source.visible;
    }
    const title = trimmed(source.title, 80);
    if (title !== undefined) broadcast.lowerThird.title = title;
    const subtitle = trimmed(source.subtitle, 120);
    if (subtitle !== undefined) broadcast.lowerThird.subtitle = subtitle;
    const eventLogoUrl = trimmed(source.eventLogoUrl, 1000);
    if (eventLogoUrl !== undefined) {
      broadcast.lowerThird.eventLogoUrl = eventLogoUrl;
    }
    const mapName = trimmed(source.mapName, 60);
    if (mapName !== undefined) broadcast.lowerThird.mapName = mapName;
    const mapImageUrl = trimmed(source.mapImageUrl, 1000);
    if (mapImageUrl !== undefined) {
      broadcast.lowerThird.mapImageUrl = mapImageUrl;
    }
    if (Array.isArray(source.sponsorLogos)) {
      broadcast.lowerThird.sponsorLogos = source.sponsorLogos
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().slice(0, 1000))
        .filter(Boolean)
        .slice(0, 6);
    }
    if (broadcast.lowerThird.visible && !broadcast.lowerThird.title) {
      throw new ApiError(400, "Lower third needs a title before showing");
    }
  }

  if (body.winner && typeof body.winner === "object") {
    const source = body.winner;
    // Any manual winner edit takes ownership away from the auto-winner.
    broadcast.winner.auto = false;
    if (typeof source.visible === "boolean") {
      broadcast.winner.visible = source.visible;
    }
    const title = trimmed(source.title, 60);
    if (title !== undefined) broadcast.winner.title = title;
    const subtitle = trimmed(source.subtitle, 100);
    if (subtitle !== undefined) broadcast.winner.subtitle = subtitle;
    const backgroundImageUrl = trimmed(source.backgroundImageUrl, 1000);
    if (backgroundImageUrl !== undefined) {
      broadcast.winner.backgroundImageUrl = backgroundImageUrl;
    }
    const playerImageUrl = trimmed(source.playerImageUrl, 1000);
    if (playerImageUrl !== undefined) {
      broadcast.winner.playerImageUrl = playerImageUrl;
    }
    const playerName = trimmed(source.playerName, 60);
    if (playerName !== undefined) broadcast.winner.playerName = playerName;
    const teamLogoUrl = trimmed(source.teamLogoUrl, 1000);
    if (teamLogoUrl !== undefined) {
      broadcast.winner.teamLogoUrl = teamLogoUrl;
    }
    if (source.teamId !== undefined) {
      if (source.teamId === null || source.teamId === "") {
        broadcast.winner.teamId = null;
      } else if (!mongoose.isValidObjectId(source.teamId)) {
        throw new ApiError(400, "Invalid winning team");
      } else {
        const team = await Team.findOne({
          _id: source.teamId,
          tournamentId: tournament._id,
        })
          .select("_id")
          .lean();
        if (!team) {
          throw new ApiError(404, "Winning team not found");
        }
        broadcast.winner.teamId = team._id;
      }
    }
    if (broadcast.winner.visible && !broadcast.winner.teamId) {
      throw new ApiError(400, "Pick the winning team before showing");
    }
  }

  if (body.layout && typeof body.layout === "object") {
    for (const key of LAYOUT_KEYS) {
      const source = body.layout[key];
      if (!source || typeof source !== "object") continue;

      const current = serializeLayout({
        [key]: broadcast.layout?.[key],
      })[key];

      const next = { ...current };
      for (const field of ["x", "y", "width", "scale"]) {
        if (source[field] === undefined) continue;
        const [min, max] =
          field === "scale" ? [40, 200] : [0, 100];
        const value = clampNumber(source[field], min, max, current[field]);
        next[field] = Math.round(value * 100) / 100;
      }
      broadcast.layout[key] = next;
    }
  }

  if (body.countdown && typeof body.countdown === "object") {
    const source = body.countdown;
    const title = trimmed(source.title, 60);
    if (title !== undefined) broadcast.countdown.title = title;

    if (source.durationSeconds !== undefined) {
      const duration = Math.round(
        clampNumber(
          source.durationSeconds,
          10,
          86400,
          broadcast.countdown.durationSeconds
        )
      );
      broadcast.countdown.durationSeconds = duration;
      if (!broadcast.countdown.running) {
        broadcast.countdown.remainingSeconds = duration;
      }
    }

    const now = Date.now();
    switch (source.action) {
      case "start": {
        const remaining = remainingFor(broadcast.countdown, now);
        const seconds =
          remaining > 0 ? remaining : broadcast.countdown.durationSeconds;
        broadcast.countdown.remainingSeconds = seconds;
        broadcast.countdown.endsAt = new Date(now + seconds * 1000);
        broadcast.countdown.running = true;
        broadcast.countdown.visible = true;
        break;
      }
      case "pause": {
        broadcast.countdown.remainingSeconds = remainingFor(
          broadcast.countdown,
          now
        );
        broadcast.countdown.running = false;
        broadcast.countdown.endsAt = null;
        break;
      }
      case "reset": {
        broadcast.countdown.remainingSeconds =
          broadcast.countdown.durationSeconds;
        broadcast.countdown.running = false;
        broadcast.countdown.endsAt = null;
        break;
      }
      case "show": {
        broadcast.countdown.visible = true;
        if (remainingFor(broadcast.countdown, now) <= 0) {
          broadcast.countdown.remainingSeconds =
            broadcast.countdown.durationSeconds;
        }
        break;
      }
      case "hide": {
        broadcast.countdown.visible = false;
        broadcast.countdown.running = false;
        broadcast.countdown.endsAt = null;
        break;
      }
      default:
        break;
    }
  }

  await tournament.save();

  const payload = serializeBroadcast(tournament);
  req.app.io?.to(`t_${tournament._id}`).emit("broadcast_updated", payload);
  req.app.io?.emit("broadcast_updated", payload);

  return res
    .status(200)
    .json(new ApiResponse(200, payload, "Broadcast updated"));
});
