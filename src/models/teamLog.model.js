import mongoose from "mongoose";

const teamLogSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        "TEAM_CREATED",
        "ROUND_CREATED",
        "ROUND_DELETED",
        "KILL_ADDED",
        "KILL_UPDATED",
        "KILL_DECREASED",
        "POSITION_UPDATED",
        "ELIMINATION_UPDATED",
        "TEAM_ELIMINATED",
        "TEAM_DELETED",
      ],
    },
    severity: {
      type: String,
      enum: ["info", "highlight", "critical"],
      default: "info",
    },
    roundNumber: {
      type: Number,
      default: null,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    teamName: {
      type: String,
      required: true,
    },
    slot: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    changes: {
      type: [
        {
          field: { type: String, required: true },
          previous: { type: mongoose.Schema.Types.Mixed, default: null },
          current: { type: mongoose.Schema.Types.Mixed, default: null },
          delta: { type: Number, default: null },
        },
      ],
      default: [],
    },
    totals: {
      totalPoints: { type: Number, default: 0 },
      totalKillsInRound: { type: Number, default: 0 },
      killPointsInRound: { type: Number, default: 0 },
      positionPointsInRound: { type: Number, default: 0 },
      eliminationCountInRound: { type: Number, default: 0 },
      teamStatusInRound: {
        type: String,
        enum: ["alive", "eliminated", "unknown"],
        default: "unknown",
      },
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

teamLogSchema.index({ createdAt: -1 });
teamLogSchema.index({ roundNumber: 1, createdAt: -1 });
teamLogSchema.index({ teamId: 1, createdAt: -1 });
teamLogSchema.index({ eventType: 1, createdAt: -1 });

export const TeamLog = mongoose.model("TeamLog", teamLogSchema);
