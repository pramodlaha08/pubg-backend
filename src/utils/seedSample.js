import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Team } from "../models/team.model.js";
import { ensureDefaultTournament } from "./seedAdmin.js";
import SQUAD_CONFIG from "../config/squadSize.js";

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
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
  16: 0,
};

const TEAM_NAMES = [
  "SAMPLE ALPHA",
  "SAMPLE BRAVO",
  "SAMPLE CHARLIE",
  "SAMPLE DELTA",
  "SAMPLE ECHO",
  "SAMPLE FOXTROT",
  "SAMPLE GOLF",
  "SAMPLE HOTEL",
];

const buildRound = (teamIndex, roundNumber) => {
  const kills = (teamIndex * (roundNumber + 2)) % 6;
  const position = ((teamIndex + roundNumber) % TEAM_NAMES.length) + 1;
  const positionPoints = POSITION_POINTS[position] ?? 0;
  const eliminationCount =
    position === 1 ? 0 : Math.min(position - 1, SQUAD_CONFIG.fullEliminationCount);
  const eliminatedPlayers = Array.from(
    { length: eliminationCount },
    (_, i) => i
  ).filter((i) => SQUAD_CONFIG.isValidPlayerIndex(i));

  return {
    roundNumber,
    kills,
    killPoints: kills,
    position,
    positionPoints,
    eliminationCount,
    eliminatedPlayers,
    status:
      eliminationCount >= SQUAD_CONFIG.fullEliminationCount
        ? "eliminated"
        : "alive",
  };
};

const run = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("[SeedSample] Refusing to run in production.");
    process.exit(1);
  }

  await connectDB();
  const tournament = await ensureDefaultTournament();
  console.log(
    `[SeedSample] Replacing teams in "${tournament.name}" with sample data...`
  );

  await Team.deleteMany({ tournamentId: tournament._id });

  const teams = TEAM_NAMES.map((name, index) => {
    const rounds = [
      buildRound(index, 1),
      buildRound(index, 2),
    ];
    const totalPoints = rounds.reduce(
      (sum, r) => sum + r.positionPoints + r.killPoints,
      0
    );
    const lastRound = rounds[rounds.length - 1];

    return {
      tournamentId: tournament._id,
      name,
      logo: "",
      slot: index + 1,
      currentRound: rounds.length,
      isEliminated:
        lastRound.eliminationCount >= SQUAD_CONFIG.fullEliminationCount,
      totalPoints,
      rounds,
    };
  });

  await Team.insertMany(teams);

  console.log(`[SeedSample] Inserted ${teams.length} teams with 2 rounds each.`);
  console.log("[SeedSample] Done.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("[SeedSample] Failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
