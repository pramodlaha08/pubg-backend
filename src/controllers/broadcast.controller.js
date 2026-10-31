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

  return {
    tournamentId: String(tournament?._id ?? ""),
    serverTime: new Date(now).toISOString(),
    overlays: {
      pointsTable: overlays.pointsTable !== false,
      leaderboard: overlays.leaderboard !== false,
      killFeed: overlays.killFeed !== false,
    },
    lowerThird: {
      visible: Boolean(lowerThird.visible),
      title: lowerThird.title || "",
      subtitle: lowerThird.subtitle || "",
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
    },
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

  if (body.overlays && typeof body.overlays === "object") {
    for (const key of ["pointsTable", "leaderboard", "killFeed"]) {
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
    if (broadcast.lowerThird.visible && !broadcast.lowerThird.title) {
      throw new ApiError(400, "Lower third needs a title before showing");
    }
  }

  if (body.winner && typeof body.winner === "object") {
    const source = body.winner;
    if (typeof source.visible === "boolean") {
      broadcast.winner.visible = source.visible;
    }
    const title = trimmed(source.title, 60);
    if (title !== undefined) broadcast.winner.title = title;
    const subtitle = trimmed(source.subtitle, 100);
    if (subtitle !== undefined) broadcast.winner.subtitle = subtitle;
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
