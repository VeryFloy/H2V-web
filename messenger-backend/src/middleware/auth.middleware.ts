import { Response, NextFunction } from 'express';
import { validateSession } from '../utils/session';
import { AuthRequest } from '../types';
import { fail } from '../utils/response';

function extractSessionToken(req: AuthRequest): string | undefined {
  // 1) HttpOnly cookie (web clients)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.split(';').find((c) => c.trim().startsWith('h2v_session='));
    if (match) return decodeURIComponent(match.split('=')[1].trim());
  }

  // 2) Authorization header (mobile clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return undefined;
}

export { extractSessionToken };

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const token = extractSessionToken(req);

  if (!token) {
    fail(res, 'Unauthorized — no session', 401);
    return;
  }

  validateSession(token)
    .then((payload) => {
      if (!payload) {
        fail(res, 'Unauthorized — invalid or expired session', 401);
        return;
      }
      req.user = payload;
      next();
    })
    .catch(() => {
      fail(res, 'Unauthorized — session validation failed', 401);
    });
}
