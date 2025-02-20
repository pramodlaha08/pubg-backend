// Team Controller
import { Team } from "../models/team.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import mongoose from "mongoose";

// Position points mapping
const POSITION_POINTS = {
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
  9: 0,
  10: 0,
};
const KILL_POINT_MULTIPLIER = 1;

// Create Team
const createTeam = asyncHandler(async (req, res) => {
  const { name, slot } = req.body;

  // Validate required fields
  if (!name || !slot) {
    throw new ApiError(400, "Name and slot are required");
  }

  // Check for existing slot
  const existingSlot = await Team.findOne({ slot });
  if (existingSlot) {
    throw new ApiError(400, `Slot ${slot} already occupied`);
  }

  // Handle logo upload
  const logoLocalPath = req.file?.path;
  if (!logoLocalPath) throw new ApiError(400, "Logo is required");
  const logo = await uploadOnCloudinary(logoLocalPath);

  // Create team
  const team = await Team.create({
    name,
    slot,
    logo: logo.url,
    rounds: [],
    currentRound: 0,
    totalPoints: 0,
  });

  req.app.io.emit("team_created", team);

  return res
    .status(201)
    .json(new ApiResponse(201, team, "Team created successfully"));
});

// Create New Round
// Create New Round (Modified)
const createRound = asyncHandler(async (req, res) => {
  const { slots, roundNumber } = req.body;

  // Validate input
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array");
  }
    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      throw new ApiError(400, "Round number must be a positive integer");
    }

  // Position points mapping
  const POSITION_POINTS = {
    1: 10,
    2: 6,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
    7: 1,
    8: 1,
    9: 0,
    10: 0,
  };

  // Get teams by slots
  const teams = await Team.find({ slot: { $in: slots } });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  // Process teams in parallel
  await Promise.all(
    teams.map(async (team) => {
      // Check for existing round
      if (team.rounds.some((r) => r.roundNumber === roundNumber)) {
        throw new ApiError(
          400,
          `Round ${roundNumber} already exists for team ${team.slot}`
        );
      }

      // Create new round with default values
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

      // Update current round number if needed
      if (roundNumber > team.currentRound) {
        team.currentRound = roundNumber;
      }

      team.rounds.push(newRound);
      team.isEliminated = false;
      await team.save();
    })
  );

  const updatedTeams = await Team.find({ slot: { $in: slots } });

  // Emit socket event
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

  // Enhanced validation
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array of numbers");
  }

  if (slots.some((s) => typeof s !== "number")) {
    throw new ApiError(400, "All slots must be numbers");
  }

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "Round number must be a positive integer");
  }

  // Get teams with error handling
  const teams = await Team.find({ slot: { $in: slots } });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  // Process teams with proper error tracking
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
        team.totalPoints -=
          deletedRound.killPoints + deletedRound.positionPoints;
        team.rounds.splice(roundIndex, 1);

        // Update current round
        if (team.currentRound === roundNumber) {
          team.currentRound =
            team.rounds.length > 0
              ? Math.max(...team.rounds.map((r) => r.roundNumber))
              : 0;
        }

        // Update elimination status
        const currentRound = team.rounds.find(
          (r) => r.roundNumber === team.currentRound
        );
        team.isEliminated = currentRound?.eliminationCount >= 4;

        await team.save();
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

  // Process results
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

  // Handle partial success
  if (errors.length > 0) {
    const errorDetails = errors
      .map((e) => `Team ${e.team}: ${e.error}`)
      .join(", ");
    throw new ApiError(207, `Partial success: ${errorDetails}`);
  }

  // Emit socket event
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

  // Validate input
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

  // Update kills and points
  currentRound.kills += kills;
  currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
  team.totalPoints += kills * KILL_POINT_MULTIPLIER;

  await team.save();



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

  // Increment kills by 1
  currentRound.kills += 1;
  currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
  team.totalPoints += KILL_POINT_MULTIPLIER;

  await team.save();


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

  // Decrement kills but not below 0
  if (currentRound.kills > 0) {
    currentRound.kills -= 1;
    currentRound.killPoints = currentRound.kills * KILL_POINT_MULTIPLIER;
    team.totalPoints -= KILL_POINT_MULTIPLIER;
  }

  await team.save();


  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kill decreased successfully"));
});
// Update Team Model (add to roundSchema)

// Modified Elimination Handler
const handleElimination = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { playerIndex } = req.body; // 0-3 (4 players per team)

  // Validate player index
  if (playerIndex === undefined || playerIndex < 0 || playerIndex > 3) {
    throw new ApiError(400, "Invalid player index (0-3 required)");
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  // Get current round
  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );

  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  // Check if player is already eliminated
  const playerIdx = currentRound.eliminatedPlayers.indexOf(playerIndex);
  let eliminationChange = 0;

  if (playerIdx === -1) {
    // Add elimination
    currentRound.eliminatedPlayers.push(playerIndex);
    eliminationChange = 1;
  } else {
    // Remove elimination
    currentRound.eliminatedPlayers.splice(playerIdx, 1);
    eliminationChange = -1;
  }

  // Update elimination count
  currentRound.eliminationCount += eliminationChange;

  // Clamp elimination count between 0-4
  currentRound.eliminationCount = Math.max(
    0,
    Math.min(4, currentRound.eliminationCount)
  );

  // Update round status
  currentRound.status =
    currentRound.eliminationCount === 4 ? "eliminated" : "alive";

  // Update team elimination status
  team.isEliminated = currentRound.eliminationCount === 4;

  await team.save();



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

  if(!mongoose.isValidObjectId(teamId))
    throw new ApiError(400, "Invalid team ID");

  const team = await Team.findByIdAndDelete(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }
  req.app.io.emit("team_deleted", teamId);
  return res
    .status(200)
    .json(new ApiResponse(200, null, "Team deleted successfully"));
});

// Update Round Positions (New Method)
const updateRoundPositions = asyncHandler(async (req, res) => {
  const { roundNumber, slotPositions } = req.body;

  // Validate input
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

      // Calculate position points difference
      const oldPoints = round.positionPoints;
      const newPoints = POSITION_POINTS[position] || 0;
      const pointsDifference = newPoints - oldPoints;

      // Update round details
      round.position = position;
      round.positionPoints = newPoints;

      // Update total points
      team.totalPoints += pointsDifference;

      await team.save();
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
