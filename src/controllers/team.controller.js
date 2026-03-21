// Team Controller
import { Team } from "../models/team.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { createTeamLogEntry, logTemplates } from "../utils/teamLog.helper.js";
import mongoose from "mongoose";

// Position points mapping
const POSITION_POINTS = {
  1: 10,
  2: 8,
  3: 6,
  4: 5,
  5: 4,
  6: 3,
  7: 2,
  8: 1,
};
const KILL_POINT_MULTIPLIER = 1;

const safeCreateTeamLog = async (payload) => {
  try {
    await createTeamLogEntry(payload);
  } catch (error) {
    console.error("Failed to create team log:", error.message);
  }
};

// Create Team
const createTeam = asyncHandler(async (req, res) => {
  const { name, slot } = req.body;

  if (!name || !slot) {
    throw new ApiError(400, "Name and slot are required");
  }

  const existingSlot = await Team.findOne({ slot });
  if (existingSlot) {
    throw new ApiError(400, `Slot ${slot} already occupied`);
  }

  const logoLocalPath = req.file?.path;
  if (!logoLocalPath) throw new ApiError(400, "Logo is required");
  const logo = await uploadOnCloudinary(logoLocalPath);

  const team = await Team.create({
    name,
    slot,
    logo: logo.url,
    rounds: [],
    currentRound: 0,
    isEliminated: false,
    totalPoints: 0,
  });

  const template = logTemplates.teamCreated({ team });
  await safeCreateTeamLog({
    req,
    eventType: "TEAM_CREATED",
    severity: "highlight",
    team,
    title: template.title,
    message: template.message,
    changes: [
      { field: "name", previous: null, current: team.name },
      { field: "slot", previous: null, current: team.slot },
      {
        field: "totalPoints",
        previous: null,
        current: team.totalPoints,
        delta: 0,
      },
    ],
  });

  req.app.io.emit("team_created", team);

  return res
    .status(201)
    .json(new ApiResponse(201, team, "Team created successfully"));
});

// Create New Round
const createRound = asyncHandler(async (req, res) => {
  const { slots, roundNumber } = req.body;

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array");
  }
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "Round number must be a positive integer");
  }

  const teams = await Team.find({ slot: { $in: slots } });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  await Promise.all(
    teams.map(async (team) => {
      if (team.rounds.some((r) => r.roundNumber === roundNumber)) {
        throw new ApiError(
          400,
          `Round ${roundNumber} already exists for team ${team.slot}`
        );
      }

      const previousCurrentRound = team.currentRound;
      const newRound = {
        roundNumber,
        kills: 0,
        killPoints: 0,
        position: 0,
        positionPoints: 0,
        eliminationCount: 0,
        eliminatedPlayers: [],
        status: "alive",
      };

      if (roundNumber > team.currentRound) {
        team.currentRound = roundNumber;
      }

      team.rounds.push(newRound);
      team.isEliminated = false;
      await team.save();

      const template = logTemplates.roundCreated({ team, roundNumber });
      await safeCreateTeamLog({
        req,
        eventType: "ROUND_CREATED",
        severity: "info",
        team,
        roundNumber,
        title: template.title,
        message: template.message,
        changes: [
          {
            field: "currentRound",
            previous: previousCurrentRound,
            current: team.currentRound,
            delta: team.currentRound - previousCurrentRound,
          },
          {
            field: "rounds",
            previous: "without-round",
            current: `round-${roundNumber}-added`,
          },
        ],
      });
    })
  );

  const updatedTeams = await Team.find({ slot: { $in: slots } });

  req.app.io.emit("round_created", {
    roundNumber,
    teams: updatedTeams,
  });

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        updatedTeams,
        "Round created successfully for selected teams"
      )
    );
});

const deleteRoundFromTeams = asyncHandler(async (req, res) => {
  const { slots, roundNumber } = req.body;

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array of numbers");
  }

  if (slots.some((s) => typeof s !== "number")) {
    throw new ApiError(400, "All slots must be numbers");
  }

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "Round number must be a positive integer");
  }

  const teams = await Team.find({ slot: { $in: slots } });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  const results = await Promise.allSettled(
    teams.map(async (team) => {
      try {
        const roundIndex = team.rounds.findIndex(
          (r) => r.roundNumber === roundNumber
        );

        if (roundIndex === -1) {
          throw new ApiError(
            404,
            `Round ${roundNumber} not found for team ${team.slot}`
          );
        }

        const deletedRound = team.rounds[roundIndex];
        const deductedPoints =
          deletedRound.killPoints + deletedRound.positionPoints;
        const oldTotalPoints = team.totalPoints;

        team.totalPoints -= deductedPoints;
        team.rounds.splice(roundIndex, 1);

        if (team.currentRound === roundNumber) {
          team.currentRound =
            team.rounds.length > 0
              ? Math.max(...team.rounds.map((r) => r.roundNumber))
              : 0;
        }

        const currentRound = team.rounds.find(
          (r) => r.roundNumber === team.currentRound
        );
        team.isEliminated = currentRound?.eliminationCount >= 4;

        await team.save();

        const template = logTemplates.roundDeleted({
          team,
          roundNumber,
          deductedPoints,
        });

        await safeCreateTeamLog({
          req,
          eventType: "ROUND_DELETED",
          severity: "highlight",
          team,
          roundNumber,
          title: template.title,
          message: template.message,
          changes: [
            {
              field: "team.totalPoints",
              previous: oldTotalPoints,
              current: team.totalPoints,
              delta: team.totalPoints - oldTotalPoints,
            },
            {
              field: "roundDeleted",
              previous: `round-${roundNumber}`,
              current: "removed",
            },
          ],
          meta: {
            deductedPoints,
            oldRoundState: deletedRound,
          },
        });

        return { success: true, team };
      } catch (error) {
        return {
          success: false,
          team: team.slot,
          error: error.message,
        };
      }
    })
  );

  const successfulTeams = [];
  const errors = [];

  results.forEach((result) => {
    if (result.value.success) {
      successfulTeams.push(result.value.team);
    } else {
      errors.push({
        team: result.value.team,
        error: result.value.error,
      });
    }
  });

  if (errors.length > 0) {
    const errorDetails = errors
      .map((e) => `Team ${e.team}: ${e.error}`)
      .join(", ");
    throw new ApiError(207, `Partial success: ${errorDetails}`);
  }

  req.app.io.emit("round_deleted", {
    roundNumber,
    affectedSlots: slots,
    success: true,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { deletedRound: roundNumber, affectedTeams: successfulTeams },
        "Rounds deleted successfully"
      )
    );
});

// Generic Kill Update Handler
const updateKills = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { kills } = req.body;

  if (typeof kills !== "number" || kills < 0) {
    throw new ApiError(400, "Invalid kills value");
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  currentRound.kills += kills;
  currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
  team.totalPoints += kills * KILL_POINT_MULTIPLIER;

  await team.save();

  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: kills,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_UPDATED",
    severity: kills > 0 ? "highlight" : "info",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: currentRound.kills - oldKills,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kills updated successfully"));
});

// Add Single Kill
const addKill = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  currentRound.kills += 1;
  currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
  team.totalPoints += KILL_POINT_MULTIPLIER;

  await team.save();

  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: 1,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_ADDED",
    severity: "highlight",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: 1,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kill added successfully"));
});

// Decrease Single Kill
const decreaseKill = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  if (currentRound.kills > 0) {
    currentRound.kills -= 1;
    currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
    team.totalPoints -= KILL_POINT_MULTIPLIER;
  }

  await team.save();

  const killDelta = currentRound.kills - oldKills;
  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: killDelta,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_DECREASED",
    severity: "info",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: killDelta,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
    meta: {
      noChange: oldKills === currentRound.kills,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kill decreased successfully"));
});

// Modified Elimination Handler
const handleElimination = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { playerIndex } = req.body;

  if (playerIndex === undefined || playerIndex < 0 || playerIndex > 3) {
    throw new ApiError(400, "Invalid player index (0-3 required)");
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );

  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const playerIdx = currentRound.eliminatedPlayers.indexOf(playerIndex);
  let eliminationChange = 0;
  const oldEliminationCount = currentRound.eliminationCount;
  const oldStatus = currentRound.status;

  if (playerIdx === -1) {
    currentRound.eliminatedPlayers.push(playerIndex);
    eliminationChange = 1;
  } else {
    currentRound.eliminatedPlayers.splice(playerIdx, 1);
    eliminationChange = -1;
  }

  currentRound.eliminationCount += eliminationChange;
  currentRound.eliminationCount = Math.max(
    0,
    Math.min(4, currentRound.eliminationCount)
  );

  currentRound.status =
    currentRound.eliminationCount === 4 ? "eliminated" : "alive";

  const oldTeamEliminated = team.isEliminated;
  team.isEliminated = currentRound.eliminationCount === 4;

  await team.save();

  const toggleTemplate = logTemplates.eliminationUpdated({
    team,
    roundNumber: team.currentRound,
    playerIndex,
    eliminationCount: currentRound.eliminationCount,
    change: eliminationChange,
  });

  void safeCreateTeamLog({
    req,
    eventType: "ELIMINATION_UPDATED",
    severity: eliminationChange > 0 ? "highlight" : "info",
    team,
    roundNumber: team.currentRound,
    title: toggleTemplate.title,
    message: toggleTemplate.message,
    changes: [
      {
        field: "round.eliminationCount",
        previous: oldEliminationCount,
        current: currentRound.eliminationCount,
        delta: eliminationChange,
      },
      {
        field: "round.status",
        previous: oldStatus,
        current: currentRound.status,
      },
      {
        field: "round.eliminatedPlayers",
        previous: null,
        current: currentRound.eliminatedPlayers,
      },
    ],
    meta: {
      playerIndex,
      changeType: eliminationChange > 0 ? "eliminated" : "revived",
    },
  });

  if (currentRound.eliminationCount === 4) {
    const eliminatedTemplate = logTemplates.teamEliminated({
      team,
      roundNumber: team.currentRound,
      eliminationCount: currentRound.eliminationCount,
    });

    void safeCreateTeamLog({
      req,
      eventType: "TEAM_ELIMINATED",
      severity: "critical",
      team,
      roundNumber: team.currentRound,
      title: eliminatedTemplate.title,
      message: eliminatedTemplate.message,
      changes: [
        {
          field: "team.isEliminated",
          previous: oldTeamEliminated,
          current: true,
        },
        { field: "round.status", previous: oldStatus, current: "eliminated" },
      ],
    });
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        team,
        `Player ${playerIndex} elimination ${
          eliminationChange > 0 ? "added" : "removed"
        } successfully`
      )
    );
});

// Get All Teams
const getAllTeams = asyncHandler(async (req, res) => {
  const teams = await Team.find().sort({ totalPoints: -1 });
  return res
    .status(200)
    .json(new ApiResponse(200, teams, "Teams retrieved successfully"));
});

// Delete Team
const deleteTeam = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  if (!mongoose.isValidObjectId(teamId))
    throw new ApiError(400, "Invalid team ID");

  const team = await Team.findByIdAndDelete(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const template = logTemplates.teamDeleted({ team });
  await safeCreateTeamLog({
    req,
    eventType: "TEAM_DELETED",
    severity: "critical",
    team,
    roundNumber: team.currentRound || null,
    title: template.title,
    message: template.message,
    changes: [
      { field: "team.deleted", previous: false, current: true },
      {
        field: "team.totalPoints",
        previous: team.totalPoints,
        current: team.totalPoints,
        delta: 0,
      },
    ],
  });

  req.app.io.emit("team_deleted", teamId);
  return res
    .status(200)
    .json(new ApiResponse(200, null, "Team deleted successfully"));
});

// Update Round Positions
const updateRoundPositions = asyncHandler(async (req, res) => {
  const { roundNumber, slotPositions } = req.body;

  if (!Array.isArray(slotPositions)) {
    throw new ApiError(400, "Slot positions must be an array");
  }

  const teams = await Team.find();
  const updates = await Promise.all(
    slotPositions.map(async ({ slot, position }) => {
      const team = teams.find((t) => t.slot === slot);
      if (!team) return null;

      const round = team.rounds.find((r) => r.roundNumber === roundNumber);
      if (!round) {
        throw new ApiError(
          404,
          `Round ${roundNumber} not found for team ${slot}`
        );
      }

      const oldPosition = round.position;
      const oldPoints = round.positionPoints;
      const oldTotalPoints = team.totalPoints;

      const newPoints = POSITION_POINTS[position] || 0;
      const pointsDifference = newPoints - oldPoints;

      round.position = position;
      round.positionPoints = newPoints;

      team.totalPoints += pointsDifference;

      await team.save();

      const template = logTemplates.positionUpdated({
        team,
        roundNumber,
        previousPosition: oldPosition,
        currentPosition: position,
        pointsDelta: pointsDifference,
      });

      await safeCreateTeamLog({
        req,
        eventType: "POSITION_UPDATED",
        severity: pointsDifference > 0 ? "highlight" : "info",
        team,
        roundNumber,
        title: template.title,
        message: template.message,
        changes: [
          {
            field: "round.position",
            previous: oldPosition,
            current: position,
            delta: oldPosition && position ? position - oldPosition : null,
          },
          {
            field: "round.positionPoints",
            previous: oldPoints,
            current: newPoints,
            delta: pointsDifference,
          },
          {
            field: "team.totalPoints",
            previous: oldTotalPoints,
            current: team.totalPoints,
            delta: team.totalPoints - oldTotalPoints,
          },
        ],
      });

      return team;
    })
  );

  const validUpdates = updates.filter((update) => update !== null);
  req.app.io.emit("positions_updated", {
    roundNumber,
    slotPositions,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, validUpdates, "Positions updated successfully"));
});

const getTeamsByRound = async (req, res) => {
  try {
    const { roundNumber } = req.params;
    if (!roundNumber) {
      return res.status(400).json({
        statusCode: 400,
        message: "Round number is required",
        success: false,
      });
    }

    const teams = await Team.find({ "rounds.roundNumber": roundNumber });

    if (!teams.length) {
      return res.status(404).json({
        statusCode: 404,
        message: "No teams found for the given round number",
        success: false,
      });
    }

    const filteredTeams = teams.map((team) => {
      return {
        ...team.toObject(),
        rounds: team.rounds.filter(
          (round) => round.roundNumber === Number(roundNumber)
        ),
      };
    });

    res.status(200).json({
      statusCode: 200,
      data: filteredTeams,
      message: "Teams retrieved successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error fetching teams by round:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Internal Server Error",
      success: false,
    });
  }
};

export {
  createTeam,
  createRound,
  updateKills,
  handleElimination,
  getAllTeams,
  deleteTeam,
  updateRoundPositions,
  addKill,
  decreaseKill,
  deleteRoundFromTeams,
  getTeamsByRound,
};
