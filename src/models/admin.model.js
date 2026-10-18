import mongoose from "mongoose";

// Role capability order (highest first). Used by the auth middleware to
// decide which accounts may perform which actions:
//   admin       - full control, including managing other admin accounts
//   scorer      - live scoring, positions, rounds and auto-scoring apply
//   commentator - read-only access plus the commentary feed
//   viewer      - read-only access
export const ADMIN_ROLES = ["admin", "scorer", "commentator", "viewer"];

const adminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ADMIN_ROLES,
      default: "viewer",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Admin = mongoose.model("Admin", adminSchema);
