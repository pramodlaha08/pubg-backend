import { RoundInfo } from "../models/roundInfo.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const MAX_MAP_NAME = 40;

const serialize = (doc) => ({
  _id: String(doc._id),
  roundNumber: doc.roundNumber,
  mapName: doc.mapName || "",
});

export const getRoundInfo = asyncHandler(async (req, res) => {
  const list = await RoundInfo.find({ tournamentId: req.tournamentId }).sort({
    roundNumber: 1,
  });

  res
    .status(200)
    .json(new ApiResponse(200, list.map(serialize), "Round info fetched"));
});

export const setRoundInfo = asyncHandler(async (req, res) => {
  const rawRound = req.body?.roundNumber ?? req.query?.roundNumber;
  const roundNumber = Number.parseInt(rawRound, 10);

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "A valid roundNumber is required");
  }

  const rawMap = typeof req.body?.mapName === "string" ? req.body.mapName : "";
  const mapName = rawMap.trim().slice(0, MAX_MAP_NAME);

  const doc = await RoundInfo.findOneAndUpdate(
    { tournamentId: req.tournamentId, roundNumber },
    { $set: { mapName } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const payload = {
    tournamentId: String(req.tournamentId),
    ...serialize(doc),
  };

  req.app.io?.to(`t_${req.tournamentId}`).emit("round_info_updated", payload);
  req.app.io?.emit("round_info_updated", payload);

  res.status(200).json(new ApiResponse(200, serialize(doc), "Round info saved"));
});
