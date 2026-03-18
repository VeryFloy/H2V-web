import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../../middleware/auth.middleware';
import {
  loginHandler,
  sendOtpHandler,
  verifyOtpHandler,
  logoutHandler,
  getSessionsHandler,
  terminateSessionHandler,
  terminateOtherSessionsHandler,
} from './auth.controller';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many requests, try again later' },
});

router.post('/login',      authLimiter, loginHandler);
router.post('/send-otp',   authLimiter, sendOtpHandler);
router.post('/verify-otp', authLimiter, verifyOtpHandler);
router.post('/logout',     authLimiter, logoutHandler);

// Session management — auth required, no strict rate limit
router.get('/sessions',      authMiddleware, getSessionsHandler);
router.delete('/sessions/:id', authMiddleware, terminateSessionHandler);
router.delete('/sessions',   authMiddleware, terminateOtherSessionsHandler);

export default router;
