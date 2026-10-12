import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { Team } from "../models/team.model.js";
import { Tournament } from "../models/tournament.model.js";
import { getScoringConfig, recomputeTeamScores } from "./scoring.helper.js";

/**
 * Recompute every team's killPoints, positionPoints and totalPoints from its
 * raw rounds using the owning tournament's scoring rules. Fixes any drift that
 * accumulated in the previous incremental add/subtract logic.
 */
const run = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("[Recompute] Refusing to run in production.");
    process.exit(1);
  }

  await connectDB();

  const tournaments = await Tournament.find({}).lean();
  const configById = new Map(
    tournaments.map((t) => [String(t._id), getScoringConfig(t)])
  );

  const teams = await Team.find({});
  let changed = 0;
  let scanned = 0;

  for (const team of teams) {
    scanned += 1;
    const config = configById.get(String(team.tournamentId));
    if (!config) {
      console.warn(
        `[Recompute] Team "${team.name}" (${team._id}) has no tournament (${team.tournamentId}); skipped`
      );
      continue;
    }
    const before = team.totalPoints;
    recomputeTeamScores(team, config);
    if (team.totalPoints !== before || team.isModified()) {
      await team.save();
      changed += 1;
      console.log(
        `[Recompute] "${team.name}" total ${before} -> ${team.totalPoints}`
      );
    }
  }

  console.log(
    `[Recompute] Scanned ${scanned} teams, updated ${changed}.`
  );

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("[Recompute] Failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
