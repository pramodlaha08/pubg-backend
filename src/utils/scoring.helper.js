import SQUAD_CONFIG from "../config/squadSize.js";

// Fallback position -> points map used when a tournament has no explicit
// scoring configuration (or is missing an entry for a given position).
const DEFAULT_POSITION_POINTS = {
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1,
};

const toPlainPositionPoints = (raw) => {
  if (!raw) return { ...DEFAULT_POSITION_POINTS };
  if (raw instanceof Map) return Object.fromEntries(raw.entries());
  if (typeof raw.toObject === "function") return raw.toObject();
  if (typeof raw === "object") return { ...raw };
  return { ...DEFAULT_POSITION_POINTS };
};

/**
 * Resolve the effective scoring rules for a tournament, falling back to the
 * legacy defaults (hardcoded position table, 1x kill multiplier, env squad
 * size) when the tournament has not overridden them.
 */
export const getScoringConfig = (tournament) => {
  const scoring = tournament?.scoring || {};

  const rawPositionPoints = toPlainPositionPoints(scoring.positionPoints);
  const positionPoints = {};
  for (const [key, value] of Object.entries(rawPositionPoints)) {
    const position = Number(key);
    const points = Number(value);
    if (Number.isFinite(position) && Number.isFinite(points)) {
      positionPoints[String(position)] = points;
    }
  }

  const fullEliminationCount =
    Number(scoring.fullEliminationCount) > 0
      ? Number(scoring.fullEliminationCount)
      : SQUAD_CONFIG.fullEliminationCount;

  const killPointMultiplier =
    scoring.killPointMultiplier === undefined ||
    scoring.killPointMultiplier === null
      ? 1
      : Number(scoring.killPointMultiplier);

  return {
    positionPoints,
    positionPointsFor: (position) =>
      positionPoints[String(Number(position))] ?? 0,
    killPointMultiplier,
    fullEliminationCount,
    maxPlayerIndex: fullEliminationCount - 1,
    isValidPlayerIndex: (index) =>
      Number.isInteger(index) && index >= 0 && index < fullEliminationCount,
    getPlayerLabel: (index) => `P${index + 1}`,
  };
};

export const getScoringConfigFromReq = (req) =>
  getScoringConfig(req?.tournament);

/**
 * Recalculate a team's per-round killPoints / positionPoints and totalPoints
 * from the raw kills/position values using the given scoring config. This is
 * the single source of truth for scoring so incremental updates cannot drift.
 * Mutates the team document in place and returns the new total.
 */
export const recomputeTeamScores = (team, scoring) => {
  let total = 0;
  for (const round of team.rounds || []) {
    round.killPoints = (round.kills || 0) * scoring.killPointMultiplier;
    round.positionPoints = scoring.positionPointsFor(round.position);
    total += round.killPoints + round.positionPoints;
  }
  team.totalPoints = total;
  return total;
};

export default getScoringConfig;
