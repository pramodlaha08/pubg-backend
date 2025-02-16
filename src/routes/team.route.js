import {Router} from "express";
import {
  createRound,
  createTeam,
  handleElimination,
  updateKills,
  getAllTeams,
  deleteTeam,
  updateRoundPositions,
  addKill,
  decreaseKill,
  deleteRoundFromTeams
} from "../controllers/team.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.get("/", getAllTeams);
router.post("/points", updateRoundPositions);
router.post("/", upload.single("logo"), createTeam);
router.put("/:teamId/kills", updateKills);
router.put("/:teamId/elimination", handleElimination);
router.post("/rounds", createRound);
router.delete("/:teamId", deleteTeam);
router.post("/:teamId/add-kill", addKill);
router.post("/:teamId/decrease-kill", decreaseKill);
router.delete("/rounds/delete", deleteRoundFromTeams)


export default router;
