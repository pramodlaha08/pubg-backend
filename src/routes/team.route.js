import {Router} from "express";
import {
  createRound,
  createTeam,
  createBulkTeams,
  handleElimination,
  updateKills,
  getAllTeams,
  deleteTeam,
  updateTeam,
  updateRoundPositions,
  addKill,
  decreaseKill,
  deleteRoundFromTeams,
  getTeamsByRound
} from "../controllers/team.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
  requireAdmin,
  requireScorer,
} from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getAllTeams);
router.get("/match/:roundNumber", getTeamsByRound);
router.post("/points", requireScorer, updateRoundPositions);
router.post("/bulk", requireAdmin, createBulkTeams);
router.post("/", requireAdmin, upload.single("logo"), createTeam);
router.put("/:teamId", requireAdmin, upload.single("logo"), updateTeam);
router.put("/:teamId/kills", requireScorer, updateKills);
router.put("/:teamId/elimination", requireScorer, handleElimination);
router.post("/rounds", requireScorer, createRound);
router.delete("/:teamId", requireAdmin, deleteTeam);
router.post("/:teamId/add-kill", requireScorer, addKill);
router.post("/:teamId/decrease-kill", requireScorer, decreaseKill);
router.delete("/rounds/delete", requireScorer, deleteRoundFromTeams);


export default router;
