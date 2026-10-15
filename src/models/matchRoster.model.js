import mongoose from "mongoose";

const rosterPlayerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized: { type: String, default: "" },
    slot: { type: Number, default: null },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
  },
  { _id: false }
);

// Player-to-team mapping captured from a lobby screenshot for one match
// (a match == a roundNumber within a tournament).
const matchRosterSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    roundNumber: { type: Number, required: true, min: 1 },
    imageHash: { type: String, default: "" },
    rawText: { type: String, default: "" },
    players: { type: [rosterPlayerSchema], default: [] },
  },
  { timestamps: true }
);

matchRosterSchema.index({ tournamentId: 1, roundNumber: 1 }, { unique: true });

export const MatchRoster = mongoose.model("MatchRoster", matchRosterSchema);
