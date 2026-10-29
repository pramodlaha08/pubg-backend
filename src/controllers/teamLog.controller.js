import mongoose from "mongoose";
import { TeamLog } from "../models/teamLog.model.js";
import { Team } from "../models/team.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { createTeamLogEntry } from "../utils/teamLog.helper.js";
import {
  getScoringConfig,
  recomputeTeamScores,
} from "../utils/scoring.helper.js";

// Only scoring actions have a deterministic inverse. Team/round lifecycle
// events are intentionally excluded: undoing those would delete history.
const REVERTABLE_EVENT_TYPES = new Set([
  "KILL_ADDED",
  "KILL_UPDATED",
  "KILL_DECREASED",
  "POSITION_UPDATED",
  "ELIMINATION_UPDATED",
]);

const findChange = (changes, field) =>
  (changes || []).find((change) => change.field === field) || null;

const previousNumber = (change) => {
  if (!change) return null;
  if (typeof change.previous === "number") return change.previous;
  if (typeof change.current === "number" && typeof change.delta === "number") {
    return change.current - change.delta;
  }
  return null;
};

const getTeamLogs = asyncHandler(async (req, res) => {
  const {
    roundNumber,
    teamId,
    eventType,
    severity,
    page = 1,
    limit = 50,
  } = req.query;

  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.min(200, Math.max(1, Number(limit) || 50));

  const query = { tournamentId: req.tournamentId };
  if (roundNumber !== undefined) query.roundNumber = Number(roundNumber);
  if (teamId) query.teamId = teamId;
  if (eventType) query.eventType = eventType;
  if (severity) query.severity = severity;

  const [items, total] = await Promise.all([
    TeamLog.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber),
    TeamLog.countDocuments(query),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        items,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber),
        },
      },
      "Team logs retrieved successfully"
    )
  );
});

const getLatestLogFeed = asyncHandler(async (req, res) => {
  const { roundNumber, limit = 30 } = req.query;
  const query = { tournamentId: req.tournamentId };

  if (roundNumber !== undefined) {
    query.roundNumber = Number(roundNumber);
  }

  const items = await TeamLog.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 30)));

  return res
    .status(200)
    .json(
      new ApiResponse(200, items, "Latest team feed retrieved successfully")
    );
});

const getCommentarySnapshot = asyncHandler(async (req, res) => {
  const SNAPSHOT_LIMIT = 100;

  const items = await TeamLog.find({ tournamentId: req.tournamentId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(SNAPSHOT_LIMIT);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        items,
        total: items.length,
      },
      "Commentary snapshot retrieved successfully"
    )
  );
});

const resetTeamLogs = asyncHandler(async (req, res) => {
  const { roundNumber } = req.query;

  const query = { tournamentId: req.tournamentId };
  if (roundNumber !== undefined) {
    query.roundNumber = Number(roundNumber);
  }

  const deleted = await TeamLog.deleteMany(query);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { deletedCount: deleted.deletedCount || 0 },
        "Team logs reset successfully"
      )
    );
});

const getLogById = asyncHandler(async (req, res) => {
  const { logId } = req.params;

  const log = await TeamLog.findById(logId);
  if (!log) {
    throw new ApiError(404, "Log entry not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, log, "Team log retrieved successfully"));
});

// Undo a single scoring action, restoring the previous round state and
// recomputing the team totals from scratch. Refuses to revert when a newer
// change has landed on the same field so history cannot be corrupted.
const revertTeamLog = asyncHandler(async (req, res) => {
  const { logId } = req.params;

  if (!mongoose.isValidObjectId(logId)) {
    throw new ApiError(400, "Invalid log id");
  }

  const log = await TeamLog.findOne({
    _id: logId,
    tournamentId: req.tournamentId,
  });
  if (!log) {
    throw new ApiError(404, "Log entry not found");
  }
  if (log.revertedAt) {
    throw new ApiError(409, "This action has already been reverted");
  }
  if (!REVERTABLE_EVENT_TYPES.has(log.eventType)) {
    throw new ApiError(400, `${log.eventType} actions cannot be reverted`);
  }
  if (!log.teamId || log.roundNumber === null || log.roundNumber === undefined) {
    throw new ApiError(400, "This log entry has no team round to restore");
  }

  const team = await Team.findOne({
    _id: log.teamId,
    tournamentId: req.tournamentId,
  });
  if (!team) {
    throw new ApiError(404, "Team no longer exists");
  }

  const round = team.rounds.find(
    (item) => item.roundNumber === log.roundNumber
  );
  if (!round) {
    throw new ApiError(
      409,
      `Round ${log.roundNumber} is no longer available for this team`
    );
  }

  const scoring = getScoringConfig(req.tournament);

  if (log.eventType === "POSITION_UPDATED") {
    const change = findChange(log.changes, "round.position");
    const previous = previousNumber(change);
    if (previous === null) {
      throw new ApiError(400, "Log does not contain a previous position");
    }
    if (change && round.position !== change.current) {
      throw new ApiError(
        409,
        "Placement changed after this action; revert the newer change first"
      );
    }
    round.position = previous;
  } else if (log.eventType === "ELIMINATION_UPDATED") {
    const playerIndex = Number(log.meta?.playerIndex);
    if (!scoring.isValidPlayerIndex(playerIndex)) {
      throw new ApiError(400, "Log does not reference a valid player");
    }
    const changeType = log.meta?.changeType;
    const players = new Set((round.eliminatedPlayers || []).map(Number));
    if (changeType === "eliminated") {
      if (!players.has(playerIndex)) {
        throw new ApiError(
          409,
          "Player state changed after this action; revert the newer change first"
        );
      }
      players.delete(playerIndex);
    } else {
      if (players.has(playerIndex)) {
        throw new ApiError(
          409,
          "Player state changed after this action; revert the newer change first"
        );
      }
      players.add(playerIndex);
    }
    round.eliminatedPlayers = [...players].sort((a, b) => a - b);
    round.eliminationCount = Math.min(
      scoring.fullEliminationCount,
      round.eliminatedPlayers.length
    );
    round.status =
      round.eliminationCount >= scoring.fullEliminationCount
        ? "eliminated"
        : "alive";
    team.isEliminated = round.status === "eliminated";
  } else {
    const change = findChange(log.changes, "round.kills");
    const previous = previousNumber(change);
    if (previous === null) {
      throw new ApiError(400, "Log does not contain a previous kill count");
    }
    if (change && round.kills !== change.current) {
      throw new ApiError(
        409,
        "Kills changed after this action; revert the newer change first"
      );
    }
    round.kills = Math.max(0, previous);
  }

  recomputeTeamScores(team, scoring);
  await team.save();

  log.revertedAt = new Date();
  log.revertedBy = req.admin?._id ?? null;
  log.revertedByName = req.admin?.username ?? null;
  await log.save();

  const auditLog = await createTeamLogEntry({
    req,
    eventType: "LOG_REVERTED",
    severity: "critical",
    team,
    roundNumber: log.roundNumber,
    title: `Reverted: ${log.title}`,
    message: `Round ${log.roundNumber}: reversed "${log.eventType}" for ${team.name}. Team total is now ${team.totalPoints} pts.`,
    changes: [
      { field: "revert", previous: log.eventType, current: "reverted" },
    ],
    meta: {
      revertedLogId: log._id,
      originalEventType: log.eventType,
    },
  });

  const io = req.app?.io;
  if (io) {
    if (req.tournamentId) {
      io.to(`t_${req.tournamentId}`).emit("team_updated", team);
    }
    io.emit("team_updated", team);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { team, log, auditLog },
        "Action reverted successfully"
      )
    );
});

export {
  getTeamLogs,
  getLatestLogFeed,
  getCommentarySnapshot,
  resetTeamLogs,
  getLogById,
  revertTeamLog,
};
