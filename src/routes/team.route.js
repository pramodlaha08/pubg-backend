import express from "express";
import {
  addRound,
  createTeam,
  handleElimination,
  updateKills,
  updatePosition,
} from "../controllers/team.controller.js";
import upload from "../middlewares/upload.middleware.js";

const router = express.Router();

router.post("/", upload.single("logo"), createTeam);
router.put("/:id/kills", updateKills);
router.put("/:id/position", updatePosition);
router.put("/:id/elimination", handleElimination);
router.post("/rounds", addRound);

export default router;
