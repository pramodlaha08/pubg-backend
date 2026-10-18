import mongoose from "mongoose";
import { pointsTableSchema } from "./settings.model.js";

const scoringSchema = new mongoose.Schema(
  {
    // Position -> points. Map of numeric strings to numbers, e.g. { "1": 10 }.
    positionPoints: {
      type: Map,
      of: Number,
      default: () => ({ 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 }),
    },
    killPointMultiplier: { type: Number, default: 1, min: 0 },
    fullEliminationCount: { type: Number, default: 4, min: 1, max: 4 },
    // Position-first scoring: when false, eliminations are ignored entirely and
    // only team placement awards points. Kill reading/entry is skipped too.
    trackKills: { type: Boolean, default: false },
  },
  { _id: false }
);

const metaSchema = new mongoose.Schema(
  {
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const tournamentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    season: { type: String, default: "", trim: true, maxlength: 40 },
    status: {
      type: String,
      enum: ["draft", "active", "completed", "archived"],
      default: "active",
    },
    isDefault: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    design: { type: pointsTableSchema, default: () => ({}) },
    scoring: { type: scoringSchema, default: () => ({}) },
    meta: { type: metaSchema, default: () => ({}) },
  },
  { timestamps: true }
);

tournamentSchema.index({ status: 1 });
tournamentSchema.index({ isDefault: 1 });

export const Tournament = mongoose.model("Tournament", tournamentSchema);
