import { EliminationNotification } from '../models/eliminationNotification.model.js';
import { Team } from '../models/team.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// Track or create elimination
export const trackElimination = asyncHandler(async (req, res) => {
  const { teamId, roundNumber } = req.body;

  if (!teamId || !roundNumber) {
    throw new ApiError(400, 'teamId and roundNumber are required');
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(404, 'Team not found');
  }

  const round = team.rounds.find(r => r.roundNumber === roundNumber);
  if (!round) {
    throw new ApiError(404, 'Round not found');
  }

  const isEliminated = round.eliminationCount >= 4;

  const notification = await EliminationNotification.findOneAndUpdate(
    { teamId, roundNumber },
    {
      teamId,
      teamName: team.name,
      roundNumber,
      status: isEliminated ? 'eliminated' : 'alive',
      killCount: round.kills || 0,
      position: round.position || 0,
    },
    { upsert: true, new: true }
  );

  return res.status(200).json(
    new ApiResponse(200, notification, 'Elimination tracked')
  );
});

// Check display status
export const checkDisplayStatus = asyncHandler(async (req, res) => {
  const { teamId, roundNumber } = req.params;

  const notification = await EliminationNotification.findOne({
    teamId,
    roundNumber: parseInt(roundNumber),
  });

  if (!notification) {
    return res.status(200).json(
      new ApiResponse(200, { displayed: false, tracked: false }, 'Not tracked yet')
    );
  }

  return res.status(200).json(
    new ApiResponse(200, { displayed: notification.displayed, tracked: true, tracking: notification }, 'Status checked')
  );
});

// Mark as displayed (updated for frontend compatibility)
export const markAsDisplayed2 = asyncHandler(async (req, res) => {
  const { teamId, roundNumber } = req.body;

  if (!teamId || !roundNumber) {
    throw new ApiError(400, 'teamId and roundNumber are required');
  }

  const notification = await EliminationNotification.findOneAndUpdate(
    { teamId, roundNumber },
    { displayed: true },
    { new: true }
  );

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  return res.status(200).json(
    new ApiResponse(200, notification, 'Marked as displayed')
  );
});

// Sync eliminations from Team data
export const syncEliminations = asyncHandler(async (req, res) => {
  const teams = await Team.find({});

  let synced = 0;

  for (const team of teams) {
    for (const round of team.rounds) {
      const isEliminated = round.eliminationCount >= 4;
      const status = isEliminated ? 'eliminated' : 'alive';

      let notification = await EliminationNotification.findOne({
        teamId: team._id,
        roundNumber: round.roundNumber,
      });

      if (!notification) {
        notification = await EliminationNotification.create({
          teamId: team._id,
          teamName: team.name,
          roundNumber: round.roundNumber,
          status: status,
          displayed: false,
          killCount: round.kills || 0,
          position: round.position || 0,
        });
        synced++;
      } else if (notification.status !== status) {
        notification.status = status;
        notification.killCount = round.kills || 0;
        notification.position = round.position || 0;
        await notification.save();
        synced++;
      }
    }
  }

  const eliminated = await EliminationNotification.find({
    status: 'eliminated',
    eliminationOrder: 0
  }).sort({ createdAt: 1 });

  let order = await EliminationNotification.countDocuments({ status: 'alive' });
  for (const notif of eliminated) {
    notif.eliminationOrder = order;
    await notif.save();
    order--;
  }

  return res.status(200).json(
    new ApiResponse(200, { synced }, 'Eliminations synced successfully')
  );
});

// Get pending notifications (eliminated but not displayed)
export const getPendingNotifications = asyncHandler(async (req, res) => {
  const { roundNumber } = req.query;

  const query = {
    status: 'eliminated',
    displayed: false,
  };

  if (roundNumber) {
    query.roundNumber = parseInt(roundNumber);
  }

  const notifications = await EliminationNotification.find(query)
    .sort({ createdAt: 1 })
    .populate('teamId', 'logo');

  return res.status(200).json(
    new ApiResponse(200, notifications, 'Pending notifications retrieved')
  );
});

// Mark notification as displayed (original version)
export const markAsDisplayed = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;

  const notification = await EliminationNotification.findById(notificationId);

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  notification.displayed = true;
  await notification.save();

  return res.status(200).json(
    new ApiResponse(200, notification, 'Notification marked as displayed')
  );
});

// Reset all notifications for a round
export const resetRound = asyncHandler(async (req, res) => {
  const { roundNumber } = req.params;

  await EliminationNotification.updateMany(
    { roundNumber: parseInt(roundNumber) },
    { displayed: false, status: 'alive', eliminationOrder: 0 }
  );

  return res.status(200).json(
    new ApiResponse(200, {}, 'Round notifications reset')
  );
});

// Get all notifications for admin view
export const getAllNotifications = asyncHandler(async (req, res) => {
  const { roundNumber } = req.query;
  
  const query = roundNumber ? { roundNumber: parseInt(roundNumber) } : {};

  const notifications = await EliminationNotification.find(query)
    .sort({ roundNumber: 1, createdAt: 1 })
    .populate('teamId', 'logo');

  return res.status(200).json(
    new ApiResponse(200, notifications, 'Notifications retrieved')
  );
});

// Reset all tracking
export const resetAllTracking = asyncHandler(async (req, res) => {
  await EliminationNotification.deleteMany({});

  return res.status(200).json(
    new ApiResponse(200, {}, 'All elimination tracking reset')
  );
});
