import { Router } from 'express';
import {
  trackElimination,
  checkDisplayStatus,
  markAsDisplayed2,
  syncEliminations,
  getPendingNotifications,
  markAsDisplayed,
  resetRound,
  getAllNotifications,
  resetAllTracking,
} from '../controllers/eliminationNotification.controller.js';

const router = Router();

// Frontend API endpoints
router.post('/track', trackElimination);
router.post('/display', markAsDisplayed2);
router.get('/check/:teamId/:roundNumber', checkDisplayStatus);

// Admin/sync endpoints
router.post('/sync', syncEliminations);
router.get('/pending', getPendingNotifications);
router.get('/all', getAllNotifications);
router.patch('/:notificationId/displayed', markAsDisplayed);
router.patch('/round/:roundNumber/reset', resetRound);
router.delete('/reset', resetAllTracking);

export default router;
