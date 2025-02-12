import mongoose from "mongoose";

const roundSchema = new mongoose.Schema({
  roundNumber: {
    type: Number,
    required: true,
    default: 0,
  },
  kills: {
    type: Number,
    default: 0,
  },
  killPoints: {
    type: Number,
    default: 0,
  },
  position: {
    type: Number,
    default: 0,
  },
  positionPoints: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ["alive", "eliminated"],
    default: "alive",
  },
});

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    logo: {
      type: String,
      default: "",
    },
    slot: {
      type: Number,
      required: true,
      unique: true,
    },
    kills: {
      type: Number,
      default: 0,
    },
    positionPoints: {
      type: Number,
      default: 0,
    },
    totalPoints: {
      type: Number,
      default: 0,
    },
    eliminationCount: {
      type: Number,
      default: 0,
    },
    isEliminated: {
      type: Boolean,
      default: false,
    },
    rounds: [roundSchema],
  },
  { timestamps: true }
);

// Calculate total points before saving
teamSchema.pre("save", function (next) {
  this.totalPoints = this.positionPoints + this.kills * 2;
  next();
});

export const Team = mongoose.model("Team", teamSchema);
