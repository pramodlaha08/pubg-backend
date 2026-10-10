import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Admin } from "../models/admin.model.js";
import { Settings } from "../models/settings.model.js";

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
