// Team Controller
import { Team } from "../models/team.model.js";
import { EliminationNotification } from "../models/eliminationNotification.model.js";
import { TeamLog } from "../models/teamLog.model.js";
import { MatchRoster } from "../models/matchRoster.model.js";
import { MatchVerification } from "../models/matchVerification.model.js";
import { PlayerAlias } from "../models/playerAlias.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { createTeamLogEntry, logTemplates } from "../utils/teamLog.helper.js";
import {
  syncEliminationRealtime,
  flushEliminationRecords,
} from "../utils/eliminationRealtime.helper.js";
import { getScoringConfig, recomputeTeamScores } from "../utils/scoring.helper.js";
import { markAbsentTeams } from "../utils/rosterParser.helper.js";
import mongoose from "mongoose";

const DEFAULT_TEAM_LOGO = process.env.DEFAULT_TEAM_LOGO || "/placeholder.svg";

const broadcast = (req, event, payload) => {
  const io = req.app?.io;
  if (!io) return;
  if (req.tournamentId) io.to(`t_${req.tournamentId}`).emit(event, payload);
  io.emit(event, payload);
};

const safeCreateTeamLog = async (payload) => {
  try {
    await createTeamLogEntry(payload);
  } catch (error) {
    console.error("Failed to create team log:", error.message);
  }
};

// Create Team
const createTeam = asyncHandler(async (req, res) => {
  const { name, slot } = req.body;

  if (!name || !slot) {
    throw new ApiError(400, "Name and slot are required");
  }

  const existingSlot = await Team.findOne({ slot, tournamentId: req.tournamentId });
  if (existingSlot) {
    throw new ApiError(400, `Slot ${slot} already occupied`);
  }

  const trimmedName = String(name).trim();
  const existingName = await Team.findOne({
    name: trimmedName,
    tournamentId: req.tournamentId,
  });
  if (existingName) {
    throw new ApiError(400, `Team "${trimmedName}" already exists in this tournament`);
  }

  const logoLocalPath = req.file?.path;

  let logoUrl = DEFAULT_TEAM_LOGO;
  if (logoLocalPath) {
    const cloudinaryConfigured = Boolean(
      process.env.CLOUD_NAME &&
        process.env.CLOUD_API_KEY &&
        process.env.CLOUD_API_SECRET
    );

    if (cloudinaryConfigured) {
      const logo = await uploadOnCloudinary(logoLocalPath);
      logoUrl = logo?.url || DEFAULT_TEAM_LOGO;
    } else {
      const base =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      logoUrl = `${base}/temp/${encodeURIComponent(req.file.filename)}`;
    }
  }

  const team = await Team.create({
    name: trimmedName,
    slot,
    tournamentId: req.tournamentId,
    logo: logoUrl,
    rounds: [],
    currentRound: 0,
    isEliminated: false,
    totalPoints: 0,
  });

  const template = logTemplates.teamCreated({ team });
  await safeCreateTeamLog({
    req,
    eventType: "TEAM_CREATED",
    severity: "highlight",
    team,
    title: template.title,
    message: template.message,
    changes: [
      { field: "name", previous: null, current: team.name },
      { field: "slot", previous: null, current: team.slot },
      {
        field: "totalPoints",
        previous: null,
        current: team.totalPoints,
        delta: 0,
      },
    ],
  });

  broadcast(req, "team_created", team);

  return res
    .status(201)
    .json(new ApiResponse(201, team, "Team created successfully"));
});

// Bulk Create / Update Teams
const createBulkTeams = asyncHandler(async (req, res) => {
  const { teams } = req.body || {};

  if (!Array.isArray(teams) || teams.length === 0) {
    throw new ApiError(400, "teams must be a non-empty array");
  }

  const created = [];
  const updated = [];
  const unchanged = [];
  const skipped = [];
  const seenSlots = new Set();

  for (const row of teams) {
    const slot = Number(row?.slot);
    const name = String(row?.name || "").trim();

    if (!Number.isInteger(slot) || slot < 1) {
      skipped.push({ slot: row?.slot ?? null, name, reason: "Invalid slot number" });
      continue;
    }
    if (!name) {
      skipped.push({ slot, name, reason: "Missing team name" });
      continue;
    }
    if (seenSlots.has(slot)) {
      skipped.push({ slot, name, reason: "Duplicate slot within import" });
      continue;
    }
    seenSlots.add(slot);

    const existing = await Team.findOne({ slot, tournamentId: req.tournamentId });

    if (existing) {
      if (existing.name === name) {
        unchanged.push({ _id: existing._id, slot, name });
        continue;
      }

      const nameTaken = await Team.findOne({
        name,
        tournamentId: req.tournamentId,
        _id: { $ne: existing._id },
      });
      if (nameTaken) {
        skipped.push({
          slot,
          name,
          reason: `Name "${name}" already used by slot ${nameTaken.slot}`,
        });
        continue;
      }

      const previousName = existing.name;
      existing.name = name;
      await existing.save();

      const template = logTemplates.teamUpdated({
        team: existing,
        changes: [{ field: "name", previous: previousName, current: name }],
      });
      await safeCreateTeamLog({
        req,
        eventType: "TEAM_UPDATED",
        severity: "info",
        team: existing,
        roundNumber: existing.currentRound || null,
        title: template.title,
        message: template.message,
        changes: [{ field: "name", previous: previousName, current: name }],
      });

      broadcast(req, "team_updated", existing);
      updated.push({ _id: existing._id, slot, from: previousName, to: name });
      continue;
    }

    const nameTaken = await Team.findOne({ name, tournamentId: req.tournamentId });
    if (nameTaken) {
      skipped.push({
        slot,
        name,
        reason: `Name "${name}" already used by slot ${nameTaken.slot}`,
      });
      continue;
    }

    const logo =
      typeof row?.logo === "string" && row.logo.trim()
        ? row.logo.trim()
        : DEFAULT_TEAM_LOGO;

    const team = await Team.create({
      name,
      slot,
      tournamentId: req.tournamentId,
      logo,
      rounds: [],
      currentRound: 0,
      isEliminated: false,
      totalPoints: 0,
    });

    const template = logTemplates.teamCreated({ team });
    await safeCreateTeamLog({
      req,
      eventType: "TEAM_CREATED",
      severity: "highlight",
      team,
      title: template.title,
      message: template.message,
      changes: [
        { field: "name", previous: null, current: team.name },
        { field: "slot", previous: null, current: team.slot },
        {
          field: "totalPoints",
          previous: null,
          current: team.totalPoints,
          delta: 0,
        },
      ],
    });

    broadcast(req, "team_created", team);
    created.push(team);
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        summary: {
          created: created.length,
          updated: updated.length,
          unchanged: unchanged.length,
          skipped: skipped.length,
          total: teams.length,
        },
        created,
        updated,
        unchanged,
        skipped,
      },
      "Bulk import complete"
    )
  );
});

// Create New Round
const createRound = asyncHandler(async (req, res) => {
  const { slots, roundNumber } = req.body;

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array");
  }
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "Round number must be a positive integer");
  }

  const teams = await Team.find({ slot: { $in: slots }, tournamentId: req.tournamentId });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  // Validate every selected team before mutating so we never write partially.
  for (const team of teams) {
    if (team.rounds.some((r) => r.roundNumber === roundNumber)) {
      throw new ApiError(
        400,
        `Round ${roundNumber} already exists for team ${team.slot}`
      );
    }
  }

  // Flush old elimination records for this round to start fresh
  const flushedCount = await flushEliminationRecords(roundNumber, req.tournamentId);
  if (process.env.DEBUG_MODE === "true") {
    console.log(
      `[CREATE_ROUND] Flushed ${flushedCount} elimination records for round ${roundNumber}`
    );
  }

  await Promise.all(
    teams.map(async (team) => {
      if (team.rounds.some((r) => r.roundNumber === roundNumber)) {
        throw new ApiError(
          400,
          `Round ${roundNumber} already exists for team ${team.slot}`
        );
      }

      const previousCurrentRound = team.currentRound;
      const newRound = {
        roundNumber,
        kills: 0,
        killPoints: 0,
        position: 0,
        positionPoints: 0,
        eliminationCount: 0,
        eliminatedPlayers: [],
        status: "alive",
      };

      if (roundNumber > team.currentRound) {
        team.currentRound = roundNumber;
      }

      team.rounds.push(newRound);
      team.isEliminated = false;
      await team.save();

      const template = logTemplates.roundCreated({ team, roundNumber });
      await safeCreateTeamLog({
        req,
        eventType: "ROUND_CREATED",
        severity: "info",
        team,
        roundNumber,
        title: template.title,
        message: template.message,
        changes: [
          {
            field: "currentRound",
            previous: previousCurrentRound,
            current: team.currentRound,
            delta: team.currentRound - previousCurrentRound,
          },
          {
            field: "rounds",
            previous: "without-round",
            current: `round-${roundNumber}-added`,
          },
        ],
      });
    })
  );

  const updatedTeams = await Team.find({ slot: { $in: slots }, tournamentId: req.tournamentId });

  broadcast(req, "round_created", {
    roundNumber,
    teams: updatedTeams,
  });

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        updatedTeams,
        "Round created successfully for selected teams"
      )
    );
});

const deleteRoundFromTeams = asyncHandler(async (req, res) => {
  const { slots, roundNumber } = req.body;

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ApiError(400, "Slots must be a non-empty array of numbers");
  }

  if (slots.some((s) => typeof s !== "number")) {
    throw new ApiError(400, "All slots must be numbers");
  }

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new ApiError(400, "Round number must be a positive integer");
  }

  const teams = await Team.find({ slot: { $in: slots }, tournamentId: req.tournamentId });
  if (teams.length === 0) {
    throw new ApiError(404, "No teams found for provided slots");
  }

  const scoring = getScoringConfig(req.tournament);

  const results = await Promise.allSettled(
    teams.map(async (team) => {
      try {
        const roundIndex = team.rounds.findIndex(
          (r) => r.roundNumber === roundNumber
        );

        if (roundIndex === -1) {
          throw new ApiError(
            404,
            `Round ${roundNumber} not found for team ${team.slot}`
          );
        }

        const deletedRound = team.rounds[roundIndex];
        const deductedPoints =
          deletedRound.killPoints + deletedRound.positionPoints;
        const oldTotalPoints = team.totalPoints;

        team.rounds.splice(roundIndex, 1);
        recomputeTeamScores(team, scoring);

        if (team.currentRound === roundNumber) {
          team.currentRound =
            team.rounds.length > 0
              ? Math.max(...team.rounds.map((r) => r.roundNumber))
              : 0;
        }

        const currentRound = team.rounds.find(
          (r) => r.roundNumber === team.currentRound
        );
        team.isEliminated =
          currentRound?.eliminationCount >= scoring.fullEliminationCount;

        await team.save();

        const template = logTemplates.roundDeleted({
          team,
          roundNumber,
          deductedPoints,
        });

        await safeCreateTeamLog({
          req,
          eventType: "ROUND_DELETED",
          severity: "highlight",
          team,
          roundNumber,
          title: template.title,
          message: template.message,
          changes: [
            {
              field: "team.totalPoints",
              previous: oldTotalPoints,
              current: team.totalPoints,
              delta: team.totalPoints - oldTotalPoints,
            },
            {
              field: "roundDeleted",
              previous: `round-${roundNumber}`,
              current: "removed",
            },
          ],
          meta: {
            deductedPoints,
            oldRoundState: deletedRound,
          },
        });

        return { success: true, team };
      } catch (error) {
        return {
          success: false,
          team: team.slot,
          error: error.message,
        };
      }
    })
  );

  const successfulTeams = [];
  const errors = [];

  results.forEach((result) => {
    if (result.value.success) {
      successfulTeams.push(result.value.team);
    } else {
      errors.push({
        team: result.value.team,
        error: result.value.error,
      });
    }
  });

  if (errors.length > 0) {
    const errorDetails = errors
      .map((e) => `Team ${e.team}: ${e.error}`)
      .join(", ");
    throw new ApiError(207, `Partial success: ${errorDetails}`);
  }

  // Cascade: remove elimination records and logs tied to the deleted round.
  await Promise.all([
    EliminationNotification.deleteMany({ tournamentId: req.tournamentId, roundNumber }),
    TeamLog.deleteMany({
      tournamentId: req.tournamentId,
      roundNumber,
      eventType: { $ne: "ROUND_DELETED" },
    }),
  ]);

  broadcast(req, "round_deleted", {
    roundNumber,
    affectedSlots: slots,
    success: true,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { deletedRound: roundNumber, affectedTeams: successfulTeams },
        "Rounds deleted successfully"
      )
    );
});

// Generic Kill Update Handler
const updateKills = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { kills } = req.body;

  if (typeof kills !== "number" || kills < 0) {
    throw new ApiError(400, "Invalid kills value");
  }

  const team = await Team.findOne({ _id: teamId, tournamentId: req.tournamentId });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  const scoring = getScoringConfig(req.tournament);

  currentRound.kills += kills;
  recomputeTeamScores(team, scoring);

  await team.save();

  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: kills,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_UPDATED",
    severity: kills > 0 ? "highlight" : "info",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: currentRound.kills - oldKills,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kills updated successfully"));
});

// Add Single Kill
const addKill = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  const team = await Team.findOne({ _id: teamId, tournamentId: req.tournamentId });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  const scoring = getScoringConfig(req.tournament);

  currentRound.kills += 1;
  recomputeTeamScores(team, scoring);

  await team.save();

  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: 1,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_ADDED",
    severity: "highlight",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: 1,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kill added successfully"));
});

// Decrease Single Kill
const decreaseKill = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  const team = await Team.findOne({ _id: teamId, tournamentId: req.tournamentId });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );
  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const oldKills = currentRound.kills;
  const oldKillPoints = currentRound.killPoints;
  const oldTotalPoints = team.totalPoints;

  const scoring = getScoringConfig(req.tournament);

  if (currentRound.kills > 0) {
    currentRound.kills -= 1;
  }
  recomputeTeamScores(team, scoring);

  await team.save();

  const killDelta = currentRound.kills - oldKills;
  const template = logTemplates.killUpdated({
    team,
    roundNumber: team.currentRound,
    delta: killDelta,
    kills: currentRound.kills,
  });

  void safeCreateTeamLog({
    req,
    eventType: "KILL_DECREASED",
    severity: "info",
    team,
    roundNumber: team.currentRound,
    title: template.title,
    message: template.message,
    changes: [
      {
        field: "round.kills",
        previous: oldKills,
        current: currentRound.kills,
        delta: killDelta,
      },
      {
        field: "round.killPoints",
        previous: oldKillPoints,
        current: currentRound.killPoints,
        delta: currentRound.killPoints - oldKillPoints,
      },
      {
        field: "team.totalPoints",
        previous: oldTotalPoints,
        current: team.totalPoints,
        delta: team.totalPoints - oldTotalPoints,
      },
    ],
    meta: {
      noChange: oldKills === currentRound.kills,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Kill decreased successfully"));
});

// Modified Elimination Handler
const handleElimination = asyncHandler(async (req, res) => {
  const { teamId } = req.params;
  const { playerIndex } = req.body;

  const scoring = getScoringConfig(req.tournament);

  if (
    playerIndex === undefined ||
    !scoring.isValidPlayerIndex(playerIndex)
  ) {
    throw new ApiError(
      400,
      `Invalid player index (0-${scoring.maxPlayerIndex} required)`
    );
  }

  const team = await Team.findOne({ _id: teamId, tournamentId: req.tournamentId });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const currentRound = team.rounds.find(
    (r) => r.roundNumber === team.currentRound
  );

  if (!currentRound) {
    throw new ApiError(400, "No active round found");
  }

  const playerIdx = currentRound.eliminatedPlayers.indexOf(playerIndex);
  let eliminationChange = 0;
  const oldEliminationCount = currentRound.eliminationCount;
  const oldStatus = currentRound.status;

  if (playerIdx === -1) {
    currentRound.eliminatedPlayers.push(playerIndex);
    eliminationChange = 1;
  } else {
    currentRound.eliminatedPlayers.splice(playerIdx, 1);
    eliminationChange = -1;
  }

  currentRound.eliminationCount += eliminationChange;
  currentRound.eliminationCount = Math.max(
    0,
    Math.min(scoring.fullEliminationCount, currentRound.eliminationCount)
  );

  currentRound.status =
    currentRound.eliminationCount === scoring.fullEliminationCount
      ? "eliminated"
      : "alive";

  const oldTeamEliminated = team.isEliminated;
  team.isEliminated =
    currentRound.eliminationCount === scoring.fullEliminationCount;

  await team.save();
  void syncEliminationRealtime({ req, team, round: currentRound }).catch(
    (error) => {
      console.error("Failed to sync elimination realtime:", error.message);
    }
  );

  const toggleTemplate = logTemplates.eliminationUpdated({
    team,
    roundNumber: team.currentRound,
    playerIndex,
    eliminationCount: currentRound.eliminationCount,
    change: eliminationChange,
    fullEliminationCount: scoring.fullEliminationCount,
  });

  void safeCreateTeamLog({
    req,
    eventType: "ELIMINATION_UPDATED",
    severity: eliminationChange > 0 ? "highlight" : "info",
    team,
    roundNumber: team.currentRound,
    title: toggleTemplate.title,
    message: toggleTemplate.message,
    changes: [
      {
        field: "round.eliminationCount",
        previous: oldEliminationCount,
        current: currentRound.eliminationCount,
        delta: eliminationChange,
      },
      {
        field: "round.status",
        previous: oldStatus,
        current: currentRound.status,
      },
      {
        field: "round.eliminatedPlayers",
        previous: null,
        current: currentRound.eliminatedPlayers,
      },
    ],
    meta: {
      playerIndex,
      changeType: eliminationChange > 0 ? "eliminated" : "revived",
    },
  });

  if (currentRound.eliminationCount === scoring.fullEliminationCount) {
    const eliminatedTemplate = logTemplates.teamEliminated({
      team,
      roundNumber: team.currentRound,
      eliminationCount: currentRound.eliminationCount,
      fullEliminationCount: scoring.fullEliminationCount,
    });

    void safeCreateTeamLog({
      req,
      eventType: "TEAM_ELIMINATED",
      severity: "critical",
      team,
      roundNumber: team.currentRound,
      title: eliminatedTemplate.title,
      message: eliminatedTemplate.message,
      changes: [
        {
          field: "team.isEliminated",
          previous: oldTeamEliminated,
          current: true,
        },
        { field: "round.status", previous: oldStatus, current: "eliminated" },
      ],
    });
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        team,
        `Player ${playerIndex} elimination ${
          eliminationChange > 0 ? "added" : "removed"
        } successfully`
      )
    );
});

// Get All Teams
const getAllTeams = asyncHandler(async (req, res) => {
  const [teams, rosters] = await Promise.all([
    Team.find({ tournamentId: req.tournamentId })
      .sort({ totalPoints: -1 })
      .lean(),
    // Most recent rounds first. The latest round that actually holds a
    // registration (a player assigned to a team) decides who is still in the
    // tournament; an empty roster must never hide the whole field.
    MatchRoster.find({ tournamentId: req.tournamentId })
      .sort({ roundNumber: -1 })
      .select({ roundNumber: 1, "players.teamId": 1 })
      .lean(),
  ]);

  const activeRoster = rosters.find((roster) =>
    (roster.players || []).some((player) => player.teamId)
  );

  const data = markAbsentTeams(teams, activeRoster?.players ?? null);

  return res
    .status(200)
    .json(new ApiResponse(200, data, "Teams retrieved successfully"));
});

// Delete Team
const deleteTeam = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  if (!mongoose.isValidObjectId(teamId))
    throw new ApiError(400, "Invalid team ID");

  const team = await Team.findOneAndDelete({
    _id: teamId,
    tournamentId: req.tournamentId,
  });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const template = logTemplates.teamDeleted({ team });
  await safeCreateTeamLog({
    req,
    eventType: "TEAM_DELETED",
    severity: "critical",
    team,
    roundNumber: team.currentRound || null,
    title: template.title,
    message: template.message,
    changes: [
      { field: "team.deleted", previous: false, current: true },
      {
        field: "team.totalPoints",
        previous: team.totalPoints,
        current: team.totalPoints,
        delta: 0,
      },
    ],
  });

  broadcast(req, "team_deleted", teamId);

  // Cascade: the team must also vanish from auto-scoring (lobby rosters +
  // results verifications) and the learned player mapping, so no stale
  // reference to a deleted team is left behind.
  const teamObjectId = new mongoose.Types.ObjectId(teamId);
  await Promise.all([
    EliminationNotification.deleteMany({
      tournamentId: req.tournamentId,
      teamId,
    }),
    TeamLog.deleteMany({
      tournamentId: req.tournamentId,
      teamId,
      eventType: { $ne: "TEAM_DELETED" },
    }),
    // Remove every player mapped to this team (by id) or sitting in its slot
    // (unmatched rows) from all lobby rosters.
    MatchRoster.updateMany(
      { tournamentId: req.tournamentId },
      {
        $pull: {
          players: {
            $or: [{ teamId: teamObjectId }, { slot: team.slot }],
          },
        },
      }
    ),
    // Forget the learned player -> team mappings that pointed at this team.
    PlayerAlias.deleteMany({
      tournamentId: req.tournamentId,
      teamId: teamObjectId,
    }),
    // Drop the team from stored results verifications (auto scoring).
    MatchVerification.updateMany(
      { tournamentId: req.tournamentId },
      {
        $pull: {
          verified: { teamId: teamObjectId },
          comparison: { teamId: teamObjectId },
        },
      }
    ),
  ]);

  return res
    .status(200)
    .json(new ApiResponse(200, null, "Team deleted successfully"));
});

// Update Team
const updateTeam = asyncHandler(async (req, res) => {
  const { teamId } = req.params;

  if (!mongoose.isValidObjectId(teamId))
    throw new ApiError(400, "Invalid team ID");

  const team = await Team.findOne({ _id: teamId, tournamentId: req.tournamentId });
  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  const { name, slot } = req.body || {};
  const changes = [];

  if (name !== undefined) {
    const nextName = String(name).trim();
    if (!nextName) throw new ApiError(400, "Name cannot be empty");
    if (nextName !== team.name) {
      const duplicate = await Team.findOne({
        name: nextName,
        tournamentId: req.tournamentId,
        _id: { $ne: team._id },
      });
      if (duplicate)
        throw new ApiError(400, `Team name "${nextName}" already exists`);
      changes.push({ field: "name", previous: team.name, current: nextName });
      team.name = nextName;
    }
  }

  if (slot !== undefined) {
    const nextSlot = Number(slot);
    if (!Number.isInteger(nextSlot) || nextSlot < 1)
      throw new ApiError(400, "Slot must be a positive integer");
    if (nextSlot !== team.slot) {
      const duplicate = await Team.findOne({
        slot: nextSlot,
        tournamentId: req.tournamentId,
        _id: { $ne: team._id },
      });
      if (duplicate) throw new ApiError(400, `Slot ${nextSlot} already occupied`);
      changes.push({ field: "slot", previous: team.slot, current: nextSlot });
      team.slot = nextSlot;
    }
  }

  if (req.file?.path) {
    const cloudinaryConfigured = Boolean(
      process.env.CLOUD_NAME &&
        process.env.CLOUD_API_KEY &&
        process.env.CLOUD_API_SECRET
    );

    let logoUrl = "";
    if (cloudinaryConfigured) {
      const logo = await uploadOnCloudinary(req.file.path);
      logoUrl = logo?.url || "";
    } else {
      const base =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      logoUrl = `${base}/temp/${encodeURIComponent(req.file.filename)}`;
    }

    if (logoUrl && logoUrl !== team.logo) {
      changes.push({ field: "logo", previous: team.logo, current: logoUrl });
      team.logo = logoUrl;
    }
  }

  if (changes.length === 0) {
    return res
      .status(200)
      .json(new ApiResponse(200, team, "No changes applied"));
  }

  await team.save();

  const template = logTemplates.teamUpdated({ team, changes });
  await safeCreateTeamLog({
    req,
    eventType: "TEAM_UPDATED",
    severity: "info",
    team,
    roundNumber: team.currentRound || null,
    title: template.title,
    message: template.message,
    changes,
  });

  broadcast(req, "team_updated", team);

  return res
    .status(200)
    .json(new ApiResponse(200, team, "Team updated successfully"));
});

// Update Round Positions
const updateRoundPositions = asyncHandler(async (req, res) => {
  const { roundNumber, slotPositions } = req.body;

  if (!Array.isArray(slotPositions)) {
    throw new ApiError(400, "Slot positions must be an array");
  }

  const teams = await Team.find({ tournamentId: req.tournamentId });
  const scoring = getScoringConfig(req.tournament);
  const updates = await Promise.all(
    slotPositions.map(async ({ slot, position }) => {
      const team = teams.find((t) => t.slot === slot);
      if (!team) return null;

      const round = team.rounds.find((r) => r.roundNumber === roundNumber);
      if (!round) {
        throw new ApiError(
          404,
          `Round ${roundNumber} not found for team ${slot}`
        );
      }

      const oldPosition = round.position;
      const oldPoints = round.positionPoints;
      const oldTotalPoints = team.totalPoints;

      round.position = position;
      recomputeTeamScores(team, scoring);

      const pointsDifference = round.positionPoints - oldPoints;

      await team.save();

      const template = logTemplates.positionUpdated({
        team,
        roundNumber,
        previousPosition: oldPosition,
        currentPosition: position,
        pointsDelta: pointsDifference,
      });

      await safeCreateTeamLog({
        req,
        eventType: "POSITION_UPDATED",
        severity: pointsDifference > 0 ? "highlight" : "info",
        team,
        roundNumber,
        title: template.title,
        message: template.message,
        changes: [
          {
            field: "round.position",
            previous: oldPosition,
            current: position,
            delta: oldPosition && position ? position - oldPosition : null,
          },
          {
            field: "round.positionPoints",
            previous: oldPoints,
            current: round.positionPoints,
            delta: pointsDifference,
          },
          {
            field: "team.totalPoints",
            previous: oldTotalPoints,
            current: team.totalPoints,
            delta: team.totalPoints - oldTotalPoints,
          },
        ],
      });

      return team;
    })
  );

  const validUpdates = updates.filter((update) => update !== null);
  broadcast(req, "positions_updated", {
    roundNumber,
    slotPositions,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, validUpdates, "Positions updated successfully"));
});

const getTeamsByRound = async (req, res) => {
  try {
    const { roundNumber } = req.params;
    if (!roundNumber) {
      return res.status(400).json({
        statusCode: 400,
        message: "Round number is required",
        success: false,
      });
    }

    const teams = await Team.find({
      tournamentId: req.tournamentId,
      "rounds.roundNumber": roundNumber,
    });

    if (!teams.length) {
      return res.status(404).json({
        statusCode: 404,
        message: "No teams found for the given round number",
        success: false,
      });
    }

    const filteredTeams = teams.map((team) => {
      return {
        ...team.toObject(),
        rounds: team.rounds.filter(
          (round) => round.roundNumber === Number(roundNumber)
        ),
      };
    });

    res.status(200).json({
      statusCode: 200,
      data: filteredTeams,
      message: "Teams retrieved successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error fetching teams by round:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Internal Server Error",
      success: false,
    });
  }
};

export {
  createTeam,
  createBulkTeams,
  createRound,
  updateKills,
  handleElimination,
  getAllTeams,
  deleteTeam,
  updateTeam,
  updateRoundPositions,
  addKill,
  decreaseKill,
  deleteRoundFromTeams,
  getTeamsByRound,
};
