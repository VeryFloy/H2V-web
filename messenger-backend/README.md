<div align="center">

# H2V Messenger — API Server

**REST + WebSocket backend for the H2V Messenger platform**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com)

</div>

---

## Table of Contents

- [About](#about)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [API Documentation](API.md)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## About

This is the backend API for H2V Messenger. It provides:

- **REST API** — auth (email OTP), users, chats, messages, uploads, Signal Protocol key bundles
- **WebSocket** — real-time events: messages, typing, presence, read receipts, reactions
- **Push notifications** — Web Push (VAPID) for PWA, APNs for iOS
- **Media storage** — S3-compatible or local disk

The web client is open source: [H2V-web](https://github.com/VeryFloy/H2V-web).

---

## Architecture

```
src/
├── app.ts                  # Entry point — Express + WebSocket mount
├── websocket/
│   ├── ws.server.ts        # WebSocket server, auth handshake, ping/pong, presence
│   ├── ws.handler.ts       # Event dispatcher
│   └── events/             # Handlers for message:send, typing, presence, etc.
├── modules/                # Feature modules
│   ├── auth/               # OTP send/verify, refresh, logout
│   ├── users/              # Profile, search, settings
│   ├── chats/              # Direct/group/secret chats, members
│   ├── messages/           # CRUD, search, reactions, read receipts
│   ├── keys/               # Signal Protocol key bundles
│   ├── contacts/           # Contact list
│   └── upload/             # File upload, avatar
├── config/                 # Database, Redis, S3 clients
├── middleware/             # Auth, error handling
└── utils/                  # JWT, push notifications, email, crypto

prisma/
├── schema.prisma           # Database schema
└── migrations/             # SQL migrations
```

**Communication flow:**
```
Client ←── WebSocket (/ws) ──→ ws.server.ts   (real-time events)
Client ←── REST API (/api) ──→ Express router  (CRUD operations)
Client ←── /uploads      ────→ S3 / local disk (media files)
```

---

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** 15+
- **Redis** 7+
- [Resend](https://resend.com) account for email OTP

---

## Getting Started

```bash
# Clone and enter the repo
git clone https://github.com/VeryFloy/H2V-servers.git
cd H2V-servers

# Copy env and fill in values
cp .env.example .env
# Edit .env — DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_HOST, RESEND_API_KEY, etc.

# Install dependencies
npm install

# Generate Prisma client & run migrations
npx prisma generate
npx prisma migrate dev

# Start dev server (http://localhost:3000)
npm run dev
```

The API runs on **http://localhost:3000**. The web client (H2V-web) proxies `/api`, `/uploads`, and `/ws` to this port during development.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all required values.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/messenger_db` |
| `JWT_SECRET` | Secret for signing access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (min 32 chars) |
| `REDIS_HOST` | Redis hostname (default: `localhost`) |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for email OTP |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM (email encryption) |
| `HASH_SECRET` | HMAC secret for deterministic email hashing |
| `CORS_ORIGIN` | Allowed origins, comma-separated (e.g. `http://localhost:5173`, `https://h2von.com`) |
| `BASE_URL` | Public base URL (e.g. `https://h2von.com`) |

### Optional

| Variable | Description |
|---|---|
| `S3_ENDPOINT` | S3-compatible endpoint (iDrive e2, AWS, MinIO, R2) |
| `S3_ACCESS_KEY` | S3 access key |
| `S3_SECRET_KEY` | S3 secret key |
| `S3_BUCKET` | S3 bucket name |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `APNS_KEY_ID` | Apple APNs key ID |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | iOS app bundle ID |
| `APNS_KEY_PATH` | Path to .p8 file on disk |
| `APNS_KEY_CONTENT` | Base64-encoded .p8 key (for containers) |

**Generate keys:**
```bash
# VAPID keys for Web Push
npx web-push generate-vapid-keys

# Encryption key (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# APNs .p8 to base64
base64 -w 0 AuthKey_XXXXX.p8
```

---

## API Overview

**Base URL:** `/api` (e.g. `https://h2von.com/api`)

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh`, `POST /auth/logout` |
| Users | `GET /users/me`, `PATCH /users/me`, `GET /users/:id`, `GET /users/search` |
| Chats | `GET /chats`, `POST /chats/direct`, `POST /chats/group`, `POST /chats/secret` |
| Messages | `GET /chats/:id/messages`, `PATCH /messages/:id`, `DELETE /messages/:id` |
| Upload | `POST /upload`, `POST /upload/avatar` |
| Keys | `POST /keys/bundle`, `GET /keys/bundle/:userId` (Signal Protocol) |
| Contacts | `GET /contacts`, `POST /contacts`, `DELETE /contacts/:userId` |

**WebSocket** (`/ws`): Connect with `Authorization: Bearer <accessToken>` or send `{ event: 'auth', payload: { token } }` as first message. Events: `message:new`, `typing:started`, `user:online`, etc.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production server |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm test` | Run tests |

---

## Deployment

GitHub Actions deploys on push to `main`:

1. SSH to server
2. `npm ci`
3. `npx prisma migrate deploy`
4. `pm2 restart` (or equivalent)

**Required GitHub Secrets:** `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.
