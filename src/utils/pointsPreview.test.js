import test from "node:test";
import assert from "node:assert/strict";
import { previewPointsImpact } from "./pointsPreview.helper.js";
import { getScoringConfig } from "./scoring.helper.js";

const scoring = getScoringConfig({
  scoring: {
    killPointMultiplier: 1,
    positionPoints: { "1": 10, "2": 6, "3": 5 },
  },
});

const teams = [
  {
    _id: "a",
    slot: 1,
    name: "Alpha",
    rounds: [{ roundNumber: 1, kills: 2, position: 3 }],
  },
  {
    _id: "b",
    slot: 2,
    name: "Bravo",
    rounds: [{ roundNumber: 1, kills: 5, position: 1 }],
  },
];

test("previewPointsImpact projects changes without mutating the input", () => {
  const preview = previewPointsImpact({
    teams,
    roundNumber: 1,
    verified: [{ slot: 1, kills: 4, position: 2 }],
    scoring,
  });
  const alpha = preview.changes.find((row) => row.slot === 1);
  assert.equal(alpha.currentTotal, 7); // 2*1 + pos3(5)
  assert.equal(alpha.projectedTotal, 10); // 4*1 + pos2(6)
  assert.equal(alpha.delta, 3);
  assert.equal(teams[0].rounds[0].kills, 2);
  assert.equal(teams[0].rounds[0].position, 3);
});

test("previewPointsImpact creates a missing round for the target", () => {
  const preview = previewPointsImpact({
    teams: [{ _id: "a", slot: 1, name: "Alpha", rounds: [] }],
    roundNumber: 2,
    verified: [{ slot: 1, kills: 3, position: 1 }],
    scoring,
  });
  const alpha = preview.changes.find((row) => row.slot === 1);
  assert.equal(alpha.currentTotal, 0);
  assert.equal(alpha.projectedTotal, 13); // 3*1 + pos1(10)
});

test("previewPointsImpact reports slots with no registered team", () => {
  const preview = previewPointsImpact({
    teams: [],
    roundNumber: 1,
    verified: [{ slot: 7, kills: 1, position: 1 }],
    scoring,
  });
  assert.equal(preview.changes.length, 0);
  assert.equal(preview.skipped.length, 1);
  assert.equal(preview.skipped[0].slot, 7);
});

test("previewPointsImpact ranks the leaderboard before and after", () => {
  const preview = previewPointsImpact({
    teams,
    roundNumber: 1,
    verified: [{ slot: 1, kills: 9, position: 1 }],
    scoring,
  });
  const alpha = preview.leaderboard.find((row) => row.slot === 1);
  const bravo = preview.leaderboard.find((row) => row.slot === 2);
  assert.equal(alpha.currentRank, 2);
  assert.equal(alpha.projectedRank, 1);
  assert.equal(bravo.currentRank, 1);
  assert.equal(bravo.projectedRank, 2);
});
