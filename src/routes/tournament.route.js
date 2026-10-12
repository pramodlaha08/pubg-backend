import { Router } from "express";
import {
  listTournaments,
  getTournament,
  createTournament,
  updateTournament,
  activateTournament,
  archiveTournament,
  cloneTournament,
  setDefaultTournament,
  deleteTournament,
} from "../controllers/tournament.controller.js";
import { requireAdmin } from "../middlewares/requireAdmin.middleware.js";

const router = Router();

router.get("/", listTournaments);
router.post("/", requireAdmin, createTournament);
router.get("/:tournamentId", getTournament);
router.put("/:tournamentId", requireAdmin, updateTournament);
router.post("/:tournamentId/activate", requireAdmin, activateTournament);
router.post("/:tournamentId/archive", requireAdmin, archiveTournament);
router.post("/:tournamentId/clone", requireAdmin, cloneTournament);
router.post("/:tournamentId/set-default", requireAdmin, setDefaultTournament);
router.delete("/:tournamentId", requireAdmin, deleteTournament);

export default router;
