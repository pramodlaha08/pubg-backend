// Screenshot-based auto-scoring: lobby roster capture + results reconciliation.
import crypto from "crypto";
import { Team } from "../models/team.model.js";
import { MatchRoster } from "../models/matchRoster.model.js";
import { MatchVerification } from "../models/matchVerification.model.js";
import { PlayerAlias } from "../models/playerAlias.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { recognizeImage } from "../utils/ocr.helper.js";
import { extractPlayersWithAI } from "../utils/aiVision.helper.js";
import {
  parseLobbyText,
  parseResultsText,
  matchPlayers,
  aggregateResults,
  buildComparison,
  buildMapping,
  buildResultsMapping,
  mergeRosterEntries,
  snapNamesToRoster,
  decideApply,
  normalizeName,
  canonicalName,
} from "../utils/rosterParser.helper.js";
import { getScoringConfig, recomputeTeamScores } from "../utils/scoring.helper.js";
import { previewPointsImpact } from "../utils/pointsPreview.helper.js";
import { createTeamLogEntry } from "../utils/teamLog.helper.js";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/bmp"];

const hashBuffer = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

const combineHashes = (hashes) =>
  crypto.createHash("sha256").update(hashes.join("|")).digest("hex");

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const broadcast = (req, event, payload) => {
  const io = req.app?.io;
  if (!io) return;
  if (req.tournamentId) io.to(`t_${req.tournamentId}`).emit(event, payload);
  io.emit(event, payload);
};

const collectImageFiles = (req) => {
  const files = Array.isArray(req.files)
    ? req.files
    : req.file
    ? [req.file]
    : [];
  if (!files.length) {
    throw new ApiError(400, "At least one image file is required (field name: images)");
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new ApiError(415, `Unsupported image type: ${file.mimetype}`);
    }
  }
  return files;
};

const summarizeTeam = (team) => ({
  _id: String(team._id),
  slot: team.slot,
  name: team.name,
  logo: team.logo || "",
});

const parseRoundNumber = (value, { required = true } = {}) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ApiError(400, "roundNumber is required");
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) {
    throw new ApiError(400, "roundNumber must be a positive integer");
  }
  return num;
};

// Try the optional AI vision pass first; fall back to Tesseract OCR.
const readLobby = async (file) => {
  const ai = await extractPlayersWithAI({
    buffer: file.buffer,
    mimeType: file.mimetype,
    kind: "lobby",
  });
  if (ai) {
    return {
      rawText: ai.raw,
      entries: ai.entries.map((entry) => ({ slot: entry.slot, name: entry.name })),
      engine: ai.engine,
      confidence: null,
      psm: null,
    };
  }
  const ocr = await recognizeImage(file.buffer);
  return {
    rawText: ocr.text,
    entries: parseLobbyText(ocr.text),
    engine: "tesseract",
    confidence: ocr.confidence,
    psm: ocr.psm,
  };
};

const readResults = async (file, context = {}) => {
  const ai = await extractPlayersWithAI({
    buffer: file.buffer,
    mimeType: file.mimetype,
    kind: "results",
    knownPlayers: context.knownPlayers,
    knownTeams: context.knownTeams,
  });
  if (ai) {
    return {
      rawText: ai.raw,
      rows: ai.entries,
      engine: ai.engine,
      confidence: null,
      psm: null,
    };
  }
  const ocr = await recognizeImage(file.buffer);
  return {
    rawText: ocr.text,
    rows: parseResultsText(ocr.text),
    engine: "tesseract",
    confidence: ocr.confidence,
    psm: ocr.psm,
  };
};

const collectWarnings = ({ rawText, entryCount, unmatched = [], confidence, engine = "" }) => {
  const warnings = [];
  if (!rawText || rawText.trim().length < 3 || entryCount === 0) {
    warnings.push(
      "OCR could not read this screenshot. Try a clearer, higher-resolution image or enter values manually."
    );
  } else {
    // Be explicit when the AI pass was unavailable and plain OCR produced the
    // rows — OCR accuracy is much lower, so the admin must double-check.
    if (!engine.includes("ai:")) {
      warnings.push(
        "AI extraction was unavailable, so this screenshot was read with OCR only (lower accuracy). Verify every value, or retry in a few minutes to use AI."
      );
    }
    if (confidence != null && confidence < 55) {
      warnings.push(
        `Low OCR confidence (${Math.round(confidence)}%). Please double-check the extracted names.`
      );
    }
  }
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length} row(s) could not be matched to a team. Assign them manually or ignore.`
    );
  }
  return warnings;
};

// POST /api/v1/match/lobby  (multipart: images[])
export const uploadLobby = asyncHandler(async (req, res) => {
  const files = collectImageFiles(req);
  const roundNumber = parseRoundNumber(req.body?.roundNumber, { required: false });

  const [teams, aliases] = await Promise.all([
    Team.find({ tournamentId: req.tournamentId }).sort({ slot: 1 }).lean(),
    PlayerAlias.find({ tournamentId: req.tournamentId }).lean(),
  ]);
  const aliasMap = new Map(aliases.map((alias) => [alias.canonical, alias]));

  const hashes = [];
  const rawTexts = [];
  const engines = new Set();
  const confidences = [];
  const perImage = [];
  const merged = [];
  const seenKey = new Set();
  let fromMemory = 0;

  for (const file of files) {
    const hash = hashBuffer(file.buffer);
    hashes.push(hash);

    const parsed = await readLobby(file);
    if (parsed.confidence != null) confidences.push(parsed.confidence);
    if (parsed.engine) engines.add(parsed.engine);
    if (parsed.rawText) rawTexts.push(parsed.rawText);

    const matched = matchPlayers(parsed.entries, teams, aliasMap);
    let added = 0;
    for (const entry of matched) {
      const key = entry.canonical || entry.normalized;
      if (!key || seenKey.has(key)) continue;
      seenKey.add(key);
      if (entry.source === "memory") fromMemory += 1;
      merged.push(entry);
      added += 1;
    }
    perImage.push({ imageHash: hash, count: added, engine: parsed.engine });
  }

  const rawText = rawTexts.join("\n");
  const confidence = average(confidences);

  // Merge with the saved roster so previously confirmed mappings survive a re-upload.
  let existing = [];
  if (roundNumber) {
    const roster = await MatchRoster.findOne({
      tournamentId: req.tournamentId,
      roundNumber,
    }).lean();
    existing = roster?.players || [];
  }
  const entries = mergeRosterEntries(existing, merged);

  // Duplicate player detection (the same name proposed twice).
  const seenNames = new Map();
  for (const entry of entries) {
    const key = entry.canonical || entry.normalized;
    seenNames.set(key, (seenNames.get(key) || 0) + 1);
  }
  const duplicates = [...seenNames.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const entry = entries.find((m) => (m.canonical || m.normalized) === key);
      return { name: entry?.name || key, count };
    });

  const engineLabel = [...engines].join(", ") || "tesseract";
  const warnings = collectWarnings({
    rawText,
    entryCount: entries.length,
    confidence,
    engine: engineLabel,
  });
  if (duplicates.length) {
    warnings.push(
      `${duplicates.length} player name(s) appeared more than once. Review the preview before saving.`
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        imageHash: combineHashes(hashes),
        imageHashes: hashes,
        perImage,
        rawText,
        entries,
        teams: teams.map(summarizeTeam),
        mapping: buildMapping(entries, teams),
        duplicates,
        warnings,
        ocr: {
          confidence,
          fromMemory,
          engine: engineLabel,
          images: files.length,
        },
      },
      "Lobby screenshot(s) processed"
    )
  );
});

// POST /api/v1/match/roster
export const saveRoster = asyncHandler(async (req, res) => {
  const roundNumber = parseRoundNumber(req.body?.roundNumber);
  const { players, imageHash, rawText } = req.body || {};

  if (!Array.isArray(players)) {
    throw new ApiError(400, "players must be an array");
  }

  const sanitized = players
    .map((player) => ({
      name: String(player?.name ?? "").trim(),
      slot:
        player?.slot === null || player?.slot === undefined || player?.slot === ""
          ? null
          : Number(player.slot),
      teamId: player?.teamId || null,
    }))
    .filter((player) => player.name.length > 0)
    .map((player) => ({
      ...player,
      normalized: normalizeName(player.name),
    }));

  if (!sanitized.length) {
    throw new ApiError(400, "At least one player with a name is required");
  }

  const roster = await MatchRoster.findOneAndUpdate(
    { tournamentId: req.tournamentId, roundNumber },
    {
      $set: {
        players: sanitized,
        imageHash: imageHash || "",
        rawText: rawText || "",
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Learn confirmed player -> team mappings for future screenshots.
  const learned = sanitized.filter((player) => player.teamId);
  await Promise.all(
    learned.map((player) =>
      PlayerAlias.findOneAndUpdate(
        { tournamentId: req.tournamentId, canonical: canonicalName(player.name) },
        {
          $set: {
            name: player.name,
            teamId: player.teamId,
            slot: player.slot,
            lastRound: roundNumber,
          },
          $inc: { count: 1 },
        },
        { upsert: true }
      )
    )
  );

  return res
    .status(200)
    .json(new ApiResponse(200, roster, "Roster saved successfully"));
});

// GET /api/v1/match/roster?roundNumber=N
export const getRoster = asyncHandler(async (req, res) => {
  const roundNumber = parseRoundNumber(req.query?.roundNumber);
  const roster = await MatchRoster.findOne({
    tournamentId: req.tournamentId,
    roundNumber,
  }).lean();

  return res
    .status(200)
    .json(new ApiResponse(200, { roster: roster || null }, "Roster fetched"));
});

// POST /api/v1/match/results  (multipart: images[], body: roundNumber)
export const uploadResults = asyncHandler(async (req, res) => {
  const files = collectImageFiles(req);
  const roundNumber = parseRoundNumber(
    req.body?.roundNumber ?? req.query?.roundNumber
  );

  // Load the roster + teams first so the AI/OCR pass can be constrained to the
  // names we actually expect to see.
  const [roster, teams, priors] = await Promise.all([
    MatchRoster.findOne({
      tournamentId: req.tournamentId,
      roundNumber,
    }).lean(),
    Team.find({ tournamentId: req.tournamentId }).sort({ slot: 1 }).lean(),
    MatchVerification.find({
      tournamentId: req.tournamentId,
      roundNumber,
      status: "applied",
    })
      .sort({ appliedAt: -1 })
      .lean(),
  ]);

  const rosterPlayers = roster?.players || [];
  const teamNameById = new Map(teams.map((team) => [String(team._id), team.name]));
  const knownPlayers = rosterPlayers.map((player) => ({
    name: player.name,
    teamName: player.teamId ? teamNameById.get(String(player.teamId)) ?? "" : "",
  }));
  const knownTeams = teams.map((team) => team.name);
  const aiContext = { knownPlayers, knownTeams };

  const hashes = [];
  const rawTexts = [];
  const engines = new Set();
  const confidences = [];
  const perImage = [];
  const rawRows = [];

  for (const file of files) {
    const hash = hashBuffer(file.buffer);
    hashes.push(hash);

    const parsed = await readResults(file, aiContext);
    if (parsed.confidence != null) confidences.push(parsed.confidence);
    if (parsed.engine) engines.add(parsed.engine);
    if (parsed.rawText) rawTexts.push(parsed.rawText);

    perImage.push({ imageHash: hash, count: parsed.rows.length, engine: parsed.engine });
    for (const row of parsed.rows) rawRows.push(row);
  }

  // Snap misread names to the known roster/teams, then de-duplicate.
  const { rows: snappedRows, corrected } = snapNamesToRoster(
    rawRows,
    rosterPlayers,
    knownTeams
  );

  const seenKey = new Set();
  const resultRows = [];
  for (const row of snappedRows) {
    const key = canonicalName(row.name) || normalizeName(row.name);
    if (!key || seenKey.has(key)) continue;
    seenKey.add(key);
    resultRows.push(row);
  }

  const imageHash = combineHashes(hashes);
  const rawText = rawTexts.join("\n");
  const confidence = average(confidences);

  const { teamKills, teamPosition, unmatched } = aggregateResults({
    rosterPlayers,
    teams,
    resultRows,
  });

  // Include every registered team, not only those already scored this round: the
  // results screenshot is usually the first source of scores for the round, so
  // filtering to existing rounds would leave the comparison empty and the admin
  // with nothing to review.
  const comparisonTeams = teams.map((team) => ({
    _id: team._id,
    slot: team.slot,
    name: team.name,
    round: team.rounds.find((r) => r.roundNumber === roundNumber) || null,
  }));

  // Preserve already-applied values: a re-upload only fills teams that were
  // still unmatched, leaving previously verified teams untouched.
  const slotByTeamId = new Map(teams.map((team) => [String(team._id), team.slot]));
  const priorBySlot = new Map();
  for (const prior of priors) {
    for (const entry of prior.verified || []) {
      if (entry.kills == null && entry.position == null) continue;
      const slot = Number(entry.slot);
      if (!priorBySlot.has(slot)) {
        priorBySlot.set(slot, { kills: entry.kills ?? null, position: entry.position ?? null });
      }
    }
  }
  for (const team of comparisonTeams) {
    const teamId = String(team._id);
    const prior = priorBySlot.get(slotByTeamId.get(teamId));
    if (!prior) continue;
    if (!teamKills.has(teamId) && prior.kills != null) teamKills.set(teamId, prior.kills);
    if (!teamPosition.has(teamId) && prior.position != null) {
      teamPosition.set(teamId, prior.position);
    }
  }

  const scoring = getScoringConfig(req.tournament);
  const comparison = buildComparison({
    teams: comparisonTeams,
    teamKills,
    teamPosition,
    scoring,
  });

  const engineLabel = [...engines].join(", ") || "tesseract";
  const warnings = collectWarnings({
    rawText,
    entryCount: resultRows.length,
    unmatched,
    confidence,
    engine: engineLabel,
  });
  if (!roster) {
    warnings.push(
      `No saved roster for round ${roundNumber}. Rows can only be matched by team name — save a lobby roster first for the best accuracy.`
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        imageHash,
        imageHashes: hashes,
        perImage,
        roundNumber,
        rawText,
        comparison,
        unmatched,
        hasRoster: Boolean(roster),
        mapping: buildResultsMapping({ rosterPlayers, comparison }),
        warnings,
        ocr: {
          confidence,
          engine: engineLabel,
          images: files.length,
          corrected,
        },
      },
      "Results screenshot(s) processed"
    )
  );
});

// POST /api/v1/match/preview  (dry run — computes the projected points impact)
export const previewResults = asyncHandler(async (req, res) => {
  const roundNumber = parseRoundNumber(req.body?.roundNumber);
  const { verified } = req.body || {};

  if (!Array.isArray(verified) || verified.length === 0) {
    throw new ApiError(400, "verified entries are required");
  }

  const teams = await Team.find({ tournamentId: req.tournamentId })
    .sort({ slot: 1 })
    .lean();
  const scoring = getScoringConfig(req.tournament);

  const preview = previewPointsImpact({ teams, roundNumber, verified, scoring });

  return res
    .status(200)
    .json(new ApiResponse(200, preview, "Points preview computed"));
});

// POST /api/v1/match/apply
export const applyResults = asyncHandler(async (req, res) => {
  const roundNumber = parseRoundNumber(req.body?.roundNumber);
  const { imageHash, verified, comparison, unmatched, rawText, force } =
    req.body || {};

  if (!imageHash) {
    throw new ApiError(400, "imageHash is required");
  }
  if (!Array.isArray(verified) || verified.length === 0) {
    throw new ApiError(400, "verified entries are required");
  }

  const existing = await MatchVerification.findOne({
    tournamentId: req.tournamentId,
    imageHash,
  }).lean();

  const decision = decideApply({ existing, imageHash, force: Boolean(force) });
  if (decision.blocked) {
    throw new ApiError(409, decision.reason);
  }

  const teams = await Team.find({ tournamentId: req.tournamentId });
  const bySlot = new Map(teams.map((team) => [team.slot, team]));
  const scoring = getScoringConfig(req.tournament);

  const updated = [];
  const skipped = [];

  for (const entry of verified) {
    const slot = Number(entry?.slot);
    const team = bySlot.get(slot);
    if (!team) {
      skipped.push({ slot, reason: "No team registered for this slot" });
      continue;
    }

    let round = team.rounds.find((r) => r.roundNumber === roundNumber);
    if (!round) {
      round = team.rounds.create({
        roundNumber,
        kills: 0,
        killPoints: 0,
        position: 0,
        positionPoints: 0,
        eliminationCount: 0,
        eliminatedPlayers: [],
        status: "alive",
      });
      team.rounds.push(round);
      if (roundNumber > team.currentRound) team.currentRound = roundNumber;
    }

    const hasKills = entry.kills !== null && entry.kills !== undefined;
    const hasPosition = entry.position !== null && entry.position !== undefined;

    if (hasKills) round.kills = Math.max(0, Number(entry.kills) || 0);
    if (hasPosition) round.position = Math.max(0, Number(entry.position) || 0);

    recomputeTeamScores(team, scoring);
    await team.save();
    updated.push(team);

    await createTeamLogEntry({
      req,
      eventType: "SCORE_VERIFIED",
      severity: "highlight",
      team,
      roundNumber,
      title: `Verified: ${team.name}`,
      message: `Round ${roundNumber}: kills set to ${round.kills}, position set to ${round.position} from results screenshot. Team total now ${team.totalPoints} pts.`,
      changes: [
        { field: "round.kills", current: round.kills },
        { field: "round.position", current: round.position },
        { field: "team.totalPoints", current: team.totalPoints },
      ],
      meta: { imageHash, source: "results-screenshot" },
    }).catch(() => {});
  }

  const verification = await MatchVerification.findOneAndUpdate(
    { tournamentId: req.tournamentId, imageHash },
    {
      $set: {
        roundNumber,
        rawText: rawText || "",
        verified: verified.map((entry) => ({
          slot: Number(entry.slot),
          teamId: entry.teamId || null,
          kills: entry.kills ?? null,
          position: entry.position ?? null,
        })),
        comparison: Array.isArray(comparison) ? comparison : [],
        unmatched: Array.isArray(unmatched) ? unmatched : [],
        status: "applied",
        appliedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  broadcast(req, "positions_updated", { roundNumber, source: "verification" });
  broadcast(req, "score_verified", { roundNumber, imageHash });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        applied: true,
        roundNumber,
        updatedSlots: updated.map((team) => team.slot),
        skipped,
        verification,
      },
      "Verified results applied to the leaderboard"
    )
  );
});

// Delete auto-scoring data for the tournament.
// - With a roundNumber: clears that round's roster + verification only.
// - Without one: clears ALL rosters, verifications and learned player aliases.
// Live team scores (leaderboard) are never touched.
const clearMatchData = asyncHandler(async (req, res) => {
  const rawRound = req.body?.roundNumber ?? req.query?.roundNumber;
  const hasRound = !(rawRound === undefined || rawRound === null || rawRound === "");
  const tournamentId = req.tournamentId;

  if (!hasRound) {
    const [rosters, verifications, aliases] = await Promise.all([
      MatchRoster.deleteMany({ tournamentId }),
      MatchVerification.deleteMany({ tournamentId }),
      PlayerAlias.deleteMany({ tournamentId }),
    ]);

    broadcast(req, "match_data_cleared", { scope: "all" });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          scope: "all",
          rosters: rosters.deletedCount ?? 0,
          verifications: verifications.deletedCount ?? 0,
          aliases: aliases.deletedCount ?? 0,
        },
        "All auto-scoring data deleted"
      )
    );
  }

  const roundNumber = parseRoundNumber(rawRound);
  const filter = { tournamentId, roundNumber };
  const [rosters, verifications] = await Promise.all([
    MatchRoster.deleteMany(filter),
    MatchVerification.deleteMany(filter),
  ]);

  broadcast(req, "match_data_cleared", { scope: "round", roundNumber });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        scope: "round",
        roundNumber,
        rosters: rosters.deletedCount ?? 0,
        verifications: verifications.deletedCount ?? 0,
      },
      `Auto-scoring data for round ${roundNumber} deleted`
    )
  );
});

export { clearMatchData };
