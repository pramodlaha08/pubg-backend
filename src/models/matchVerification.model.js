import mongoose from "mongoose";

const verifiedEntrySchema = new mongoose.Schema(
  {
    slot: { type: Number, required: true },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    kills: { type: Number, default: null },
    position: { type: Number, default: null },
  },
  { _id: false }
);

const comparisonEntrySchema = new mongoose.Schema(
  {
    slot: { type: Number, default: null },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    name: { type: String, default: "" },
    liveKills: { type: Number, default: 0 },
    verifiedKills: { type: Number, default: null },
    livePosition: { type: Number, default: 0 },
    verifiedPosition: { type: Number, default: null },
    livePlacementPoints: { type: Number, default: 0 },
    verifiedPlacementPoints: { type: Number, default: null },
    status: { type: String, default: "match" },
  },
  { _id: false }
);

// Audit of a results screenshot: what was extracted, how it compared to the
// live scores, and whether it has been applied. Used both for history and to
// keep repeated uploads of the same screenshot idempotent.
const matchVerificationSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    roundNumber: { type: Number, required: true, min: 1 },
    imageHash: { type: String, required: true },
    rawText: { type: String, default: "" },
    verified: { type: [verifiedEntrySchema], default: [] },
    comparison: { type: [comparisonEntrySchema], default: [] },
    unmatched: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, default: "" },
            kills: { type: Number, default: null },
            rank: { type: Number, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "applied"],
      default: "pending",
    },
    appliedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

matchVerificationSchema.index(
  { tournamentId: 1, imageHash: 1 },
  { unique: true }
);

export const MatchVerification = mongoose.model(
  "MatchVerification",
  matchVerificationSchema
);
