import mongoose from "mongoose";
import { Tournament } from "../models/tournament.model.js";
import { Team } from "../models/team.model.js";
import { EliminationNotification } from "../models/eliminationNotification.model.js";
import { TeamLog } from "../models/teamLog.model.js";
import { MatchRoster } from "../models/matchRoster.model.js";
import { MatchVerification } from "../models/matchVerification.model.js";
import { PlayerAlias } from "../models/playerAlias.model.js";
import { Settings } from "../models/settings.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getScoringConfig, recomputeTeamScores } from "../utils/scoring.helper.js";
import { invalidateDefaultTournamentCache } from "../middlewares/resolveTournament.middleware.js";

const requireObjectId = (id, label = "tournamentId") => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, `Invalid ${label}`);
  }
};

const toPlainPositionPoints = (raw) => {
  if (!raw) return {};
  if (raw instanceof Map) return Object.fromEntries(raw.entries());
  if (typeof raw.toObject === "function") return raw.toObject();
  if (typeof raw === "object") return { ...raw };
  return {};
};

const summarizeScoring = (scoring) => {
  if (!scoring) return undefined;
  return {
    positionPoints: toPlainPositionPoints(scoring.positionPoints),
    killPointMultiplier: scoring.killPointMultiplier ?? 1,
    fullEliminationCount: scoring.fullEliminationCount ?? 4,
  };
};

const summarize = (tournament, teamCount = 0) => ({
  _id: tournament._id,
  name: tournament.name,
  season: tournament.season || "",
  status: tournament.status,
  isDefault: Boolean(tournament.isDefault),
  isArchived: Boolean(tournament.isArchived),
  teamCount,
  scoring: summarizeScoring(tournament.scoring),
  meta: tournament.meta || {},
  createdAt: tournament.createdAt,
  updatedAt: tournament.updatedAt,
});

// GET /api/v1/tournaments
export const listTournaments = asyncHandler(async (_req, res) => {
  const [tournaments, counts] = await Promise.all([
    Tournament.find({}).sort({ createdAt: 1 }).lean(),
    Team.aggregate([{ $group: { _id: "$tournamentId", count: { $sum: 1 } } }]),
  ]);

  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  const items = tournaments.map((t) =>
    summarize(t, countMap.get(String(t._id)) || 0)
  );

  return res
    .status(200)
    .json(new ApiResponse(200, items, "Tournaments retrieved successfully"));
});

// GET /api/v1/tournaments/:tournamentId
export const getTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  const teamCount = await Team.countDocuments({ tournamentId });
  return res
    .status(200)
    .json(new ApiResponse(200, summarize(tournament, teamCount), "Tournament retrieved"));
});

// POST /api/v1/tournaments
export const createTournament = asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const season = String(req.body?.season || "").trim();
  const cloneFrom = req.body?.cloneFrom;
  const includeTeams = Boolean(req.body?.includeTeams);

  if (!name) throw new ApiError(400, "Tournament name is required");

  let design;
  let scoring;
  let source = null;

  if (cloneFrom) {
    requireObjectId(cloneFrom, "cloneFrom");
    source = await Tournament.findById(cloneFrom);
    if (!source) throw new ApiError(404, "Source tournament not found");
    design = source.design.toObject();
    scoring = source.scoring.toObject();
  }

  const existingCount = await Tournament.countDocuments({});
  const shouldBeDefault = existingCount === 0;

  const tournament = await Tournament.create({
    name,
    season,
    status: "active",
    isDefault: shouldBeDefault,
    ...(design ? { design } : {}),
    ...(scoring ? { scoring } : {}),
  });

  if (shouldBeDefault) {
    await Settings.findOneAndUpdate(
      { key: "app" },
      { $set: { defaultTournamentId: tournament._id } },
      { upsert: true }
    );
    invalidateDefaultTournamentCache();
  }

  if (includeTeams && source) {
    const sourceTeams = await Team.find({ tournamentId: source._id });
    if (sourceTeams.length) {
      const clones = sourceTeams.map((team) => ({
        tournamentId: tournament._id,
        name: team.name,
        logo: team.logo,
        slot: team.slot,
        currentRound: team.currentRound,
        isEliminated: team.isEliminated,
        totalPoints: team.totalPoints,
        rounds: team.rounds.map((r) => r.toObject()),
      }));
      await Team.insertMany(clones);
    }
  }

  req.app.io?.emit("tournament_created", summarize(tournament, 0));

  return res
    .status(201)
    .json(new ApiResponse(201, summarize(tournament, 0), "Tournament created successfully"));
});

// PUT /api/v1/tournaments/:tournamentId
export const updateTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  const { name, season, status, meta, isArchived, scoring } = req.body || {};

  if (name !== undefined) {
    const nextName = String(name).trim();
    if (!nextName) throw new ApiError(400, "Name cannot be empty");
    tournament.name = nextName;
  }
  if (season !== undefined) tournament.season = String(season).trim();
  if (status !== undefined) {
    const allowed = ["draft", "active", "completed", "archived"];
    if (!allowed.includes(status)) throw new ApiError(400, "Invalid status");
    tournament.status = status;
    tournament.isArchived = status === "archived";
  }
  if (isArchived !== undefined) {
    tournament.isArchived = Boolean(isArchived);
    if (tournament.isArchived) tournament.status = "archived";
  }
  if (meta && typeof meta === "object") {
    if (meta.location !== undefined) tournament.meta.location = String(meta.location);
    if (meta.notes !== undefined) tournament.meta.notes = String(meta.notes);
    if (meta.startDate !== undefined) {
      tournament.meta.startDate = meta.startDate ? new Date(meta.startDate) : null;
    }
    if (meta.endDate !== undefined) {
      tournament.meta.endDate = meta.endDate ? new Date(meta.endDate) : null;
    }
  }

  if (scoring && typeof scoring === "object") {
    if (scoring.positionPoints && typeof scoring.positionPoints === "object") {
      const next = new Map();
      for (const [key, value] of Object.entries(scoring.positionPoints)) {
        const position = Number(key);
        const points = Number(value);
        if (!Number.isFinite(position) || position < 1) continue;
        if (!Number.isFinite(points) || points < 0) {
          throw new ApiError(400, `Invalid points for position ${key}`);
        }
        next.set(String(position), points);
      }
      tournament.scoring.positionPoints = next;
    }
    if (scoring.killPointMultiplier !== undefined) {
      const multiplier = Number(scoring.killPointMultiplier);
      if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new ApiError(400, "killPointMultiplier must be a non-negative number");
      }
      tournament.scoring.killPointMultiplier = multiplier;
    }
    if (scoring.fullEliminationCount !== undefined) {
      const count = Number(scoring.fullEliminationCount);
      if (![1, 2, 3, 4].includes(count)) {
        throw new ApiError(400, "fullEliminationCount must be between 1 and 4");
      }
      tournament.scoring.fullEliminationCount = count;
    }
  }

  await tournament.save();
  invalidateDefaultTournamentCache();

  // Scoring rules changed: recalculate every team's totals so standings stay
  // consistent with the new rules.
  if (scoring && typeof scoring === "object") {
    const teams = await Team.find({ tournamentId });
    const config = getScoringConfig(tournament);
    for (const team of teams) {
      recomputeTeamScores(team, config);
      await team.save();
    }
  }

  const teamCount = await Team.countDocuments({ tournamentId });
  req.app.io?.emit("tournament_updated", summarize(tournament, teamCount));

  return res
    .status(200)
    .json(new ApiResponse(200, summarize(tournament, teamCount), "Tournament updated"));
});

// POST /api/v1/tournaments/:tournamentId/activate
export const activateTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  tournament.status = "active";
  tournament.isArchived = false;
  await tournament.save();

  const teamCount = await Team.countDocuments({ tournamentId });
  req.app.io?.emit("tournament_updated", summarize(tournament, teamCount));

  return res
    .status(200)
    .json(new ApiResponse(200, summarize(tournament, teamCount), "Tournament activated"));
});

// POST /api/v1/tournaments/:tournamentId/archive
export const archiveTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  tournament.status = "archived";
  tournament.isArchived = true;
  await tournament.save();
  invalidateDefaultTournamentCache();

  const teamCount = await Team.countDocuments({ tournamentId });
  req.app.io?.emit("tournament_updated", summarize(tournament, teamCount));

  return res
    .status(200)
    .json(new ApiResponse(200, summarize(tournament, teamCount), "Tournament archived"));
});

// POST /api/v1/tournaments/:tournamentId/clone
export const cloneTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const source = await Tournament.findById(tournamentId);
  if (!source) throw new ApiError(404, "Tournament not found");

  const name = String(req.body?.name || `${source.name} (Copy)`).trim();
  const season = String(req.body?.season ?? source.season ?? "").trim();
  const includeTeams = Boolean(req.body?.includeTeams);

  const tournament = await Tournament.create({
    name,
    season,
    status: "draft",
    isArchived: false,
    design: source.design.toObject(),
    scoring: source.scoring.toObject(),
    meta: source.meta ? source.meta.toObject() : {},
  });

  if (includeTeams) {
    const sourceTeams = await Team.find({ tournamentId: source._id });
    if (sourceTeams.length) {
      const clones = sourceTeams.map((team) => ({
        tournamentId: tournament._id,
        name: team.name,
        logo: team.logo,
        slot: team.slot,
        currentRound: team.currentRound,
        isEliminated: team.isEliminated,
        totalPoints: team.totalPoints,
        rounds: team.rounds.map((r) => r.toObject()),
      }));
      await Team.insertMany(clones);
    }
  }

  const teamCount = await Team.countDocuments({ tournamentId: tournament._id });
  req.app.io?.emit("tournament_created", summarize(tournament, teamCount));

  return res
    .status(201)
    .json(new ApiResponse(201, summarize(tournament, teamCount), "Tournament cloned"));
});

// POST /api/v1/tournaments/:tournamentId/set-default
export const setDefaultTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  await Tournament.updateMany({ _id: { $ne: tournament._id } }, { $set: { isDefault: false } });
  tournament.isDefault = true;
  await tournament.save();

  await Settings.findOneAndUpdate(
    { key: "app" },
    { $set: { defaultTournamentId: tournament._id } },
    { upsert: true }
  );
  invalidateDefaultTournamentCache();

  const teamCount = await Team.countDocuments({ tournamentId });
  req.app.io?.emit("tournament_updated", summarize(tournament, teamCount));

  return res
    .status(200)
    .json(new ApiResponse(200, summarize(tournament, teamCount), "Default tournament updated"));
});

// DELETE /api/v1/tournaments/:tournamentId
export const deleteTournament = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  requireObjectId(tournamentId);

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) throw new ApiError(404, "Tournament not found");

  if (tournament.isDefault) {
    throw new ApiError(400, "Cannot delete the default tournament");
  }

  const remaining = await Tournament.countDocuments({ _id: { $ne: tournament._id } });
  if (remaining === 0) {
    throw new ApiError(400, "Cannot delete the only tournament");
  }

  await Promise.all([
    Team.deleteMany({ tournamentId }),
    EliminationNotification.deleteMany({ tournamentId }),
    TeamLog.deleteMany({ tournamentId }),
    MatchRoster.deleteMany({ tournamentId }),
    MatchVerification.deleteMany({ tournamentId }),
    PlayerAlias.deleteMany({ tournamentId }),
  ]);
  await tournament.deleteOne();

  req.app.io?.emit("tournament_deleted", String(tournamentId));

  return res
    .status(200)
    .json(new ApiResponse(200, { deletedTournamentId: tournamentId }, "Tournament deleted"));
});
