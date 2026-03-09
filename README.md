# H2V Messenger

Real-time messenger with E2E encryption support, built with SolidJS (frontend) and Express (backend).

## Architecture

```
frontend/          SolidJS + TypeScript + Vite (PWA)
messenger-backend/ Express 5 + Prisma + PostgreSQL + Redis + WebSocket
```

## Tech Stack

### Frontend
- **SolidJS** — reactive UI framework
- **TypeScript** + **Vite** — build tooling
- **CSS Modules** — scoped styling
- **Signal Protocol** — E2E encryption (client-side)
- **PWA** — service worker, push notifications, installable

### Backend
- **Express 5** — REST API
- **WebSocket (ws)** — real-time messaging, typing, presence
- **Prisma** — ORM (PostgreSQL)
- **Redis** — presence, OTP caching, typing state
- **JWT** — authentication (access + refresh tokens)
- **Resend** — email OTP delivery
- **Sharp** — image processing (avatars)
- **Zod** — request validation

## Features

- Direct and group chats (up to 200 members)
- E2E encrypted secret chats (Signal Protocol)
- Message editing, deletion, reactions, replies
- Read receipts and delivery status
- Typing indicators
- User presence (online/offline/last seen)
- Media uploads (images, video, audio, files)
- Voice messages
- Push notifications
- Multi-language support (RU/EN)
- Chat muting
- User search
- Profile management (avatar, bio, names)

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+

## Setup

### 1. Backend

```bash
cd messenger-backend
cp .env.example .env
# Edit .env with your database, Redis, JWT, and Resend credentials

npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs on `http://localhost:5173`, the backend on `http://localhost:3000`.

## Environment Variables

See `messenger-backend/.env.example` for the full list of required environment variables.

Key variables:
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens |
| `REDIS_HOST` | Redis server host |
| `RESEND_API_KEY` | Resend API key for email OTP |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM encryption |
| `HASH_SECRET` | HMAC secret for deterministic email hashing |

## API

See `API.md` for the full REST API documentation.

## Scripts

### Backend
| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:studio` | Open Prisma Studio |

### Frontend
| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
