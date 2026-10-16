// Pure helpers for the screenshot-based auto-scoring workflow.
//
// These functions contain NO database or OCR dependencies so they can be
// unit-tested in isolation. The OCR layer (ocr.helper.js) produces raw text,
// these helpers turn that text into structured, editable data, and the
// controller persists the confirmed result.
//
// Real PUBG screenshots OCR poorly: multiple columns are flattened onto one
// line and the "eliminations" label is often glued to the kill count
// (e.g. "/0imingtions", "10 eliminations", "0 minions"). Rather than trusting
// line breaks, entries are recovered by scanning tokens and cutting at each
// fuzzy "eliminations"-like word. The resulting rows are always surfaced to
// the admin for correction; nothing is auto-applied.

// ---------------------------------------------------------------------------
// Name normalisation + fuzzy matching
// ---------------------------------------------------------------------------

export const normalizeName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

// Iterative Levenshtein distance with a rolling row (O(min(a,b)) memory).
export const levenshtein = (a, b) => {
  const s = String(a ?? "");
  const t = String(b ?? "");
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let prev = new Array(t.length + 1);
  let curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[t.length];
};

// Similarity ratio in the range [0, 1] (1 == identical after normalisation).
export const similarity = (a, b) => {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;
  const dist = levenshtein(s, t);
  return 1 - dist / Math.max(s.length, t.length);
};

export const STRONG_MATCH = 0.86;
export const WEAK_MATCH = 0.6;

// Gamer tags are full of leet-speak and OCR confusions (0/O, 1/I/L, 3/E, 4/A,
// 5/S, 7/T, 8/B, 2/Z ...). Folding those to a canonical letter form makes two
// spellings of the same tag compare far more reliably.
const LEET_MAP = {
  0: "o",
  1: "i",
  2: "z",
  3: "e",
  4: "a",
  5: "s",
  6: "g",
  7: "t",
  8: "b",
  9: "g",
};

export const canonicalName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[013456789]/g, (char) => LEET_MAP[char])
    .replace(/[^a-z0-9]/g, "");

// Combine raw and leet-folded similarity so both ordinary mismatches and
// leet-vs-letter tag variants are caught.
export const nameSimilarity = (a, b) =>
  Math.max(similarity(a, b), similarity(canonicalName(a), canonicalName(b)));

// ---------------------------------------------------------------------------
// OCR text cleaning + entry extraction
// ---------------------------------------------------------------------------

const DECORATIVE_CHARS = /[➟►▶★☆•·]/g;
const NAME_LETTER = /[\p{L}]/u;

export const cleanOCRLine = (line) =>
  String(line ?? "")
    .replace(DECORATIVE_CHARS, " ")
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const cleanName = (value) =>
  String(value ?? "")
    .replace(/[^\p{L}\p{N}_\-[\] .+~]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Is this token an OCR misread of "eliminations"/"elimination"?
const isElimToken = (token) => {
  const letters = String(token).toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length < 4) return false;
  if (letters === "minion" || letters === "minions") return true;
  return (
    similarity(letters, "eliminations") >= 0.55 ||
    similarity(letters, "elimination") >= 0.55
  );
};

const isNameToken = (token) => NAME_LETTER.test(token);

const firstNumber = (token) => {
  const match = String(token).match(/\d{1,3}/);
  return match ? Number(match[0]) : null;
};

// A trailing token that is purely a kill count (optionally prefixed/suffixed
// with slash/parenthesis decorations). Long numbers or numbers glued to a name
// are rejected so player names like "Aayush777" are not mistaken for kills.
const asKillsToken = (token) => {
  const match = String(token).match(/^[/\\£$+\-]?(\d{1,3})[)\].]?$/);
  return match ? Number(match[1]) : null;
};

// Slot numbers survive OCR only loosely ("[]3", "£4", "[15"). Accept a token
// whose digits collapse to 1-25 and which is short enough to be a slot marker.
const detectSlot = (tokens) => {
  for (const token of tokens) {
    const digits = String(token).replace(/\D/g, "");
    if (!digits || digits.length > 2) continue;
    const strayChars = String(token).replace(/[\s\p{L}]/gu, "");
    if (strayChars.length > 3) continue;
    const num = Number(digits);
    if (Number.isInteger(num) && num >= 1 && num <= 25) return num;
  }
  return null;
};

const extractRank = (tokens) => {
  for (let i = 0; i < tokens.length; i += 1) {
    const match = tokens[i].match(/^#\s*(\d{1,2})$/);
    if (match) {
      return {
        rank: Number(match[1]),
        rest: [...tokens.slice(0, i), ...tokens.slice(i + 1)],
      };
    }
  }
  return { rank: null, rest: tokens };
};

// Take the maximal trailing run of letter-bearing tokens as the name.
const extractName = (tokens) => {
  let end = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (isNameToken(tokens[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return "";
  let start = end;
  while (start - 1 >= 0 && isNameToken(tokens[start - 1])) start -= 1;
  return cleanName(tokens.slice(start, end + 1).join(" "));
};

/**
 * Recover candidate rows from raw OCR text. Returns
 * `[{ slot, name, kills, rank }]` — every field except name may be null.
 */
export const extractEntries = (rawText) => {
  const entries = [];
  const lines = String(rawText ?? "").split(/\r?\n/);

  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    // Cut the token stream at every eliminations-like word.
    const segments = [];
    let current = [];
    for (const token of tokens) {
      if (isElimToken(token)) {
        const num = firstNumber(token);
        if (num !== null) current.push(String(num));
        segments.push(current);
        current = [];
      } else {
        current.push(token);
      }
    }
    if (current.length) segments.push(current);

    for (const segment of segments) {
      let tokensLeft = [...segment];

      let kills = null;
      if (tokensLeft.length) {
        const trailing = asKillsToken(tokensLeft[tokensLeft.length - 1]);
        if (trailing !== null) {
          kills = trailing;
          tokensLeft = tokensLeft.slice(0, -1);
        }
      }

      const { rank, rest } = extractRank(tokensLeft);
      const slot = detectSlot(rest);
      const name = extractName(rest);

      if (name.replace(/[^a-z0-9]/gi, "").length < 3) continue;
      entries.push({ slot, name, kills, rank });
    }
  }

  return entries;
};

export const parseLobbyText = (rawText) =>
  extractEntries(rawText).map(({ slot, name }) => ({ slot, name }));

export const parseResultsText = (rawText) =>
  extractEntries(rawText).map(({ rank, name, kills }) => ({ rank, name, kills }));

// ---------------------------------------------------------------------------
// Matching extracted names to registered teams
// ---------------------------------------------------------------------------

const rankCandidates = (name, pool, key = "name") => {
  return pool
    .map((item) => ({ item, score: nameSimilarity(name, item[key]) }))
    .sort((a, b) => b.score - a.score);
};

export const matchPlayers = (entries, teams, aliases = new Map()) => {
  return entries.map((entry) => {
    const canonical = canonicalName(entry.name);
    const alias = aliases.get ? aliases.get(canonical) : aliases[canonical];
    const aliasTeam = alias
      ? teams.find((t) => String(t._id) === String(alias.teamId))
      : null;

    const candidates = rankCandidates(entry.name, teams)
      .slice(0, 3)
      .map((c) => ({
        teamId: String(c.item._id),
        slot: c.item.slot,
        name: c.item.name,
        score: Number(c.score.toFixed(3)),
      }));

    const best = candidates[0];
    const slotTeam =
      entry.slot != null ? teams.find((t) => t.slot === entry.slot) : null;

    // The AI can also read the team name printed in each panel header, which is
    // a reliable fallback when the large colored slot digit is misread.
    const teamNameHit = entry.teamName
      ? rankCandidates(entry.teamName, teams)[0]
      : null;

    let status = "unmatched";
    let teamId = null;
    let confidence = best?.score ?? 0;
    let source = "fuzzy";

    if (aliasTeam) {
      // Remembered from a previously confirmed registration — highest signal.
      status = "matched";
      teamId = String(aliasTeam._id);
      confidence = 1;
      source = "memory";
    } else if (best && best.score >= STRONG_MATCH) {
      status = "matched";
      teamId = best.teamId;
      confidence = best.score;
    } else if (slotTeam) {
      // In a lobby/register screenshot the slot number is the team assignment.
      status = "matched";
      teamId = String(slotTeam._id);
      confidence = Math.max(confidence, 0.9);
      source = "slot";
    } else if (teamNameHit && teamNameHit.score >= WEAK_MATCH) {
      status = "matched";
      teamId = String(teamNameHit.item._id);
      confidence = Math.max(confidence, teamNameHit.score);
      source = "team";
    } else if (best && best.score >= WEAK_MATCH) {
      status = "ambiguous";
      teamId = best.teamId;
    }

    return {
      ...entry,
      canonical,
      normalized: normalizeName(entry.name),
      status,
      teamId,
      confidence: Number(confidence.toFixed(3)),
      source,
      slotTeamId: slotTeam ? String(slotTeam._id) : null,
      candidates,
    };
  });
};

// ---------------------------------------------------------------------------
// Constrain extracted rows to the known roster / teams
// ---------------------------------------------------------------------------

// OCR and vision models routinely misread gamer tags (0/O, 1/I/L, dropped
// digits...). Snapping each extracted name to the most similar KNOWN roster
// player or team name (when close enough) cleans the data before matching and
// keeps a team summary row from being mistaken for an individual player row.
export const snapNamesToRoster = (
  rows,
  rosterPlayers = [],
  knownTeams = [],
  threshold = 0.72
) => {
  const players = (rosterPlayers || []).filter((player) => player && player.name);
  const teams = (knownTeams || []).filter(Boolean).map((name) => ({ name }));
  if (!players.length && !teams.length) return { rows, corrected: 0 };

  let corrected = 0;
  const snapped = (rows || []).map((row) => {
    const name = String(row?.name ?? "").trim();
    if (!name) return row;

    const playerHit = players.length ? rankCandidates(name, players)[0] : null;
    const teamHit = teams.length ? rankCandidates(name, teams)[0] : null;
    const playerScore = playerHit?.score ?? 0;
    const teamScore = teamHit?.score ?? 0;

    // Prefer a player when it clearly fits better; this avoids folding a team
    // summary row onto a similarly-named player.
    let best = null;
    if (playerScore >= threshold && playerScore >= teamScore + 0.02) {
      best = playerHit.item.name;
    } else if (teamScore >= threshold) {
      best = teamHit.item.name;
    }

    if (best && best !== name) {
      corrected += 1;
      return { ...row, name: best, originalName: row.name, rosterCorrected: true };
    }
    return row;
  });

  return { rows: snapped, corrected };
};

// ---------------------------------------------------------------------------
// Kill aggregation (results -> per-team)
// ---------------------------------------------------------------------------

export const aggregateResults = ({ rosterPlayers = [], teams = [], resultRows = [] }) => {
  const playerKills = new Map();
  const teamRowKills = new Map();
  const teamPosition = new Map();
  const unmatched = [];

  // A results screenshot repeats the leading placements in every image (the
  // 1st/2nd team is usually pinned in all shots). Track the first image each
  // team appears in so later copies are ignored instead of counted twice.
  const teamFirstImage = new Map();
  const repeatPlayerKills = new Map();
  const repeatTeamKills = new Map();
  const repeatPosition = new Map();
  let repeatsIgnored = 0;

  // The scoreboard shows each panel's team slot explicitly, so matching by slot
  // is exact and far more reliable than fuzzy name matching.
  const slotToTeam = new Map();
  for (const team of teams) {
    if (team && team.slot != null) slotToTeam.set(Number(team.slot), team);
  }

  const bestName = (name, pool) => {
    const hit = rankCandidates(name, pool)[0];
    return hit && hit.score >= WEAK_MATCH ? hit : null;
  };

  // The team name printed in each results block header is the strongest signal
  // when the AI can read it: it needs no roster and no slot numbers.
  const normalizedTeam = new Map();
  for (const team of teams) {
    if (team?.name) normalizedTeam.set(normalizeName(team.name), team);
  }
  const bestTeamByName = (value) => {
    const key = normalizeName(value);
    if (!key) return null;
    if (normalizedTeam.has(key)) return normalizedTeam.get(key);
    return bestName(value, teams)?.item || null;
  };

  for (const row of resultRows) {
    let teamId = null;
    let isPlayerRow = false;

    const slot = row?.slot != null ? Number(row.slot) : null;
    if (slot != null && slotToTeam.has(slot)) {
      teamId = String(slotToTeam.get(slot)._id);
      isPlayerRow = true;
    } else {
      // Prefer the row's own team label (AI results carry a teamName).
      const labelled = row?.teamName ? bestTeamByName(row.teamName) : null;
      if (labelled) {
        teamId = String(labelled._id);
        // A row whose own name is the team name is a team-summary row.
        isPlayerRow = normalizeName(row.name) !== normalizeName(labelled.name);
      } else {
        // A results screenshot can be either:
        //  - per-player rows (player name + that player's kills + the TEAM's rank), or
        //  - one summary row per team (team name + team kills + rank).
        // Decide by whichever name matches better.
        const rosterHit = bestName(row.name, rosterPlayers);
        const teamHit = bestName(row.name, teams);

        if (rosterHit && (!teamHit || rosterHit.score >= teamHit.score)) {
          isPlayerRow = true;
          teamId = rosterHit.item.teamId ? String(rosterHit.item.teamId) : null;
        } else if (teamHit) {
          teamId = String(teamHit.item._id);
        }
      }
    }

    if (!teamId) {
      unmatched.push(row);
      continue;
    }

    // Ignore a team that already appeared in an earlier screenshot: keep the
    // first reading (as a cross-check) but never add its kills/rank twice.
    if (row.imageIndex != null) {
      const firstImage = teamFirstImage.get(teamId);
      if (firstImage == null) {
        teamFirstImage.set(teamId, row.imageIndex);
      } else if (row.imageIndex > firstImage) {
        repeatsIgnored += 1;
        if (row.rank != null && !repeatPosition.has(teamId)) {
          repeatPosition.set(teamId, row.rank);
        }
        if (row.kills != null) {
          if (isPlayerRow) {
            repeatPlayerKills.set(
              teamId,
              (repeatPlayerKills.get(teamId) || 0) + row.kills
            );
          } else {
            repeatTeamKills.set(teamId, row.kills);
          }
        }
        continue;
      }
    }

    // Rank on either row type is the TEAM's placement (all teammates share it).
    if (row.rank != null && !teamPosition.has(teamId)) {
      teamPosition.set(teamId, row.rank);
    }

    if (row.kills != null) {
      if (isPlayerRow) {
        playerKills.set(teamId, (playerKills.get(teamId) || 0) + row.kills);
      } else {
        teamRowKills.set(teamId, row.kills);
      }
    }
  }

  const teamKills = new Map();
  const allTeamIds = new Set([...playerKills.keys(), ...teamRowKills.keys()]);
  for (const teamId of allTeamIds) {
    // Summed player kills win; a team summary row is only a fallback.
    teamKills.set(
      teamId,
      playerKills.has(teamId) ? playerKills.get(teamId) : teamRowKills.get(teamId)
    );
  }

  // Surface teams whose repeat reading disagreed with the kept one so the admin
  // can eyeball them. Kills are only flagged when the repeat read MORE (a likely
  // missed player row); positions are exact, so any mismatch is worth noting.
  const teamNameById = new Map(teams.map((team) => [String(team._id), team.name]));
  const conflicts = [];
  for (const [teamId, seen] of repeatPosition) {
    const kept = teamPosition.has(teamId) ? teamPosition.get(teamId) : null;
    if (kept != null && seen != null && kept !== seen) {
      conflicts.push({
        teamId,
        teamName: teamNameById.get(String(teamId)) || null,
        field: "position",
        kept,
        seen,
      });
    }
  }
  for (const seenMap of [repeatPlayerKills, repeatTeamKills]) {
    for (const [teamId, seen] of seenMap) {
      const kept = teamKills.has(teamId) ? teamKills.get(teamId) : null;
      if (kept != null && seen > kept) {
        conflicts.push({
          teamId,
          teamName: teamNameById.get(String(teamId)) || null,
          field: "kills",
          kept,
          seen,
        });
      }
    }
  }

  return {
    teamKills,
    teamPosition,
    unmatched,
    repeats: { ignored: repeatsIgnored, conflicts },
  };
};

// ---------------------------------------------------------------------------
// Reconciliation against live scores
// ---------------------------------------------------------------------------

export const buildComparison = ({ teams = [], teamKills, teamPosition, scoring }) => {
  const kills = teamKills || new Map();
  const positions = teamPosition || new Map();

  return teams.map((team) => {
    const teamId = String(team._id);
    const round = team.round || {};
    const liveKills = round.kills || 0;
    const livePosition = round.position || 0;

    const verifiedKills = kills.has(teamId) ? kills.get(teamId) : null;
    const verifiedPosition = positions.has(teamId) ? positions.get(teamId) : null;

    const livePlacementPoints = scoring.positionPointsFor(livePosition);
    const verifiedPlacementPoints =
      verifiedPosition != null ? scoring.positionPointsFor(verifiedPosition) : null;

    const killsMatch = verifiedKills == null || verifiedKills === liveKills;
    const positionMatch =
      verifiedPosition == null || verifiedPosition === livePosition;

    let status;
    if (verifiedKills == null && verifiedPosition == null) {
      status = "unmatched";
    } else if (killsMatch && positionMatch) {
      status = "match";
    } else {
      status = "mismatch";
    }

    return {
      teamId,
      slot: team.slot,
      name: team.name,
      liveKills,
      verifiedKills,
      livePosition,
      verifiedPosition,
      livePlacementPoints,
      verifiedPlacementPoints,
      status,
    };
  });
};

// ---------------------------------------------------------------------------
// Merge fresh OCR rows with a previously saved roster
// ---------------------------------------------------------------------------

// Preserve already-confirmed mappings; only fill rows that were still
// unassigned, and append genuinely new players. Re-uploading the same or a
// follow-up screenshot therefore never clobbers manual corrections.
export const mergeRosterEntries = (existingPlayers = [], ocrEntries = []) => {
  const keyOf = (player) =>
    canonicalName(player?.name) || normalizeName(player?.name) || "";
  const indexByKey = new Map();
  const out = [];

  for (const player of existingPlayers) {
    const key = keyOf(player);
    if (!key || indexByKey.has(key)) continue;
    indexByKey.set(key, out.length);
    out.push({
      name: player.name,
      slot: player.slot ?? null,
      status: player.teamId ? "matched" : "unmatched",
      teamId: player.teamId ? String(player.teamId) : null,
      confidence: player.teamId ? 1 : 0,
      source: "saved",
      candidates: [],
      canonical: canonicalName(player.name),
      normalized: normalizeName(player.name),
      origin: "existing",
    });
  }

  for (const entry of ocrEntries) {
    const key = keyOf(entry);
    if (!key) continue;
    if (indexByKey.has(key)) {
      const idx = indexByKey.get(key);
      const current = out[idx];
      if (!current.teamId && entry.teamId) {
        out[idx] = { ...entry, origin: "updated" };
      }
    } else {
      indexByKey.set(key, out.length);
      out.push({ ...entry, origin: "new" });
    }
  }

  return out;
};

// ---------------------------------------------------------------------------
// Round participation (which teams are registered for a round)
// ---------------------------------------------------------------------------

// Ids of every team that has at least one player in a roster.
export const collectPresentTeamIds = (rosterPlayers = []) => {
  const present = new Set();
  for (const player of rosterPlayers || []) {
    if (player?.teamId) present.add(String(player.teamId));
  }
  return present;
};

// Mark teams missing from a round's registration. A team counts as absent when
// the round HAS a usable registration (at least one player assigned to a team)
// and the team has no player in it. When there is no usable registration nobody
// is marked absent, so a missing or partial screenshot can never empty the
// live control / points table. Teams come back automatically once they appear in
// a later round's registration.
export const markAbsentTeams = (teams = [], rosterPlayers = null) => {
  const present = rosterPlayers ? collectPresentTeamIds(rosterPlayers) : null;
  const active = Boolean(present && present.size);
  return teams.map((team) => ({
    ...team,
    absent: active ? !present.has(String(team._id)) : false,
  }));
};

// ---------------------------------------------------------------------------
// Per-team display mappings (team -> players, team -> verified result)
// ---------------------------------------------------------------------------

export const buildMapping = (entries = [], teams = []) => {
  const teamById = new Map(teams.map((team) => [String(team._id), team]));
  const groups = new Map();
  const unassigned = [];

  for (const entry of entries) {
    const teamId = entry.teamId ? String(entry.teamId) : null;
    if (teamId && teamById.has(teamId)) {
      if (!groups.has(teamId)) {
        const team = teamById.get(teamId);
        groups.set(teamId, {
          teamId,
          slot: team.slot,
          name: team.name,
          players: [],
        });
      }
      groups.get(teamId).players.push(entry.name);
    } else {
      unassigned.push(entry.name);
    }
  }

  return {
    teams: [...groups.values()].sort((a, b) => a.slot - b.slot),
    unassigned,
  };
};

export const buildResultsMapping = ({ rosterPlayers = [], comparison = [] }) => {
  const playersByTeam = new Map();
  for (const player of rosterPlayers) {
    if (!player.teamId) continue;
    const teamId = String(player.teamId);
    if (!playersByTeam.has(teamId)) playersByTeam.set(teamId, []);
    playersByTeam.get(teamId).push(player.name);
  }

  return comparison.map((row) => ({
    teamId: row.teamId,
    slot: row.slot,
    name: row.name,
    players: playersByTeam.get(row.teamId) || [],
    verifiedKills: row.verifiedKills,
    verifiedPosition: row.verifiedPosition,
    status: row.status,
  }));
};

// ---------------------------------------------------------------------------
// Idempotent re-apply guard
// ---------------------------------------------------------------------------

export const decideApply = ({ existing, imageHash, force = false }) => {
  if (
    existing &&
    existing.imageHash === imageHash &&
    existing.status === "applied" &&
    !force
  ) {
    return {
      blocked: true,
      reason:
        "This results screenshot was already applied. Re-send with force=true to re-apply.",
    };
  }
  return { blocked: false };
};
