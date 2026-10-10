import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Admin } from "../models/admin.model.js";
import { Settings } from "../models/settings.model.js";

const randomPassword = () => crypto.randomBytes(9).toString("base64url");

export const seedAdmin = async () => {
  const existing = await Admin.countDocuments();
  if (existing > 0) {
    return;
  }

  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase().trim();
  const providedPassword = process.env.ADMIN_PASSWORD;
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
};

export const ensureSettings = async () => {
  const existing = await Settings.findOne({ key: "app" });
  if (!existing) {
    await Settings.create({ key: "app" });
  }
};
