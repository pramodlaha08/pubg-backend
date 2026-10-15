import mongoose from "mongoose";

const roundInfoSchema = new mongoose.Schema(
  {
    tournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    roundNumber: { type: Number, required: true },
    mapName: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

roundInfoSchema.index({ tournamentId: 1, roundNumber: 1 }, { unique: true });

export const RoundInfo = mongoose.model("RoundInfo", roundInfoSchema);
