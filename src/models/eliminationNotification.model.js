import mongoose from "mongoose";

const eliminationNotificationSchema = new mongoose.Schema(
  {
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true },
    teamName: { type: String, required: true },
    roundNumber: { type: Number, required: true },
    status: { type: String, enum: ["alive", "eliminated"], default: "alive" },
    displayed: { type: Boolean, default: false },
    eliminationOrder: { type: Number, default: 0 },
    killCount: { type: Number, default: 0 },
    position: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index to ensure one record per team per round
eliminationNotificationSchema.index({ teamId: 1, roundNumber: 1 }, { unique: true });

export const EliminationNotification = mongoose.model("EliminationNotification", eliminationNotificationSchema);
