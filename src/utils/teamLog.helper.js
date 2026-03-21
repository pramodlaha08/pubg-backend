import { TeamLog } from "../models/teamLog.model.js";

const formatDelta = (delta) => {
  if (typeof delta !== "number") return "";
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
};

const extractRound = (team, roundNumber) => {
  if (!team || !Array.isArray(team.rounds)) return null;
  return team.rounds.find((r) => r.roundNumber === roundNumber) || null;
};

export const createTeamLogEntry = async ({
  req,
  eventType,
  severity = "info",
  team,
  roundNumber = null,
  title,
  message,
  changes = [],
  meta = {},
}) => {
  if (!team || !title || !message || !eventType) return null;

  const round = roundNumber ? extractRound(team, roundNumber) : null;

  const log = await TeamLog.create({
    eventType,
    severity,
    roundNumber,
    teamId: team._id || null,
    teamName: team.name,
    slot: team.slot,
    title,
    message,
    changes,
    totals: {
      totalPoints: team.totalPoints || 0,
      totalKillsInRound: round?.kills || 0,
      killPointsInRound: round?.killPoints || 0,
      positionPointsInRound: round?.positionPoints || 0,
      eliminationCountInRound: round?.eliminationCount || 0,
      teamStatusInRound: round?.status || "unknown",
    },
    meta,
  });

  const io = req?.app?.io;
  if (io) {
    console.log(
      `[TeamLog] Broadcasting team_log_created event: ${log.eventType} for ${log.teamName}`
    );
    io.emit("team_log_created", log);
    if (team._id) {
      io.to(`team_${team._id}`).emit("team_log_created", log);
    }
    if (roundNumber) {
      io.to(`round_${roundNumber}`).emit("team_log_created", log);
    }
  } else {
    console.warn(
      `[TeamLog] No socket.io instance available for broadcasting event`
    );
  }

  return log;
};

export const logTemplates = {
  teamCreated: ({ team }) => ({
    title: `Team Registered: ${team.name}`,
    message: `Slot ${team.slot} is now locked by ${team.name}. Opening total: ${team.totalPoints} pts.`,
  }),
  roundCreated: ({ team, roundNumber }) => ({
    title: `Round ${roundNumber} Opened for ${team.name}`,
    message: `${team.name} enters Round ${roundNumber} with a clean slate: 0 kills, 0 eliminations, 0 position points.`,
  }),
  killUpdated: ({ team, roundNumber, delta, kills }) => ({
    title: `Frag Update: ${team.name} ${formatDelta(delta)} kill(s)`,
    message: `Round ${roundNumber}: ${team.name} ${delta >= 0 ? "gains" : "loses"} ${Math.abs(delta)} kill(s). Round kills now ${kills}. Team total now ${team.totalPoints} pts.`,
  }),
  eliminationUpdated: ({
    team,
    roundNumber,
    playerIndex,
    eliminationCount,
    change,
  }) => ({
    title: `Knock State Changed: ${team.name}`,
    message: `Round ${roundNumber}: Player #${playerIndex + 1} ${change > 0 ? "knocked/eliminated" : "revived/removed"}. ${team.name} now has ${eliminationCount}/4 eliminated players.`,
  }),
  teamEliminated: ({ team, roundNumber, eliminationCount }) => ({
    title: `Team Eliminated: ${team.name}`,
    message: `Round ${roundNumber}: ${team.name} is out (${eliminationCount}/4). Final running total: ${team.totalPoints} pts.`,
  }),
  positionUpdated: ({
    team,
    roundNumber,
    previousPosition,
    currentPosition,
    pointsDelta,
  }) => ({
    title: `Placement Update: ${team.name}`,
    message: `Round ${roundNumber}: position ${previousPosition || "N/A"} -> ${currentPosition}. Position points ${formatDelta(pointsDelta)}. Total now ${team.totalPoints} pts.`,
  }),
  roundDeleted: ({ team, roundNumber, deductedPoints }) => ({
    title: `Round ${roundNumber} Removed for ${team.name}`,
    message: `Round ${roundNumber} data cleared. ${deductedPoints} pts rolled back. Team total adjusted to ${team.totalPoints} pts.`,
  }),
  teamDeleted: ({ team }) => ({
    title: `Team Removed: ${team.name}`,
    message: `${team.name} (Slot ${team.slot}) removed from tournament table. Last known total was ${team.totalPoints} pts.`,
  }),
};
