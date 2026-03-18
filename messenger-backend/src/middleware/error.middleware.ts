import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

// Business logic errors → proper HTTP status codes
const BUSINESS_ERROR_CODES: Record<string, number> = {
  'Forbidden': 403,
  'Not found': 404,
  'Not a member of this chat': 403,
  'Message not found': 404,
  'Chat not found': 404,
  'User not found': 404,
  'Cannot create chat with yourself': 400,
  'Message is deleted': 400,
  'Invalid emoji': 400,
  'OTP_EXPIRED': 400,
  'INVALID_CODE': 400,
  'OTP_MAX_ATTEMPTS': 429,
  'OTP_TOO_SOON': 429,
  'NICKNAME_TAKEN': 409,
  'NICKNAME_REQUIRED': 422,
  'Refresh token expired or not found': 401,
  'Invalid refresh token': 401,
};

// Prisma error codes → HTTP status codes
const PRISMA_CLIENT_CODES: Record<string, { status: number; message: string }> = {
  P2002: { status: 409, message: 'Already exists' },
  P2025: { status: 404, message: 'Not found' },
  P2003: { status: 400, message: 'Invalid reference' },
};

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation error',
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  // Prisma-ошибки: логируем полностью, клиенту даём безопасное сообщение
  if (err instanceof Error && 'code' in err) {
    const prismaErr = err as Error & { code: string };
    console.error('[Prisma]', prismaErr.code, prismaErr.message);
    const mapped = PRISMA_CLIENT_CODES[prismaErr.code];
    if (mapped) {
      res.status(mapped.status).json({ success: false, code: prismaErr.code, message: mapped.message });
    } else {
      res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
    return;
  }

  if (err instanceof Error) {
    const status = BUSINESS_ERROR_CODES[err.message] ?? 500;
    if (status === 500) {
      console.error('[Error]', err.message, err.stack);
      res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
    } else {
      res.status(status).json({ success: false, code: err.message, message: err.message });
    }
    return;
  }

  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Internal server error' });
}
