import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../db/index.js";
import { ensureDefaultTournament } from "./seedAdmin.js";
import { Team } from "../models/team.model.js";
import { EliminationNotification } from "../models/eliminationNotification.model.js";
import { TeamLog } from "../models/teamLog.model.js";
import { Tournament } from "../models/tournament.model.js";
import { Settings } from "../models/settings.model.js";

const dropIndexSafe = async (collection, indexName) => {
  try {
    await mongoose.connection.collection(collection).dropIndex(indexName);
    console.log(`[Migrate] Dropped legacy index ${collection}.${indexName}`);
  } catch (error) {
    const codeName = error?.codeName || "";
    if (codeName !== "IndexNotFound" && error?.code !== 27) {
      console.warn(
        `[Migrate] Could not drop ${collection}.${indexName}: ${error.message}`
      );
    }
  }
};

const run = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("[Migrate] Refusing to run in production.");
    process.exit(1);
  }

  await connectDB();

  const tournament = await ensureDefaultTournament();
  console.log(
    `[Migrate] Default tournament ready: "${tournament.name}" (${tournament._id})`
  );

  // Remove pre-tournament unique indexes so concurrent tournaments can reuse
  // the same slot/name values.
  await dropIndexSafe("teams", "name_1");
  await dropIndexSafe("teams", "slot_1");
  await dropIndexSafe("eliminationnotifications", "teamId_1_roundNumber_1");

  await Promise.all([
    Team.syncIndexes(),
    EliminationNotification.syncIndexes(),
    TeamLog.syncIndexes(),
    Tournament.syncIndexes(),
    Settings.syncIndexes(),
  ]);

  console.log("[Migrate] Indexes synced.");
  console.log("[Migrate] Done.");

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("[Migrate] Failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
