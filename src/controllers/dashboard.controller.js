import { Team } from "../models/team.model.js";
import { TeamLog } from "../models/teamLog.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const LEADERBOARD_LIMIT = 5;
const ACTIVITY_LIMIT = 8;

export const getDashboardStats = asyncHandler(async (req, res) => {
  const [teams, recentActivity] = await Promise.all([
    Team.find({ tournamentId: req.tournamentId }).lean(),
    TeamLog.find({ tournamentId: req.tournamentId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(ACTIVITY_LIMIT)
      .lean(),
  ]);

  let aliveTeams = 0;
  let currentRound = 0;
  let totalKills = 0;
  let totalEliminations = 0;

  for (const team of teams) {
    if (!team.isEliminated) aliveTeams += 1;
    if ((team.currentRound || 0) > currentRound) {
      currentRound = team.currentRound || 0;
    }
    for (const round of team.rounds || []) {
      totalKills += round.kills || 0;
      totalEliminations += round.eliminationCount || 0;
    }
  }

  const leaderboard = [...teams]
    .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
    .slice(0, LEADERBOARD_LIMIT)
    .map((team) => ({
      id: team._id,
      name: team.name,
      slot: team.slot,
      logo: team.logo || "",
      totalPoints: team.totalPoints || 0,
      isEliminated: Boolean(team.isEliminated),
    }));

  const activity = recentActivity.map((entry) => ({
    id: entry._id,
    eventType: entry.eventType,
    severity: entry.severity,
    title: entry.title,
    message: entry.message,
    teamName: entry.teamName,
    slot: entry.slot,
    roundNumber: entry.roundNumber,
    createdAt: entry.createdAt,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        teams: teams.length,
        aliveTeams,
        eliminatedTeams: teams.length - aliveTeams,
        currentRound,
        totalKills,
        totalEliminations,
        leaderboard,
        recentActivity: activity,
        generatedAt: new Date().toISOString(),
      },
      "Dashboard stats retrieved successfully"
    )
  );
});
