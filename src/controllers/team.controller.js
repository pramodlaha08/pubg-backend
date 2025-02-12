import { Team } from "../models/team.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";

// Create Team
const createTeam = asyncHandler(async (req, res) => {
  const { name, slot } = req.body;
  const logoLocalPath = req.file?.path;
  if (!logoLocalPath) throw new ApiError(400, "Avatar is required");
  const logo = await uploadOnCloudinary(logoLocalPath);
  if (!logo.url)
    throw new ApiError(500, "Something went wrong while uploading logo");

  const team = await Team.create({
    name,
    slot,
    logo: logo.url,
  });
  if(!team) throw new ApiError(400, "Couldn't create team");

  res.status(201).json(new ApiResponse(201, team, "Team created successfully"));
});

// Update Kills
const updateKills = asyncHandler(async (req, res) => {
  const { kills } = req.body;
  const team = await Team.findById(req.params.id);

  team.kills += kills;
  const updatedTeam = await team.save();

  res.json(updatedTeam);
});

// Update Position Points
const updatePosition = asyncHandler(async (req, res) => {
  const { positionPoints } = req.body;
  const team = await Team.findById(req.params.id);

  team.positionPoints = positionPoints;
  const updatedTeam = await team.save();

  res.json(updatedTeam);
});

// Handle Elimination
const handleElimination = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);

  if (team.eliminationCount < 4) {
    team.eliminationCount += 1;
    if (team.eliminationCount === 4) {
      team.isEliminated = true;
    }
    const updatedTeam = await team.save();
    return res.json(updatedTeam);
  }

  res.status(400).json({ message: "Team already eliminated" });
});

// Add Round
const addRound = asyncHandler(async (req, res) => {
  const { roundNumber, slotPositions } = req.body;

  // Update position points for slots
  await Promise.all(
    slotPositions.map(async ({ slot, position }) => {
      const team = await Team.findOne({ slot });
      if (team) {
        team.positionPoints = getPositionPoints(position);
        await team.save();
      }
    })
  );

  // Update all teams with new round data
  const teams = await Team.find();
  const updatedTeams = await Promise.all(
    teams.map(async (team) => {
      const roundData = {
        roundNumber,
        kills: 0, // Can be updated later
        killPoints: 0,
        position: getPositionForSlot(team.slot, slotPositions),
        positionPoints: getPositionPoints(
          getPositionForSlot(team.slot, slotPositions)
        ),
        status: team.isEliminated ? "eliminated" : "alive",
      };

      team.rounds.push(roundData);
      return team.save();
    })
  );

  res.json(updatedTeams);
});

// Helper functions
const getPositionPoints = (position) => {
  const pointsMap = {
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
  return pointsMap[position] || 0;
};

const getPositionForSlot = (slot, slotPositions) => {
  const found = slotPositions.find((sp) => sp.slot === slot);
  return found ? found.position : 0;
};

const helloworld = asyncHandler(async (req,res) => {
  res.status(200).json(200, null, "ok")

})
export {
  createTeam,
  updateKills,
  updatePosition,
  handleElimination,
  addRound,
  helloworld,
};
