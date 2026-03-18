import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import {
  createSession as createDbSession,
  deleteSession,
  deleteSessionByToken,
  deleteOtherSessions as deleteOtherDbSessions,
  getUserSessions as getDbSessions,
} from '../../utils/session';
import { encryptValue, hashValue } from '../../utils/crypto';
import { sendOtpEmail } from '../../utils/email';
import { isDisposableEmail } from '../../utils/disposable-emails';
import type { SendOtpInput, VerifyOtpInput, LoginInput } from './auth.dto';

async function safeRedisOtp<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ─── OTP в Redis ──────────────────────────────────────────────────────────────
const OTP_TTL_SEC   = 600;   // 10 минут
const OTP_MAX_TRIES = 5;     // макс. попыток ввода

interface OtpData {
  code:      string;
  createdAt: number;
}

function otpKey(emailHash: string) { return `otp:${emailHash}`; }
function otpAttemptsKey(emailHash: string) { return `otp:att:${emailHash}`; }

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

async function saveOtp(emailHash: string, code: string): Promise<void> {
  const data: OtpData = { code, createdAt: Date.now() };
  await safeRedisOtp(() => redis.set(otpKey(emailHash), JSON.stringify(data), 'EX', OTP_TTL_SEC), 'OK');
  await safeRedisOtp(() => redis.del(otpAttemptsKey(emailHash)), 0);
}

async function getOtp(emailHash: string): Promise<OtpData | null> {
  const raw = await safeRedisOtp(() => redis.get(otpKey(emailHash)), null);
  return raw ? (JSON.parse(raw) as OtpData) : null;
}

async function deleteOtp(emailHash: string): Promise<void> {
  await safeRedisOtp(() => redis.del(otpKey(emailHash)), 0);
  await safeRedisOtp(() => redis.del(otpAttemptsKey(emailHash)), 0);
}

// ─── Отправить OTP на email ───────────────────────────────────────────────────
export async function sendOtp(input: SendOtpInput) {
  const email      = input.email.toLowerCase().trim();
  const emailHash  = hashValue(email);

  if (isDisposableEmail(email)) {
    throw new Error('DISPOSABLE_EMAIL');
  }

  const existing = await getOtp(emailHash);
  if (existing) {
    const elapsed = (Date.now() - existing.createdAt) / 1000;
    if (elapsed < 60) {
      throw new Error('OTP_TOO_SOON');
    }
  }

  const code = generateOtp();
  await saveOtp(emailHash, code);

  try {
    await sendOtpEmail(email, code);
  } catch (err) {
    await deleteOtp(emailHash);
    console.error('[Email OTP]', err);
    throw new Error('EMAIL_SEND_FAILED');
  }

  return { status: 'pending' };
}

// ─── Подтвердить OTP → вход или регистрация ───────────────────────────────────
const VERIFIED_TTL_SEC = 600;
function verifiedKey(emailHash: string) { return `otp:verified:${emailHash}`; }

export async function verifyOtp(
  input: VerifyOtpInput,
  req: { ip?: string; headers: { [key: string]: string | string[] | undefined } },
) {
  const email     = input.email.toLowerCase().trim();
  const emailHash = hashValue(email);

  const alreadyVerified = await safeRedisOtp(() => redis.get(verifiedKey(emailHash)), null);

  if (!alreadyVerified) {
    const otpData = await getOtp(emailHash);
    if (!otpData) throw new Error('OTP_EXPIRED');

    // Atomic increment — prevents race-condition brute-force bypass
    const attempts = await safeRedisOtp(() => redis.incr(otpAttemptsKey(emailHash)), 1);
    if (attempts === 1) {
      await safeRedisOtp(() => redis.expire(otpAttemptsKey(emailHash), OTP_TTL_SEC), 0);
    }
    if (attempts > OTP_MAX_TRIES) {
      await deleteOtp(emailHash);
      throw new Error('OTP_MAX_ATTEMPTS');
    }

    const codeMatch = crypto.timingSafeEqual(
      Buffer.from(otpData.code),
      Buffer.from(input.code.padEnd(otpData.code.length)),
    );
    if (!codeMatch || otpData.code.length !== input.code.length) {
      throw new Error('INVALID_CODE');
    }

    await deleteOtp(emailHash);

    const existingUser = await prisma.user.findUnique({ where: { emailHash } });
    if (existingUser) {
      const { token, session } = await createDbSession(existingUser.id, existingUser.nickname, req);
      return {
        isNewUser: false,
        user: { id: existingUser.id, nickname: existingUser.nickname, avatar: existingUser.avatar },
        sessionToken: token,
        sessionId: session.id,
      };
    }

    if (!input.nickname) {
      await safeRedisOtp(() => redis.set(verifiedKey(emailHash), '1', 'EX', VERIFIED_TTL_SEC), 'OK');
      throw new Error('NICKNAME_REQUIRED');
    }
  }

  const nick = input.nickname;
  if (!nick) throw new Error('NICKNAME_REQUIRED');

  await safeRedisOtp(() => redis.del(verifiedKey(emailHash)), 0);

  const encryptedEmail = encryptValue(email);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        nickname:  nick,
        email:     encryptedEmail,
        emailHash,
      },
      select: { id: true, nickname: true, avatar: true, createdAt: true },
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new Error('NICKNAME_TAKEN');
    }
    throw err;
  }

  const { token, session } = await createDbSession(user.id, user.nickname, req);
  return { isNewUser: true, user, sessionToken: token, sessionId: session.id };
}

// ─── Вход по никнейму + пароль ───────────────────────────────────────────────
export async function loginWithPassword(
  input: LoginInput,
  req: { ip?: string; headers: { [key: string]: string | string[] | undefined } },
) {
  const user = await prisma.user.findUnique({ where: { nickname: input.nickname } });
  if (!user || !user.passwordHash) throw new Error('INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new Error('INVALID_CREDENTIALS');

  const { token, session } = await createDbSession(user.id, user.nickname, req);
  return {
    user: { id: user.id, nickname: user.nickname, avatar: user.avatar },
    sessionToken: token,
    sessionId: session.id,
  };
}

// ─── Выход ────────────────────────────────────────────────────────────────────
export async function logout(rawToken: string) {
  await deleteSessionByToken(rawToken);
}

// ─── Управление сессиями ──────────────────────────────────────────────────────
export async function getActiveSessions(userId: string) {
  return getDbSessions(userId);
}

export async function terminateSession(sessionId: string, userId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!session || session.userId !== userId) {
    throw new Error('SESSION_NOT_FOUND');
  }
  await deleteSession(sessionId);
}

export async function terminateOtherSessions(userId: string, currentSessionId: string) {
  return deleteOtherDbSessions(userId, currentSessionId);
}
