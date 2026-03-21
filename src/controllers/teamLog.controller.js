import { TeamLog } from "../models/teamLog.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

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

  const query = {};
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
  const query = {};

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

const getCommentarySnapshot = asyncHandler(async (_req, res) => {
  const SNAPSHOT_LIMIT = 100;

  const items = await TeamLog.find({})
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

  const query = {};
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

export {
  getTeamLogs,
  getLatestLogFeed,
  getCommentarySnapshot,
  resetTeamLogs,
  getLogById,
};
