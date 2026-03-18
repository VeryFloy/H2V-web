import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import * as authService from './auth.service';
import { SendOtpDto, VerifyOtpDto, LoginDto } from './auth.dto';
import { ok, fail } from '../../utils/response';
import { SESSION_COOKIE_MAX_AGE_MS } from '../../utils/session';
import { extractSessionToken } from '../../middleware/auth.middleware';
import { AuthRequest } from '../../types';

const SESSION_COOKIE = 'h2v_session';
const IS_PROD = process.env.NODE_ENV === 'production';

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function zodMessage(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'VALIDATION_ERROR';
  const codes: Record<string, string> = {
    'Invalid email':                        'EMAIL_INVALID',
    'Code must be 6 digits':                'CODE_INVALID',
    'Code must be digits only':             'CODE_INVALID',
    'Nickname min 5 chars':                 'NICKNAME_TOO_SHORT',
    'Only letters, digits and underscores': 'NICKNAME_INVALID_CHARS',
  };
  return codes[first.message] ?? `VALIDATION_ERROR:${first.path.join('.')}`;
}

const ERROR_MAP: Record<string, [string, number]> = {
  OTP_TOO_SOON:       ['OTP_TOO_SOON', 429],
  EMAIL_SEND_FAILED:  ['EMAIL_SEND_FAILED', 502],
  OTP_EXPIRED:        ['OTP_EXPIRED', 400],
  INVALID_CODE:       ['INVALID_CODE', 400],
  OTP_MAX_ATTEMPTS:   ['OTP_MAX_ATTEMPTS', 429],
  DISPOSABLE_EMAIL:    ['DISPOSABLE_EMAIL', 422],
  NICKNAME_REQUIRED:   ['NICKNAME_REQUIRED', 422],
  NICKNAME_TAKEN:      ['NICKNAME_TAKEN', 409],
  EMAIL_INVALID:       ['EMAIL_INVALID', 422],
  INVALID_CREDENTIALS: ['INVALID_CREDENTIALS', 401],
  SESSION_NOT_FOUND:   ['SESSION_NOT_FOUND', 404],
};

function handleError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof ZodError) { fail(res, zodMessage(err), 422); return; }
  if (err instanceof Error) {
    const mapped = ERROR_MAP[err.message];
    if (mapped) { fail(res, mapped[0], mapped[1]); return; }
  }
  next(err);
}

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────
export async function sendOtpHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = SendOtpDto.parse(req.body);
    const result = await authService.sendOtp(input);
    ok(res, result);
  } catch (err) { handleError(err, res, next); }
}

// ─── POST /api/auth/verify-otp ───────────────────────────────────────────────
export async function verifyOtpHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = VerifyOtpDto.parse(req.body);
    const result = await authService.verifyOtp(input, req);
    setSessionCookie(res, result.sessionToken);
    ok(res, {
      isNewUser: result.isNewUser,
      user: result.user,
    }, result.isNewUser ? 201 : 200);
  } catch (err) { handleError(err, res, next); }
}

// ─── POST /api/auth/login (nickname + password) ──────────────────────────────
export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = LoginDto.parse(req.body);
    const result = await authService.loginWithPassword(input, req);
    setSessionCookie(res, result.sessionToken);
    ok(res, { user: result.user });
  } catch (err) { handleError(err, res, next); }
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
export async function logoutHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req as AuthRequest);
    if (token) {
      await authService.logout(token);
    }
    clearSessionCookie(res);
    ok(res, { message: 'Logged out' });
  } catch (err) { next(err); }
}

// ─── GET /api/auth/sessions ──────────────────────────────────────────────────
export async function getSessionsHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessions = await authService.getActiveSessions(req.user!.sub);
    const currentSessionId = req.user!.sessionId;
    const mapped = sessions.map((s) => ({
      ...s,
      isCurrent: s.id === currentSessionId,
    }));
    ok(res, mapped);
  } catch (err) { next(err); }
}

// ─── DELETE /api/auth/sessions/:id ───────────────────────────────────────────
export async function terminateSessionHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    if (id === req.user!.sessionId) {
      fail(res, 'Cannot terminate current session — use logout', 400);
      return;
    }
    await authService.terminateSession(id, req.user!.sub);

    const { closeSessionSockets } = await import('../../websocket/ws.server');
    closeSessionSockets(id);

    ok(res, { terminated: id });
  } catch (err) { handleError(err, res, next); }
}

// ─── DELETE /api/auth/sessions ───────────────────────────────────────────────
export async function terminateOtherSessionsHandler(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const count = await authService.terminateOtherSessions(req.user!.sub, req.user!.sessionId);

    // Close all WebSocket connections except current session
    const { closeOtherSessionSockets } = await import('../../websocket/ws.server');
    closeOtherSessionSockets(req.user!.sub, req.user!.sessionId);

    ok(res, { terminated: count });
  } catch (err) { next(err); }
}
