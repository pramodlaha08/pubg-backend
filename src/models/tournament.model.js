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
    // Eliminations always award points; kept for backward compatibility.
    trackKills: { type: Boolean, default: true },
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
    eventLogoUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    sponsorLogos: {
      type: [{ type: String, trim: true, maxlength: 1000 }],
      default: [],
    },
    mapName: { type: String, default: "", trim: true, maxlength: 60 },
    mapImageUrl: { type: String, default: "", trim: true, maxlength: 1000 },
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
    backgroundImageUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    playerImageUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    playerName: { type: String, default: "", trim: true, maxlength: 60 },
    teamLogoUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    // null = never auto/manual, true = auto winner active, false = operator
    // has taken control. Manual winner edits must never be overwritten.
    auto: { type: Boolean, default: null },
  },
  { _id: false }
);

const layoutEntrySchema = new mongoose.Schema(
  {
    x: { type: Number, default: 0, min: 0, max: 100 },
    y: { type: Number, default: 0, min: 0, max: 100 },
    // 0 means "use the element's natural width".
    width: { type: Number, default: 0, min: 0, max: 100 },
    scale: { type: Number, default: 100, min: 40, max: 200 },
  },
  { _id: false }
);

const broadcastLayoutSchema = new mongoose.Schema(
  {
    pointsTable: {
      type: layoutEntrySchema,
      default: () => ({ x: 66, y: 20, width: 0, scale: 100 }),
    },
    killFeed: {
      type: layoutEntrySchema,
      default: () => ({ x: 72, y: 66, width: 24, scale: 100 }),
    },
    notification: {
      type: layoutEntrySchema,
      default: () => ({ x: 4, y: 64, width: 24, scale: 100 }),
    },
    lowerThird: {
      type: layoutEntrySchema,
      default: () => ({ x: 4, y: 76, width: 34, scale: 100 }),
    },
    countdown: {
      type: layoutEntrySchema,
      default: () => ({ x: 37, y: 5, width: 26, scale: 100 }),
    },
    winner: {
      type: layoutEntrySchema,
      default: () => ({ x: 22, y: 22, width: 56, scale: 100 }),
    },
  },
  { _id: false }
);

const broadcastSchema = new mongoose.Schema(
  {
    overlays: { type: broadcastOverlaysSchema, default: () => ({}) },
    lowerThird: { type: lowerThirdSchema, default: () => ({}) },
    countdown: { type: countdownSchema, default: () => ({}) },
    winner: { type: winnerSchema, default: () => ({}) },
    layout: { type: broadcastLayoutSchema, default: () => ({}) },
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
    // Round that all live scoring writes to until the scorer switches it.
    activeRound: { type: Number, default: 0, min: 0 },
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
