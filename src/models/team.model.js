import mongoose from "mongoose";

const roundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true },
  kills: { type: Number, default: 0 },
  killPoints: { type: Number, default: 0 },
  position: { type: Number, default: 0 },
  positionPoints: { type: Number, default: 0 },
  eliminationCount: { type: Number, default: 0 },
  eliminatedPlayers: {
    type: [Number], // Array of player indexes (0-3)
    default: [],
  },
  status: { type: String, enum: ["alive", "eliminated"], default: "alive" },
});

const teamSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    logo: { type: String, default: "" },
    slot: { type: Number, required: true },
    currentRound: { type: Number, default: 0 },
    isEliminated: { type: Boolean, default: false },
    totalPoints: { type: Number, default: 0 },
    rounds: [roundSchema],
  },
  { timestamps: true }
);

// Name and slot are unique only within a tournament.
teamSchema.index({ tournamentId: 1, name: 1 }, { unique: true });
teamSchema.index({ tournamentId: 1, slot: 1 }, { unique: true });

export const Team = mongoose.model("Team", teamSchema);
