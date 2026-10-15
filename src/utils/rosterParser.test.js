// Basic unit tests for the screenshot auto-scoring logic.
// Run with: npm test   (node --test)
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeName,
  canonicalName,
  nameSimilarity,
  levenshtein,
  similarity,
  parseLobbyText,
  parseResultsText,
  extractEntries,
  matchPlayers,
  aggregateResults,
  buildComparison,
  buildMapping,
  buildResultsMapping,
  mergeRosterEntries,
  snapNamesToRoster,
  decideApply,
} from "./rosterParser.helper.js";
import { getScoringConfig } from "./scoring.helper.js";

const teams = [
  { _id: "t1", slot: 12, name: "AlphaSquad" },
  { _id: "t2", slot: 7, name: "BravoKings" },
  { _id: "t3", slot: 3, name: "CharlieX" },
];

test("normalizeName strips case, spaces and punctuation", () => {
  assert.equal(normalizeName("  Alpha Squad!! "), "alphasquad");
  assert.equal(normalizeName("ＫＩＮＧ"), "king");
});

test("levenshtein + similarity behave sensibly", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("same", "same"), 0);
  assert.equal(similarity("AlphaSquad", "alphasquad"), 1);
  assert.ok(similarity("BravoKings", "Bravo Kngs") > 0.8);
  assert.ok(similarity("AlphaSquad", "Zulu") < 0.4);
});

test("canonicalName folds leet-speak for gamer tags", () => {
  assert.equal(canonicalName("5n1p3r"), "sniper");
  assert.equal(canonicalName("K1NG"), "king");
  assert.equal(canonicalName("Z3R0"), "zero");
});

test("nameSimilarity matches across leet and letter spellings", () => {
  assert.equal(nameSimilarity("5n1p3r", "sniper"), 1);
  assert.ok(nameSimilarity("K1NG", "KING") >= 0.99);
  assert.ok(nameSimilarity("AlphaSquad", "Alpha Squad") >= 0.99);
});

test("matchPlayers uses remembered aliases with full confidence", () => {
  const aliases = new Map([
    ["deltasquad", { teamId: "t1", name: "DeltaSquad" }],
  ]);
  const result = matchPlayers(
    [{ slot: null, name: "DELTA5QUAD" }],
    teams,
    aliases
  );
  assert.equal(result[0].status, "matched");
  assert.equal(result[0].teamId, "t1");
  assert.equal(result[0].source, "memory");
  assert.equal(result[0].confidence, 1);
});

test("matchPlayers flags fuzzy (non-memory) matches with fuzzy source", () => {
  const result = matchPlayers([{ slot: 12, name: "AlphaSquad" }], teams, new Map());
  assert.equal(result[0].source, "fuzzy");
});

test("parseLobbyText extracts multiple slot/name entries per line", () => {
  const entries = parseLobbyText(
    "SLOT 12 AlphaOne 10 eliminations SLOT 7 BravoTwo 0 minions SLOT 3 CharlieThree 2 eiminations"
  );
  assert.deepEqual(entries[0], { slot: 12, name: "AlphaOne" });
  assert.deepEqual(entries[1], { slot: 7, name: "BravoTwo" });
  assert.deepEqual(entries[2], { slot: 3, name: "CharlieThree" });
});

test("extractEntries handles a kill count glued to the eliminations label", () => {
  const entries = extractEntries("AlphaOne /0eliminations BravoTwo /10eliminations");
  assert.equal(entries[0].name, "AlphaOne");
  assert.equal(entries[0].kills, 0);
  assert.equal(entries[1].name, "BravoTwo");
  assert.equal(entries[1].kills, 10);
});

test("extractEntries recovers names with clan tags and decorated slots", () => {
  const entries = extractEntries("[]3 | CharlieThree /0 minions £4 DeltaFour /1 eliminations");
  assert.equal(entries[0].slot, 3);
  assert.equal(entries[0].name, "CharlieThree");
  assert.equal(entries[1].slot, 4);
  assert.equal(entries[1].name, "DeltaFour");
  assert.equal(entries[1].kills, 1);
});

test("parseResultsText separates team rows (rank) from player rows", () => {
  const rows = parseResultsText(
    "#1 AlphaOne 12 eliminations PlayerZulu 5 eliminations #2 BravoTwo 8 minions"
  );
  assert.deepEqual(rows[0], { rank: 1, name: "AlphaOne", kills: 12 });
  assert.deepEqual(rows[1], { rank: null, name: "PlayerZulu", kills: 5 });
  assert.deepEqual(rows[2], { rank: 2, name: "BravoTwo", kills: 8 });
});

test("matchPlayers: exact, fuzzy, ambiguous and unmatched", () => {
  const entries = [
    { slot: 12, name: "AlphaSquad" },
    { slot: 7, name: "Bravo Kngs" },
    { slot: 3, name: "Something Else" },
    { slot: null, name: "Random Name" },
  ];
  const result = matchPlayers(entries, teams);

  assert.equal(result[0].status, "matched");
  assert.equal(result[0].teamId, "t1");

  assert.equal(result[1].status, "matched");
  assert.equal(result[1].teamId, "t2");

  // No strong name match, but the slot maps to a team -> matched by slot.
  assert.equal(result[2].status, "matched");
  assert.equal(result[2].teamId, "t3");
  assert.equal(result[2].source, "slot");

  assert.equal(result[3].status, "unmatched");
  assert.equal(result[3].teamId, null);
});

test("aggregateResults sums individual eliminations into team kills", () => {
  const rosterPlayers = [
    { name: "PlayerOne", teamId: "t1" },
    { name: "PlayerTwo", teamId: "t2" },
  ];
  const resultRows = [
    { rank: null, name: "PlayerOne", kills: 5 },
    { rank: null, name: "PlayerTwo", kills: 3 },
    { rank: null, name: "PlayerOne", kills: 2 },
    { rank: null, name: "Stranger", kills: 9 },
  ];

  const { teamKills, unmatched } = aggregateResults({
    rosterPlayers,
    teams,
    resultRows,
  });

  assert.equal(teamKills.get("t1"), 7);
  assert.equal(teamKills.get("t2"), 3);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].name, "Stranger");
});

test("aggregateResults sums per-player rows that each carry the team rank", () => {
  const rosterPlayers = [
    { name: "PlayerOne", teamId: "t1" },
    { name: "PlayerTwo", teamId: "t1" },
    { name: "PlayerThree", teamId: "t2" },
  ];
  const resultRows = [
    { rank: 1, name: "PlayerOne", kills: 10 },
    { rank: 1, name: "PlayerTwo", kills: 4 },
    { rank: 2, name: "PlayerThree", kills: 3 },
  ];
  const { teamKills, teamPosition } = aggregateResults({
    rosterPlayers,
    teams,
    resultRows,
  });

  assert.equal(teamKills.get("t1"), 14);
  assert.equal(teamKills.get("t2"), 3);
  assert.equal(teamPosition.get("t1"), 1);
  assert.equal(teamPosition.get("t2"), 2);
});

test("aggregateResults matches rows by team label without a roster", () => {
  const rows = [
    { rank: 1, name: "Ghost", kills: 9, teamName: "Alpha Squad" },
    { rank: 1, name: "Ranger", kills: 5, teamName: "Alpha Squad" },
    { rank: 2, name: "Viper", kills: 7, teamName: "Bravo Kings" },
  ];
  const { teamKills, teamPosition, unmatched } = aggregateResults({
    rosterPlayers: [],
    teams,
    resultRows: rows,
  });

  assert.equal(unmatched.length, 0);
  assert.equal(teamKills.get("t1"), 14);
  assert.equal(teamKills.get("t2"), 7);
  assert.equal(teamPosition.get("t1"), 1);
  assert.equal(teamPosition.get("t2"), 2);
});

test("aggregateResults uses team rows for kills and placement", () => {
  const resultRows = [
    { rank: 1, name: "AlphaSquad", kills: 12 },
    { rank: 2, name: "BravoKings", kills: 8 },
  ];
  const { teamKills, teamPosition } = aggregateResults({
    rosterPlayers: [],
    teams,
    resultRows,
  });

  assert.equal(teamKills.get("t1"), 12);
  assert.equal(teamKills.get("t2"), 8);
  assert.equal(teamPosition.get("t1"), 1);
  assert.equal(teamPosition.get("t2"), 2);
});

test("aggregateResults matches rows by team slot when provided", () => {
  const resultRows = [
    { slot: 12, name: "MisreadOne", kills: 4, rank: 1 },
    { slot: 12, name: "MisreadTwo", kills: 3, rank: 1 },
    { slot: 7, name: "OtherTeamGuy", kills: 5, rank: 2 },
  ];
  const { teamKills, teamPosition, unmatched } = aggregateResults({
    rosterPlayers: [],
    teams,
    resultRows,
  });

  assert.equal(teamKills.get("t1"), 7);
  assert.equal(teamPosition.get("t1"), 1);
  assert.equal(teamKills.get("t2"), 5);
  assert.equal(teamPosition.get("t2"), 2);
  assert.equal(unmatched.length, 0);
});

test("buildComparison reconciles verified results against live scores", () => {
  const scoring = getScoringConfig({
    scoring: { positionPoints: { 1: 10, 2: 6, 3: 5 } },
  });

  const liveTeams = [
    { _id: "t1", slot: 12, name: "AlphaSquad", round: { kills: 5, position: 1 } },
    { _id: "t2", slot: 7, name: "BravoKings", round: { kills: 8, position: 2 } },
    { _id: "t3", slot: 3, name: "CharlieX", round: { kills: 1, position: 3 } },
  ];

  const teamKills = new Map([
    ["t1", 7],
    ["t2", 8],
  ]);
  const teamPosition = new Map([
    ["t1", 1],
    ["t2", 2],
  ]);

  const rows = buildComparison({
    teams: liveTeams,
    teamKills,
    teamPosition,
    scoring,
  });

  const t1 = rows.find((r) => r.teamId === "t1");
  assert.equal(t1.liveKills, 5);
  assert.equal(t1.verifiedKills, 7);
  assert.equal(t1.livePlacementPoints, 10);
  assert.equal(t1.verifiedPlacementPoints, 10);
  assert.equal(t1.status, "mismatch");

  const t2 = rows.find((r) => r.teamId === "t2");
  assert.equal(t2.status, "match");

  const t3 = rows.find((r) => r.teamId === "t3");
  assert.equal(t3.status, "unmatched");
  assert.equal(t3.verifiedKills, null);
});

test("mergeRosterEntries preserves saved mappings and only fills unmatched", () => {
  const existing = [
    { name: "SavedOne", slot: 2, teamId: "t1", normalized: "savedone" },
    { name: "SavedTwo", slot: 3, teamId: null, normalized: "savedtwo" },
  ];
  const ocr = [
    // already assigned -> keep the saved team, do not overwrite
    { name: "SAVEDONE", slot: 2, teamId: "t2", status: "matched", source: "slot", canonical: "savedone" },
    // previously unmatched -> fill from OCR
    { name: "SavedTwo", slot: 3, teamId: "t3", status: "matched", source: "slot", canonical: "savedtwo" },
    // brand new player -> appended
    { name: "NewGuy", slot: 4, teamId: "t4", status: "matched", source: "slot", canonical: "newguy" },
  ];

  const merged = mergeRosterEntries(existing, ocr);
  const byName = new Map(merged.map((m) => [m.name.toLowerCase(), m]));

  assert.equal(merged.length, 3);
  assert.equal(byName.get("savedone").teamId, "t1");
  assert.equal(byName.get("savedone").origin, "existing");
  assert.equal(byName.get("savedtwo").teamId, "t3");
  assert.equal(byName.get("savedtwo").origin, "updated");
  assert.equal(byName.get("newguy").origin, "new");
});

test("mergeRosterEntries keeps unmatched existing players when OCR misses them", () => {
  const existing = [{ name: "Ghost", slot: null, teamId: null, normalized: "ghost" }];
  const merged = mergeRosterEntries(existing, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "unmatched");
  assert.equal(merged[0].origin, "existing");
});

test("buildMapping groups players by team and lists the unassigned", () => {
  const entries = [
    { name: "A", teamId: "t1" },
    { name: "B", teamId: "t1" },
    { name: "C", teamId: "t2" },
    { name: "D", teamId: null },
  ];
  const { teams: groups, unassigned } = buildMapping(entries, teams);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find((g) => g.teamId === "t1").players, ["A", "B"]);
  assert.deepEqual(unassigned, ["D"]);
});

test("buildResultsMapping attaches roster players to comparison rows", () => {
  const rosterPlayers = [
    { name: "A", teamId: "t1" },
    { name: "B", teamId: "t1" },
    { name: "C", teamId: "t2" },
  ];
  const comparison = [
    { teamId: "t1", slot: 1, name: "Alpha", verifiedKills: 5, verifiedPosition: 1, status: "match" },
    { teamId: "t2", slot: 2, name: "Bravo", verifiedKills: null, verifiedPosition: null, status: "unmatched" },
  ];
  const mapping = buildResultsMapping({ rosterPlayers, comparison });
  assert.deepEqual(mapping[0].players, ["A", "B"]);
  assert.equal(mapping[0].verifiedKills, 5);
  assert.deepEqual(mapping[1].players, ["C"]);
});

test("decideApply blocks duplicate uploads unless forced", () => {
  const existing = { imageHash: "abc123", status: "applied" };

  assert.equal(decideApply({ existing, imageHash: "abc123" }).blocked, true);
  assert.equal(
    decideApply({ existing, imageHash: "abc123", force: true }).blocked,
    false
  );
  assert.equal(decideApply({ existing, imageHash: "different" }).blocked, false);
  assert.equal(decideApply({ existing: null, imageHash: "abc123" }).blocked, false);
});

test("snapNamesToRoster corrects a misread player name to the roster spelling", () => {
  const rosterPlayers = [{ name: "Aayush777", teamId: "t1" }];
  const { rows, corrected } = snapNamesToRoster(
    [{ name: "Aayush77T", kills: 4, rank: 2 }],
    rosterPlayers,
    ["AlphaSquad"]
  );
  assert.equal(corrected, 1);
  assert.equal(rows[0].name, "Aayush777");
  assert.equal(rows[0].originalName, "Aayush77T");
  assert.equal(rows[0].rosterCorrected, true);
  assert.equal(rows[0].kills, 4);
});

test("snapNamesToRoster snaps a team summary row to the team, not a player", () => {
  const rosterPlayers = [{ name: "AlphaStar", teamId: "t1" }];
  const { rows, corrected } = snapNamesToRoster(
    [{ name: "AlphaSquud", kills: 12, rank: 1 }],
    rosterPlayers,
    ["AlphaSquad"]
  );
  assert.equal(corrected, 1);
  assert.equal(rows[0].name, "AlphaSquad");
});

test("snapNamesToRoster leaves unrelated names and exact matches alone", () => {
  const rosterPlayers = [{ name: "Known", teamId: "t1" }];
  const unchanged = snapNamesToRoster(
    [{ name: "Zzzzzzzzz" }, { name: "Known" }],
    rosterPlayers,
    ["TeamX"]
  );
  assert.equal(unchanged.corrected, 0);
  assert.equal(unchanged.rows[0].name, "Zzzzzzzzz");
  assert.equal(unchanged.rows[1].name, "Known");
  assert.equal(unchanged.rows[1].rosterCorrected, undefined);
});

test("snapNamesToRoster is a no-op without a roster or teams", () => {
  const input = [{ name: "Anything" }];
  const { rows, corrected } = snapNamesToRoster(input, [], []);
  assert.equal(corrected, 0);
  assert.deepEqual(rows, input);
});

