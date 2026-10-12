import mongoose from "mongoose";

const eliminationNotificationSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
    },
    teamName: { type: String, required: true },
    teamLogo: { type: String, default: "" },
    roundNumber: { type: Number, required: true },
    status: { type: String, enum: ["alive", "eliminated"], default: "alive" },
    displayed: { type: Boolean, default: false },
    eliminationOrder: { type: Number, default: 0 },
    eliminatedAt: { type: Date, default: null },
    killCount: { type: Number, default: 0 },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index to ensure one record per team per round within a tournament
eliminationNotificationSchema.index(
  { tournamentId: 1, teamId: 1, roundNumber: 1 },
  { unique: true }
);

export const EliminationNotification = mongoose.model(
  "EliminationNotification",
  eliminationNotificationSchema
);
