import { Tournament } from "../models/tournament.model.js";
import { Team } from "../models/team.model.js";
import { getScoringConfig } from "./scoring.helper.js";
import { serializeBroadcast } from "../controllers/broadcast.controller.js";

const emitBroadcast = (req, tournament) => {
  const payload = serializeBroadcast(tournament);
  req.app.io?.to(`t_${tournament._id}`).emit("broadcast_updated", payload);
  req.app.io?.emit("broadcast_updated", payload);
};

/**
 * Show the last surviving team on the winner overlay for the live round.
 * Once an operator edits the winner manually, `winner.auto` becomes false and
 * automatic updates stay out of the way until the auto state is re-enabled.
 */
export const syncAutoWinner = async (req, roundNumber) => {
  const tournament = await Tournament.findById(req.tournamentId);
  if (!tournament) return null;

  const activeRound = Number(tournament.activeRound) || 0;
  if (!activeRound || Number(roundNumber) !== activeRound) return null;

  if (!tournament.broadcast) tournament.broadcast = {};
  if (!tournament.broadcast.winner) tournament.broadcast.winner = {};
  const winner = tournament.broadcast.winner;

  // A manual edit (show or hide) owns the overlay from then on.
  if (winner.auto === false) return null;

  const scoring = getScoringConfig(tournament);
  const fullCount = scoring.fullEliminationCount;
  const teams = await Team.find({
    tournamentId: tournament._id,
    "rounds.roundNumber": activeRound,
  })
    .select("_id name rounds")
    .lean();

  const participants = teams
    .map((team) => ({
      team,
      round: team.rounds.find((item) => item.roundNumber === activeRound),
    }))
    .filter((item) => item.round);

  const alive = participants.filter(
    (item) => Number(item.round.eliminationCount) < fullCount
  );

  let changed = false;
  if (participants.length >= 2 && alive.length === 1) {
    const lastTeam = alive[0].team;
    const sameTeam =
      winner.visible &&
      winner.auto === true &&
      String(winner.teamId) === String(lastTeam._id);
    if (!sameTeam) {
      winner.visible = true;
      winner.teamId = lastTeam._id;
      winner.auto = true;
      changed = true;
    }
  } else if (winner.auto === true && winner.visible) {
    // A revive (or another elimination) means the round is no longer decided.
    winner.visible = false;
    changed = true;
  }

  if (!changed) return null;

  await tournament.save();
  emitBroadcast(req, tournament);
  return tournament;
};
