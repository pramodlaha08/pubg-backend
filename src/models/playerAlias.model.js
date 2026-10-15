import mongoose from "mongoose";

// Learns confirmed player -> team mappings per tournament so future lobby
// screenshots resolve the same player automatically (and consistently).
const playerAliasSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    canonical: { type: String, required: true },
    name: { type: String, default: "" },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    slot: { type: Number, default: null },
    count: { type: Number, default: 0 },
    lastRound: { type: Number, default: null },
  },
  { timestamps: true }
);

playerAliasSchema.index({ tournamentId: 1, canonical: 1 }, { unique: true });

export const PlayerAlias = mongoose.model("PlayerAlias", playerAliasSchema);
