// Team Controller
import { Team } from "../models/team.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";

// Position points mapping
const POSITION_POINTS = {
  1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1, 9: 0, 10: 0
};

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
    totalPoints: 0
  });

  return res
    .status(201)
    .json(new ApiResponse(201, team, "Team created successfully"));
});

// Create New Round
// Create New Round (Modified)
const createRound = asyncHandler(async (req, res) => {
  const { roundNumber } = req.body;

  // Get all teams
  const teams = await Team.find();
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found");
  }

  // Validate round sequence
  const maxRound = Math.max(...teams.map(t => t.currentRound));
  if (roundNumber !== maxRound + 1) {
    throw new ApiError(400, 
      `Invalid round number. Current round is ${maxRound}, next should be ${maxRound + 1}`
    );
  }

  // Process all teams
  await Promise.all(teams.map(async team => {
    // Create new round with default values
    const newRound = {
      roundNumber,
      kills: 0,
      killPoints: 0,
      position: 0,
      positionPoints: 0,
      eliminationCount: 0,
      status: "alive"
    };

    // Update team
    team.rounds.push(newRound);
    team.currentRound = roundNumber;
    team.isEliminated = false; // Reset elimination status
    await team.save();
  }));

  const updatedTeams = await Team.find();
  return res
    .status(201)
    .json(new ApiResponse(201, updatedTeams, "Round created successfully"));
});

// Modified Update Kills (Now handles current round automatically)
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

  // Get current round
  const currentRound = team.rounds.find(r => 
    r.roundNumber === team.currentRound
  );

  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  // Update kills and points
  currentRound.kills += kills;
  currentRound.killPoints = currentRound.kills * 2;
  team.totalPoints += kills * 2;

  await team.save();
  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kills updated successfully"));
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
  const currentRound = team.rounds.find(r => 
    r.roundNumber === team.currentRound
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
  currentRound.eliminationCount = Math.max(0, 
    Math.min(4, currentRound.eliminationCount)
  );

  // Update round status
  currentRound.status = currentRound.eliminationCount === 4 ? 
    "eliminated" : "alive";

  // Update team elimination status
  team.isEliminated = currentRound.eliminationCount === 4;

  await team.save();
  
  return res.status(200).json(
    new ApiResponse(200, team, 
      `Player ${playerIndex} elimination ${
        eliminationChange > 0 ? 'added' : 'removed'
      } successfully`)
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
  
  const team = await Team.findByIdAndDelete(teamId);
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

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
  const updates = await Promise.all(slotPositions.map(async ({ slot, position }) => {
    const team = teams.find(t => t.slot === slot);
    if (!team) return null;

    const round = team.rounds.find(r => r.roundNumber === roundNumber);
    if (!round) {
      throw new ApiError(404, `Round ${roundNumber} not found for team ${slot}`);
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
  }));

  const validUpdates = updates.filter(update => update !== null);
  return res
    .status(200)
    .json(new ApiResponse(200, validUpdates, "Positions updated successfully"));
});

export {
  createTeam,
  createRound,
  updateKills,
  handleElimination,
  getAllTeams,
  deleteTeam,
  updateRoundPositions,
};