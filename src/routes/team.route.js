import {Router} from "express";
import {
  createRound,
  createTeam,
  handleElimination,
  updateKills,
  getAllTeams,
  deleteTeam,
} from "../controllers/team.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.get("/", getAllTeams);
router.post("/", upload.single("logo"), createTeam);
router.put("/:teamId/kills", updateKills);
router.put("/:teamId/elimination", handleElimination);
router.post("/rounds", createRound);
router.delete("/:teamId", deleteTeam);

export default router;
