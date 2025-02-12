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
const createRound = asyncHandler(async (req, res) => {
  const { roundNumber, slotPositions } = req.body;

  // Validate input
  if (!Array.isArray(slotPositions)) {
    throw new ApiError(400, "Slot positions must be an array");
  }

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
    // Create new round entry
    const positionEntry = slotPositions.find(sp => sp.slot === team.slot);
    const position = positionEntry?.position || 0;
    
    const newRound = {
      roundNumber,
      kills: 0,
      killPoints: 0,
      position,
      positionPoints: POSITION_POINTS[position] || 0,
      eliminationCount: 0,
      status: "alive"
    };

    // Update team
    team.rounds.push(newRound);
    team.currentRound = roundNumber;
    team.totalPoints += newRound.positionPoints; // Add position points immediately
    team.isEliminated = false; // Reset elimination status for new round

    await team.save();
  }));

  const updatedTeams = await Team.find();
  return res
    .status(201)
    .json(new ApiResponse(201, updatedTeams, "Round created successfully"));
});

// Update Kills
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

  // Update kills
  currentRound.kills += kills;
  currentRound.killPoints = currentRound.kills * 2;
  team.totalPoints += kills * 2;

  await team.save();
  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kills updated successfully"));
});

// Handle Elimination
const handleElimination = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

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

  if (currentRound.eliminationCount >= 4) {
    throw new ApiError(400, "Team already eliminated in this round");
  }

  // Update elimination count
  currentRound.eliminationCount += 1;
  
  if (currentRound.eliminationCount === 4) {
    currentRound.status = "eliminated";
    team.isEliminated = true;
  }

  await team.save();
  return res
    .status(200)
    .json(new ApiResponse(200, team, "Elimination updated successfully"));
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

export {
  createTeam,
  createRound,
  updateKills,
  handleElimination,
  getAllTeams,
  deleteTeam
};