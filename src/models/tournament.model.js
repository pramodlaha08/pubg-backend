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

// Live broadcast state driven by the control room. Overlay pages poll/subscribe
// and hide themselves when their toggle is off, so OBS sources can stay loaded.
const broadcastOverlaysSchema = new mongoose.Schema(
  {
    pointsTable: { type: Boolean, default: true },
    leaderboard: { type: Boolean, default: true },
    killFeed: { type: Boolean, default: true },
  },
  { _id: false }
);

const lowerThirdSchema = new mongoose.Schema(
  {
    visible: { type: Boolean, default: false },
    title: { type: String, default: "", trim: true, maxlength: 80 },
    subtitle: { type: String, default: "", trim: true, maxlength: 120 },
  },
  { _id: false }
);

const countdownSchema = new mongoose.Schema(
  {
    visible: { type: Boolean, default: false },
    running: { type: Boolean, default: false },
    title: { type: String, default: "Starting in", trim: true, maxlength: 60 },
    durationSeconds: { type: Number, default: 300, min: 10, max: 86400 },
    remainingSeconds: { type: Number, default: 300, min: 0, max: 86400 },
    // Set while running so every overlay renders the same wall-clock target.
    endsAt: { type: Date, default: null },
  },
  { _id: false }
);

const winnerSchema = new mongoose.Schema(
  {
    visible: { type: Boolean, default: false },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    title: { type: String, default: "CHAMPIONS", trim: true, maxlength: 60 },
    subtitle: { type: String, default: "", trim: true, maxlength: 100 },
  },
  { _id: false }
);

const broadcastSchema = new mongoose.Schema(
  {
    overlays: { type: broadcastOverlaysSchema, default: () => ({}) },
    lowerThird: { type: lowerThirdSchema, default: () => ({}) },
    countdown: { type: countdownSchema, default: () => ({}) },
    winner: { type: winnerSchema, default: () => ({}) },
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
    broadcast: { type: broadcastSchema, default: () => ({}) },
    meta: { type: metaSchema, default: () => ({}) },
  },
  { timestamps: true }
);

tournamentSchema.index({ status: 1 });
tournamentSchema.index({ isDefault: 1 });

export const Tournament = mongoose.model("Tournament", tournamentSchema);
