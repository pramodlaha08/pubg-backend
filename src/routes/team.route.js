import {Router} from "express";
import {
  addRound,
  createTeam,
  handleElimination,
  updateKills,
  updatePosition,
  helloworld,
} from "../controllers/team.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.get("/", helloworld);
router.post("/", upload.single("logo"), createTeam);
router.put("/:id/kills", updateKills);
router.put("/:id/position", updatePosition);
router.put("/:id/elimination", handleElimination);
router.post("/rounds", addRound);

export default router;
