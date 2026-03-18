import 'dotenv/config';
import http from 'http';
import path from 'path';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { prisma } from './config/database';
import { redis } from './config/redis';
import { errorMiddleware } from './middleware/error.middleware';
import { createWsServer } from './websocket/ws.server';

import { startDisposableEmailsAutoRefresh } from './utils/disposable-emails';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/user.routes';
import chatRoutes from './modules/chats/chat.routes';
import messageRoutes from './modules/messages/message.routes';
import keysRoutes from './modules/keys/keys.routes';
import uploadRoutes from './modules/upload/upload.routes';
import contactRoutes from './modules/contacts/contact.routes';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Доверяем заголовкам прокси (Tuna / nginx)
app.set('trust proxy', 1);

// ─── Rate limiters ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: 'Too many requests, try again later' },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : process.env.NODE_ENV === 'production' ? false : true,
  credentials: true,
}));
import cookieParser from 'cookie-parser';
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ─── Public avatar access (no auth required, needed for push notification icons) ──
import { validateSession } from './utils/session';
import { isS3Enabled, getPresignedUrl } from './config/s3';
const uploadsPath = path.join(__dirname, '../../uploads');

app.use('/uploads/avatars', (req, res, next) => {
  if (isS3Enabled()) {
    const s3Key = `uploads/avatars${req.path}`;
    getPresignedUrl(s3Key)
      .then((url) => res.redirect(302, url))
      .catch(() => next());
    return;
  }
  next();
}, express.static(path.join(uploadsPath, 'avatars')));

// ─── Uploads (protected — requires h2v_session cookie or Authorization header) ──

function getSessionCookie(req: import('express').Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const match = header.split(';').find(c => c.trim().startsWith('h2v_session='));
  return match ? decodeURIComponent(match.split('=')[1].trim()) : undefined;
}

const UNAUTHORIZED_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>H2V</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8e8f0}
.c{text-align:center;padding:40px 20px}
.icon{width:64px;height:64px;margin:0 auto 24px;opacity:.4}
h1{font-size:18px;font-weight:500;margin-bottom:8px;color:#a0a0b8}
p{font-size:14px;color:#6c6c8a;line-height:1.5}
code{display:inline-block;margin-top:16px;font-size:12px;color:#4a4a5a;letter-spacing:1px}
</style></head><body><div class="c">
<svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#6c6c8a" stroke-width="1.5"/><polyline points="14 2 14 8 20 8" stroke="#6c6c8a" stroke-width="1.5"/><line x1="9" y1="15" x2="15" y2="15" stroke="#6c6c8a" stroke-width="1.5"/></svg>
<h1>Не удалось получить доступ к файлу</h1>
<p>Войдите в аккаунт H2V для просмотра этого файла.</p>
<code>ERR_UNAUTHORIZED</code>
</div></body></html>`;

function sendUnauthorized(res: import('express').Response) {
  res.status(401).type('html').send(UNAUTHORIZED_HTML);
}

app.use('/uploads', (req, res, next) => {
  const token =
    getSessionCookie(req) ||
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) { sendUnauthorized(res); return; }

  validateSession(token)
    .then((session) => {
      if (!session) { sendUnauthorized(res); return; }

      if (isS3Enabled()) {
        const s3Key = `uploads${req.path}`;
        getPresignedUrl(s3Key)
          .then((url) => res.redirect(302, url))
          .catch(err => { console.warn('[S3] Presigned URL failed, falling back to disk:', err.message); next(); });
        return;
      }

      next();
    })
    .catch(() => { sendUnauthorized(res); });
}, express.static(uploadsPath));

// ─── Frontend static (SolidJS build) ─────────────────────────────────────────
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ─── Healthcheck ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', async (_req, res) => {
  const result: Record<string, string> = { status: 'ok', timestamp: new Date().toISOString() };

  // Проверка PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.db = 'ok';
  } catch {
    result.db = 'error';
    result.status = 'degraded';
  }

  // Проверка Redis
  try {
    await redis.ping();
    result.redis = 'ok';
  } catch {
    result.redis = 'error';
    result.status = result.status === 'ok' ? 'degraded' : result.status;
  }

  const statusCode = result.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(result);
});

// ─── VAPID public key (for Web Push subscription) ────────────────────────────
app.get('/api/push/vapid-key', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY ?? '';
  if (!key) { res.status(503).json({ success: false, message: 'Push not configured' }); return; }
  res.json({ success: true, data: { vapidPublicKey: key } });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/chats', apiLimiter, chatRoutes);
app.use('/api', apiLimiter, messageRoutes);
app.use('/api/keys', apiLimiter, keysRoutes);
app.use('/api/upload', apiLimiter, uploadRoutes);
app.use('/api/contacts', apiLimiter, contactRoutes);

import linkPreviewRoutes from './modules/linkpreview/linkpreview.routes';
app.use('/api/link-preview', apiLimiter, linkPreviewRoutes);

// ─── SPA fallback — все неизвестные GET → index.html ─────────────────────────
app.get(/^(?!\/api|\/uploads|\/ws|\/health).*/, (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorMiddleware);

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const httpServer = http.createServer(app);
const wss = createWsServer(httpServer);

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');
    await prisma.user.updateMany({ where: { isOnline: true }, data: { isOnline: false } });
  } catch (err) {
    console.error('[DB] Failed to connect to PostgreSQL:', err);
    process.exit(1);
  }

  // Redis — опциональный, не блокирует старт
  redis.connect().catch(() => {
    console.warn('[Redis] Not available — presence features disabled');
  });

  // Блэклист одноразовых email-доменов (обновляется каждый час)
  startDisposableEmailsAutoRefresh();

  // Автоочистка истёкших сессий каждый час
  const cleanupExpiredSessions = async () => {
    try {
      const { count } = await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) console.log(`[Cleanup] Удалено ${count} истёкших сессий`);
    } catch (err) {
      console.error('[Cleanup] Ошибка очистки сессий:', err);
    }
  };
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

  // Авто-удаление неактивных аккаунтов (как в Telegram)
  const cleanupInactiveAccounts = async () => {
    try {
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      const BATCH_SIZE = 100;
      let deleted = 0;
      let cursor: string | undefined;

      while (true) {
        const users = await prisma.user.findMany({
          where: { settings: { not: null }, isOnline: false },
          select: { id: true, settings: true, lastOnline: true },
          take: BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: 'asc' },
        });

        if (users.length === 0) break;
        cursor = users[users.length - 1].id;

        const now = Date.now();
        const idsToDelete: string[] = [];

        for (const u of users) {
          const s = u.settings as Record<string, unknown> | null;
          const val = s?.autoDeleteMonths;
          if (!val || val === 'never') continue;
          const months = parseInt(String(val), 10);
          if (!months || isNaN(months)) continue;
          const lastActive = u.lastOnline ? new Date(u.lastOnline).getTime() : 0;
          if (lastActive > 0 && now - lastActive > months * monthMs) {
            idsToDelete.push(u.id);
          }
        }

        if (idsToDelete.length > 0) {
          const result = await prisma.user.deleteMany({ where: { id: { in: idsToDelete } } });
          deleted += result.count;
        }

        if (users.length < BATCH_SIZE) break;
      }

      if (deleted > 0) console.log(`[Cleanup] Auto-deleted ${deleted} inactive accounts`);
    } catch (err) {
      console.error('[Cleanup] Error cleaning inactive accounts:', err);
    }
  };
  setInterval(cleanupInactiveAccounts, 6 * 60 * 60 * 1000); // every 6 hours

  httpServer.listen(PORT, () => {
    console.log(`[App] HTTP  → http://localhost:${PORT}`);
    console.log(`[App] WS   → ws://localhost:${PORT}/ws`);
    console.log(`[App] Health → http://localhost:${PORT}/health`);
  });
}

start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown() {
  console.log('[App] Shutting down...');
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }
  wss.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
