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
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", getAllTeams);
router.get("/match/:roundNumber", getTeamsByRound);
router.post("/points", requireAdmin, updateRoundPositions);
router.post("/bulk", requireAdmin, createBulkTeams);
router.post("/", requireAdmin, upload.single("logo"), createTeam);
router.put("/:teamId", requireAdmin, upload.single("logo"), updateTeam);
router.put("/:teamId/kills", requireAdmin, updateKills);
router.put("/:teamId/elimination", requireAdmin, handleElimination);
router.post("/rounds", requireAdmin, createRound);
router.delete("/:teamId", requireAdmin, deleteTeam);
router.post("/:teamId/add-kill", requireAdmin, addKill);
router.post("/:teamId/decrease-kill", requireAdmin, decreaseKill);
router.delete("/rounds/delete", requireAdmin, deleteRoundFromTeams);


export default router;
