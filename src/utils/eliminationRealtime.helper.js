import { EliminationNotification } from "../models/eliminationNotification.model.js";
import { Team } from "../models/team.model.js";
import SQUAD_CONFIG from "../config/squadSize.js";

const debugMode = process.env.DEBUG_MODE === "true";

const buildSocketPayload = (doc) => ({
  id: String(doc._id),
  teamId: String(doc.teamId),
  teamName: doc.teamName,
  teamLogo: doc.teamLogo || "",
  roundNumber: doc.roundNumber,
  status: doc.status,
  killCount: doc.killCount || 0,
  position: doc.position || 0,
  eliminationOrder: doc.eliminationOrder || 0,
  updatedAt: doc.updatedAt,
});

/**
 * Recalculate elimination order for a round.
 * Backward numbering is based on total participating teams in that round.
 * Example for 3 teams: first eliminated #3, second #2, third #1.
 */
const recalculateEliminationOrder = async (roundNumber) => {
  const totalTeamsInRound = await Team.countDocuments({
    rounds: { $elemMatch: { roundNumber } },
  });

  // Find ONLY teams that are eliminated in this round, sorted by time
  const eliminated = await EliminationNotification.find({
    roundNumber,
    status: "eliminated",
  }).sort({ eliminatedAt: 1, createdAt: 1, _id: 1 });

  const totalEliminated = eliminated.length;
  const baseline = Math.max(totalTeamsInRound, totalEliminated);

  if (debugMode) {
    console.log(
      `[ELIMINATION_ORDER] Round ${roundNumber}: totalTeams=${totalTeamsInRound}, eliminated=${totalEliminated}`
    );
  }

  // Assign order numbers: 1st eliminated gets highest number
  const bulkOps = eliminated.map((doc, index) => {
    const eliminationOrder = Math.max(1, baseline - index);

    if (debugMode) {
      console.log(
        `[ELIMINATION_ORDER] Team "${doc.teamName}": position ${index + 1}/${totalEliminated} = #${eliminationOrder}`
      );
    }

    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { eliminationOrder } },
      },
    };
  });

  // Update all eliminated teams with their new order
  if (bulkOps.length > 0) {
    await EliminationNotification.bulkWrite(bulkOps);
  }

  // Return snapshot sorted by elimination order (highest first)
  const snapshot = await EliminationNotification.find({ roundNumber })
    .sort({ eliminationOrder: -1 })
    .lean();

  if (debugMode) {
    console.log(
      `[ELIMINATION_ORDER] Final snapshot:`,
      snapshot.map((s) => ({
        team: s.teamName,
        order: s.eliminationOrder,
        status: s.status,
      }))
    );
  }

  return snapshot.map(buildSocketPayload);
};

/**
 * Sync elimination state: creates record when eliminated, deletes when revived
 * This provides the backend with proper tracking of eliminated teams per round
 */
export const syncEliminationRealtime = async ({ req, team, round }) => {
  if (!req?.app?.io || !team || !round) return null;

  const isEliminated =
    round.eliminationCount >= SQUAD_CONFIG.fullEliminationCount;
  const nextStatus = isEliminated ? "eliminated" : "alive";

  const existing = await EliminationNotification.findOne({
    teamId: team._id,
    roundNumber: round.roundNumber,
  });

  const previousStatus = existing?.status || "alive";
  const transitioned = previousStatus !== nextStatus;

  if (debugMode) {
    console.log(
      `[SYNC_ELIMINATION] Team: "${team.name}", Round: ${round.roundNumber}`
    );
    console.log(`  Status: ${previousStatus} -> ${nextStatus}`);
    console.log(`  Transitioned: ${transitioned}`);
  }

  let notification;
  let action = "updated";

  if (transitioned) {
    if (nextStatus === "eliminated") {
      // Team just got fully eliminated: CREATE record with timestamp
      action = "eliminated";
      notification = await EliminationNotification.findOneAndUpdate(
        { teamId: team._id, roundNumber: round.roundNumber },
        {
          $set: {
            teamId: team._id,
            teamName: team.name,
            teamLogo: team.logo || "",
            roundNumber: round.roundNumber,
            status: "eliminated",
            eliminatedAt: new Date(),
            killCount: round.kills || 0,
            position: round.position || 0,
            eliminationOrder: 0, // Will be set by recalculation
          },
        },
        { upsert: true, new: true }
      );

      if (debugMode) {
        console.log(`  Action: ELIMINATED (record created)`);
      }
    } else if (nextStatus === "alive") {
      // Team was revived: DELETE the elimination record (toggle system)
      action = "alive";
      await EliminationNotification.deleteOne({
        teamId: team._id,
        roundNumber: round.roundNumber,
      });

      // Keep a synthetic alive payload so clients can remove queue items safely.
      notification = {
        _id: `${team._id}-${round.roundNumber}-alive`,
        teamId: team._id,
        teamName: team.name,
        teamLogo: team.logo || "",
        roundNumber: round.roundNumber,
        status: "alive",
        killCount: round.kills || 0,
        position: round.position || 0,
        eliminationOrder: 0,
        updatedAt: new Date(),
      };

      if (debugMode) {
        console.log(`  Action: REVIVED (record deleted)`);
      }
    }
  } else {
    // No status change, just update stats
    action = "updated";
    notification = await EliminationNotification.findOneAndUpdate(
      { teamId: team._id, roundNumber: round.roundNumber },
      {
        $set: {
          killCount: round.kills || 0,
          position: round.position || 0,
        },
      },
      { new: true }
    );

    if (debugMode) {
      console.log(`  Action: UPDATED (stats only)`);
    }
  }

  // Recalculate elimination order for all eliminated teams in this round
  // This ensures correct backward numbering based on actual eliminations
  const roundSnapshot = await recalculateEliminationOrder(round.roundNumber);

  // Always emit notification with recalculated order when available.
  if (action !== "alive" && notification?._id) {
    const recalculated = await EliminationNotification.findById(
      notification._id
    ).lean();
    if (recalculated) {
      notification = recalculated;
    }
  }

  // Build payload for socket broadcast
  const payload = {
    eventId: `${String(notification?._id || team._id)}-${Date.now()}`,
    action,
    notification: buildSocketPayload(notification),
  };

  if (debugMode) {
    console.log(
      `  Broadcasting elimination_state_changed with action: ${action}`
    );
  }

  const io = req.app.io;
  io.emit("elimination_state_changed", payload);
  io.to(`round_${round.roundNumber}`).emit(
    "elimination_state_changed",
    payload
  );

  io.emit("elimination_order_snapshot", {
    roundNumber: round.roundNumber,
    items: roundSnapshot,
  });
  io.to(`round_${round.roundNumber}`).emit("elimination_order_snapshot", {
    roundNumber: round.roundNumber,
    items: roundSnapshot,
  });

  return payload;
};

/**
 * Flush elimination records for a specific round
 * Called when a new round is created to clear out old elimination data
 */
export const flushEliminationRecords = async (roundNumber) => {
  try {
    const result = await EliminationNotification.deleteMany({
      roundNumber,
    });

    if (debugMode) {
      console.log(
        `[FLUSH_ELIMINATION] Round ${roundNumber}: Deleted ${result.deletedCount} records`
      );
    }

    return result.deletedCount;
  } catch (error) {
    console.error(
      `[FLUSH_ELIMINATION] Error flushing round ${roundNumber}:`,
      error.message
    );
    return 0;
  }
};

export const getEliminationSnapshot = async (roundNumber = null) => {
  const query = {};
  if (Number.isFinite(Number(roundNumber))) {
    query.roundNumber = Number(roundNumber);
  }

  const items = await EliminationNotification.find(query)
    .sort({ roundNumber: 1, eliminationOrder: -1 })
    .lean();

  return items.map(buildSocketPayload);
};
