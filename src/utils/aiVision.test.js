import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAiPlayers,
  buildVisionPrompt,
  isAiVisionEnabled,
} from "./aiVision.helper.js";

test("ai vision is disabled by default", () => {
  assert.equal(isAiVisionEnabled(), false);
});

test("buildVisionPrompt embeds the strict JSON shape and rules", () => {
  const prompt = buildVisionPrompt("results");
  assert.match(prompt, /"players"/);
  assert.match(prompt, /\[\["name",kills,rank,"teamName"\]\]/);
  assert.match(prompt, /Never invent players/);
});

test("buildVisionPrompt uses the compact lobby tuple shape", () => {
  const prompt = buildVisionPrompt("lobby");
  assert.match(prompt, /\[\["name",slot,"teamName"\]\]/);
  assert.match(prompt, /LARGE, COLORED team slot number/i);
});

test("buildVisionPrompt lists known teams and players for results", () => {
  const prompt = buildVisionPrompt("results", {
    knownTeams: ["Alpha Esports", "Bravo Kings"],
    knownPlayers: [{ name: "Ghost", teamName: "Alpha Esports" }],
  });
  assert.match(prompt, /Teams: Alpha Esports, Bravo Kings/);
  assert.match(prompt, /Players: Ghost \(Alpha Esports\)/);
});

test("buildVisionPrompt omits reference lists when none are provided", () => {
  const prompt = buildVisionPrompt("results");
  assert.doesNotMatch(prompt, /Reference lists/);
});

test("parseAiPlayers normalizes a JSON string payload", () => {
  const raw =
    '{"players":[{"name":"Alpha Squad","slot":"12","kills":7,"rank":1}]}';
  const players = parseAiPlayers(raw, "results");
  assert.deepEqual(players, [
    { name: "Alpha Squad", slot: 12, kills: 7, rank: 1, teamName: null },
  ]);
});

test("parseAiPlayers strips markdown fences and whitespace", () => {
  const raw =
    "```json\n{\"players\":[{\"name\":\"  Bravo   Kings \",\"slot\":3}]}\n```";
  const players = parseAiPlayers(raw, "lobby");
  assert.equal(players.length, 1);
  assert.equal(players[0].name, "Bravo Kings");
  assert.equal(players[0].slot, 3);
});

test("parseAiPlayers forces kills/rank to null for lobby screenshots", () => {
  const raw =
    '{"players":[{"name":"Charlie","slot":5,"kills":9,"rank":2}]}';
  const players = parseAiPlayers(raw, "lobby");
  assert.equal(players[0].kills, null);
  assert.equal(players[0].rank, null);
});

test("parseAiPlayers drops junk names and non-numeric values", () => {
  const raw = JSON.stringify({
    players: [
      { name: "x", slot: 1 },
      { name: "", slot: 2 },
      { name: "Delta!", slot: "n/a", kills: "abc" },
    ],
  });
  const players = parseAiPlayers(raw, "results");
  assert.equal(players.length, 1);
  assert.equal(players[0].name, "Delta!");
  assert.equal(players[0].slot, null);
  assert.equal(players[0].kills, null);
});

test("parseAiPlayers tolerates an array payload and invalid JSON", () => {
  assert.equal(parseAiPlayers([{ name: "Echo", slot: 4 }], "lobby").length, 1);
  assert.deepEqual(parseAiPlayers("not json at all", "lobby"), []);
});

test("parseAiPlayers reads the compact tuple form (lobby)", () => {
  const players = parseAiPlayers('{"players":[["Foxtrot",7],["Golf",null]]}', "lobby");
  assert.deepEqual(players, [
    { name: "Foxtrot", slot: 7, kills: null, rank: null, teamName: null },
    { name: "Golf", slot: null, kills: null, rank: null, teamName: null },
  ]);
});

test("parseAiPlayers reads the compact tuple form (results)", () => {
  const players = parseAiPlayers(
    '{"players":[["Hotel",12,3],["India","n/a",5]]}',
    "results"
  );
  assert.deepEqual(players, [
    { name: "Hotel", slot: null, kills: 12, rank: 3, teamName: null },
    { name: "India", slot: null, kills: null, rank: 5, teamName: null },
  ]);
});

test("parseAiPlayers reads the team-aware results tuple form", () => {
  const players = parseAiPlayers(
    '{"players":[["Alpha",10,1,"DZx"],["Bravo",0,1,"DZx"],["Charlie",3,2,"RDx"]]}',
    "results"
  );
  assert.deepEqual(players, [
    { name: "Alpha", slot: null, kills: 10, rank: 1, teamName: "DZx" },
    { name: "Bravo", slot: null, kills: 0, rank: 1, teamName: "DZx" },
    { name: "Charlie", slot: null, kills: 3, rank: 2, teamName: "RDx" },
  ]);
});

test("parseAiPlayers reads the team-aware lobby tuple form", () => {
  const players = parseAiPlayers(
    '{"players":[["Alpha",10,"DZx"],["Bravo",10,"DZx"],["Charlie",null,"RDx"]]}',
    "lobby"
  );
  assert.deepEqual(players, [
    { name: "Alpha", slot: 10, kills: null, rank: null, teamName: "DZx" },
    { name: "Bravo", slot: 10, kills: null, rank: null, teamName: "DZx" },
    { name: "Charlie", slot: null, kills: null, rank: null, teamName: "RDx" },
  ]);
});

test("parseAiPlayers still reads the legacy slot-aware results tuple", () => {
  const players = parseAiPlayers(
    '{"players":[["Alpha",10,7,1],["Bravo",10,2,1]]}',
    "results"
  );
  assert.deepEqual(players, [
    { name: "Alpha", slot: 10, kills: 7, rank: 1, teamName: null },
    { name: "Bravo", slot: 10, kills: 2, rank: 1, teamName: null },
  ]);
});
