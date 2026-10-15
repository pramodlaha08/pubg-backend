// Pure, side-effect-free projection of what an "apply verified results" run
// would do to the leaderboard. Used to show a before/after preview WITHOUT
// writing anything to the database.

const roundTotal = (kills, position, scoring) =>
  (Number(kills) || 0) * scoring.killPointMultiplier +
  scoring.positionPointsFor(position);

const teamTotal = (rounds, scoring) =>
  (rounds || []).reduce(
    (sum, round) => sum + roundTotal(round.kills, round.position, scoring),
    0
  );

const rankMap = (rows, key) => {
  const ranked = [...rows].sort(
    (a, b) => b[key] - a[key] || a.slot - b.slot
  );
  return new Map(ranked.map((row, index) => [row.teamId, index + 1]));
};

/**
 * @param {object}      args
 * @param {Array}       args.teams       Team lean docs (need _id, slot, name, rounds[])
 * @param {number}      args.roundNumber Round being verified
 * @param {Array}       args.verified    [{ slot, kills|null, position|null }]
 * @param {object}      args.scoring     Result of getScoringConfig()
 */
export const previewPointsImpact = ({ teams, roundNumber, verified, scoring }) => {
  const bySlot = new Map(teams.map((team) => [Number(team.slot), team]));
  const updates = new Map();
  const skipped = [];

  for (const entry of verified || []) {
    const slot = Number(entry?.slot);
    const team = bySlot.get(slot);
    if (!team) {
      skipped.push({ slot, reason: "No team registered for this slot" });
      continue;
    }
    const hasKills = entry.kills !== null && entry.kills !== undefined;
    const hasPosition = entry.position !== null && entry.position !== undefined;
    if (!hasKills && !hasPosition) continue;
    updates.set(String(team._id), {
      hasKills,
      hasPosition,
      kills: entry.kills,
      position: entry.position,
    });
  }

  const rows = teams.map((team) => {
    const teamId = String(team._id);
    const update = updates.get(teamId);

    const rounds = (team.rounds || []).map((round) => ({
      roundNumber: round.roundNumber,
      kills: Number(round.kills) || 0,
      position: Number(round.position) || 0,
    }));
    const existing = rounds.find((round) => round.roundNumber === roundNumber);

    const currentKills = existing ? existing.kills : 0;
    const currentPosition = existing ? existing.position : 0;
    const currentTotal = teamTotal(rounds, scoring);

    let newKills = currentKills;
    let newPosition = currentPosition;
    let projectedTotal = currentTotal;

    if (update) {
      if (update.hasKills) newKills = Math.max(0, Number(update.kills) || 0);
      if (update.hasPosition) {
        newPosition = Math.max(0, Number(update.position) || 0);
      }
      let target = rounds.find((round) => round.roundNumber === roundNumber);
      if (!target) {
        target = { roundNumber, kills: 0, position: 0 };
        rounds.push(target);
      }
      target.kills = newKills;
      target.position = newPosition;
      projectedTotal = teamTotal(rounds, scoring);
    }

    return {
      teamId,
      name: team.name,
      slot: team.slot,
      currentKills,
      currentPosition,
      newKills,
      newPosition,
      currentKillPoints: currentKills * scoring.killPointMultiplier,
      currentPositionPoints: scoring.positionPointsFor(currentPosition),
      newKillPoints: newKills * scoring.killPointMultiplier,
      newPositionPoints: scoring.positionPointsFor(newPosition),
      currentTotal,
      projectedTotal,
      delta: projectedTotal - currentTotal,
      targeted: Boolean(update),
    };
  });

  const currentRanks = rankMap(rows, "currentTotal");
  const projectedRanks = rankMap(rows, "projectedTotal");

  const withRanks = rows.map((row) => {
    const currentRank = currentRanks.get(row.teamId);
    const projectedRank = projectedRanks.get(row.teamId);
    return {
      ...row,
      currentRank,
      projectedRank,
      rankDelta: currentRank - projectedRank,
    };
  });

  const changes = withRanks
    .filter((row) => row.targeted)
    .sort((a, b) => a.slot - b.slot);

  const leaderboard = [...withRanks].sort(
    (a, b) => a.projectedRank - b.projectedRank
  );

  return {
    roundNumber,
    changes,
    skipped,
    leaderboard,
    killPointMultiplier: scoring.killPointMultiplier,
  };
};

export default previewPointsImpact;
