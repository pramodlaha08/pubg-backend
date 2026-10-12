import mongoose from "mongoose";
import { Tournament } from "../models/tournament.model.js";
import { Settings } from "../models/settings.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const DEFAULT_TTL_MS = 5000;
let defaultCache = { id: null, at: 0 };

const isHex24 = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const readRequestedId = (req) => {
  const header = req.get("x-tournament-id");
  if (header) return String(header).trim();
  if (req.query && req.query.tournamentId) return String(req.query.tournamentId).trim();
  if (req.body && req.body.tournamentId) return String(req.body.tournamentId).trim();
  return "";
};

// Resolve (and cache briefly) the tournament flagged as default, falling back
// to the oldest non-archived tournament, then the oldest tournament overall.
export const getDefaultTournamentId = async () => {
  const now = Date.now();
  if (defaultCache.id && now - defaultCache.at < DEFAULT_TTL_MS) {
    return defaultCache.id;
  }

  const settings = await Settings.findOne({ key: "app" }).lean();
  let id = settings?.defaultTournamentId || null;

  if (id) {
    const exists = await Tournament.exists({ _id: id });
    if (!exists) id = null;
  }

  if (!id) {
    const preferred =
      (await Tournament.findOne({ isDefault: true, isArchived: false })
        .sort({ createdAt: 1 })
        .select("_id")
        .lean()) ||
      (await Tournament.findOne({ isArchived: false })
        .sort({ createdAt: 1 })
        .select("_id")
        .lean()) ||
      (await Tournament.findOne({}).sort({ createdAt: 1 }).select("_id").lean());
    id = preferred?._id || null;
  }

  defaultCache = { id, at: now };
  return id;
};

export const invalidateDefaultTournamentCache = () => {
  defaultCache = { id: null, at: 0 };
};

const resolveTournament = asyncHandler(async (req, _res, next) => {
  const requested = readRequestedId(req);

  if (requested) {
    if (!isHex24(requested)) {
      throw new ApiError(400, "Invalid tournamentId");
    }
    if (!mongoose.isValidObjectId(requested)) {
      throw new ApiError(400, "Invalid tournamentId");
    }
    const tournament = await Tournament.findById(requested);
    if (!tournament) {
      throw new ApiError(404, "Tournament not found");
    }
    req.tournament = tournament;
    req.tournamentId = tournament._id;
    return next();
  }

  const defaultId = await getDefaultTournamentId();
  if (!defaultId) {
    throw new ApiError(404, "No tournament available");
  }

  const tournament = await Tournament.findById(defaultId);
  if (!tournament) {
    throw new ApiError(404, "Tournament not found");
  }
  req.tournament = tournament;
  req.tournamentId = tournament._id;
  return next();
});

export { resolveTournament };
