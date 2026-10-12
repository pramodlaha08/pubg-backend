import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Admin } from "../models/admin.model.js";
import { Settings } from "../models/settings.model.js";
import { Tournament } from "../models/tournament.model.js";
import { Team } from "../models/team.model.js";
import { EliminationNotification } from "../models/eliminationNotification.model.js";
import { TeamLog } from "../models/teamLog.model.js";

const randomPassword = () => crypto.randomBytes(9).toString("base64url");

export const seedAdmin = async () => {
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase().trim();
  const providedPassword = process.env.ADMIN_PASSWORD;
  const existing = await Admin.findOne({ username });

  if (!existing) {
    const password = providedPassword || randomPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, passwordHash });

    console.log("======================================================");
    console.log("[Seed] Created initial admin account");
    console.log(`[Seed] Username: ${username}`);
    if (providedPassword) {
      console.log("[Seed] Password: (from ADMIN_PASSWORD env)");
    } else {
      console.log(`[Seed] Password: ${password}`);
      console.log("[Seed] Save this password now - it will not be shown again.");
    }
    console.log("======================================================");
    return;
  }

  if (providedPassword) {
    const matches = await bcrypt.compare(providedPassword, existing.passwordHash);
    if (!matches) {
      existing.passwordHash = await bcrypt.hash(providedPassword, 10);
      await existing.save();
      console.log(`[Seed] Synced password for admin "${username}" from ADMIN_PASSWORD env`);
    }
  }
};

export const ensureSettings = async () => {
  const existing = await Settings.findOne({ key: "app" });
  if (!existing) {
    await Settings.create({ key: "app" });
  }
};

// Ensure at least one tournament exists and that every scoped document is
// attached to a tournament. Idempotent; safe to run on every boot.
export const ensureDefaultTournament = async () => {
  const settings = await Settings.findOne({ key: "app" });

  let tournament = null;
  if (settings?.defaultTournamentId) {
    tournament = await Tournament.findById(settings.defaultTournamentId);
  }
  if (!tournament) {
    tournament = await Tournament.findOne({ isDefault: true });
  }
  if (!tournament) {
    tournament = await Tournament.findOne({}).sort({ createdAt: 1 });
  }

  if (!tournament) {
    const legacyDesign = settings?.pointsTable
      ? settings.pointsTable.toObject()
      : undefined;
    tournament = await Tournament.create({
      name: "Default Tournament",
      status: "active",
      isDefault: true,
      ...(legacyDesign ? { design: legacyDesign } : {}),
    });
    console.log(`[Seed] Created default tournament "${tournament.name}"`);
  }

  await Settings.findOneAndUpdate(
    { key: "app" },
    { $set: { defaultTournamentId: tournament._id } },
    { upsert: true }
  );
  if (!tournament.isDefault) {
    tournament.isDefault = true;
    await tournament.save();
  }

  const tid = tournament._id;
  const orphanFilter = {
    $or: [
      { tournamentId: { $exists: false } },
      { tournamentId: null },
    ],
  };

  const [teams, notifications, logs] = await Promise.all([
    Team.updateMany(orphanFilter, { $set: { tournamentId: tid } }),
    EliminationNotification.updateMany(orphanFilter, { $set: { tournamentId: tid } }),
    TeamLog.updateMany(orphanFilter, { $set: { tournamentId: tid } }),
  ]);

  const backfilled =
    (teams.modifiedCount || 0) +
    (notifications.modifiedCount || 0) +
    (logs.modifiedCount || 0);
  if (backfilled > 0) {
    console.log(
      `[Seed] Backfilled tournamentId on ${backfilled} legacy document(s)`
    );
  }

  return tournament;
};
