<div align="center">

# H2V Messenger

**A modern, privacy-focused real-time messenger with end-to-end encryption**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C?logo=solid&logoColor=white)](https://www.solidjs.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Live Demo](https://h2von.com) · [Report Bug](https://github.com/Angell316/h2vTest/issues/new?template=bug_report.yml) · [Request Feature](https://github.com/Angell316/h2vTest/issues/new?template=feature_request.yml)

</div>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
- [Environment Variables](#environment-variables)
- [API](#api)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## About

H2V Messenger is a full-stack real-time messaging application built with a focus on privacy and performance. It supports end-to-end encrypted **Secret Chats** using the [Signal Protocol](https://signal.org/docs/), regular direct and group conversations, voice messages, file sharing, and push notifications for both web and iOS.

The project is a monorepo containing the **SolidJS** web client and the **Node.js/Express** backend API.

---

## Features

| Feature | Status |
|---|:---:|
| Direct chats & group chats (up to 200 members) | ✅ |
| Secret chats — E2E encryption (Signal Protocol) | ✅ |
| Voice messages with waveform visualization | ✅ |
| Media uploads — images, video, audio, files | ✅ |
| Message replies, forwarding, editing, deletion | ✅ |
| Message reactions (emoji) | ✅ |
| Read receipts & delivery status | ✅ |
| Typing indicators | ✅ |
| Online/offline presence & last seen | ✅ |
| Web push notifications (PWA) | ✅ |
| iOS push notifications (APNs) | ✅ |
| Progressive Web App — installable on any device | ✅ |
| Multi-language support (RU / EN) | ✅ |
| User search, blocking, contact management | ✅ |
| Profile — avatar, bio, display name, privacy settings | ✅ |
| Chat pinning & muting | ✅ |
| Message pinning | ✅ |

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| [SolidJS](https://www.solidjs.com) | Reactive UI framework |
| [TypeScript](https://www.typescriptlang.org) | Type safety |
| [Vite](https://vitejs.dev) | Build tooling & dev server |
| CSS Modules | Scoped component styles |
| [Signal Protocol](https://signal.org/docs/) | E2E encryption (client-side) |
| Service Worker | PWA, offline support, push notifications |

### Backend
| Technology | Purpose |
|---|---|
| [Node.js](https://nodejs.org) 20+ / [Express 5](https://expressjs.com) | HTTP server & REST API |
| [`ws`](https://github.com/websockets/ws) | Native WebSocket server (real-time) |
| [Prisma](https://www.prisma.io) | ORM for PostgreSQL |
| [PostgreSQL](https://www.postgresql.org) 15+ | Primary database |
| [Redis](https://redis.io) 7+ | Presence, typing state, OTP caching |
| [JWT](https://jwt.io) | Authentication (access + refresh tokens) |
| [Resend](https://resend.com) | Email OTP delivery |
| [Sharp](https://sharp.pixelplumbing.com) | Server-side image processing |
| [Zod](https://zod.dev) | Request validation |
| [node-apn](https://github.com/node-apn/node-apn) | Apple Push Notifications (APNs) |
| [web-push](https://github.com/web-push-libs/web-push) | Web Push (VAPID) |
| S3-compatible storage | Media file storage (iDrive e2 / MinIO / AWS) |

---

## Architecture

```
h2vTest/
├── frontend/                   # SolidJS PWA client
│   ├── src/
│   │   ├── api/client.ts       # REST API client (fetch + token refresh)
│   │   ├── stores/             # Reactive state (SolidJS stores)
│   │   │   ├── ws.store.ts     # WebSocket lifecycle & reconnection
│   │   │   ├── chat.store.ts   # Chats & messages state
│   │   │   ├── auth.store.ts   # Authentication state
│   │   │   └── e2e.store.ts    # Signal Protocol E2E state
│   │   ├── components/         # UI components
│   │   └── crypto/e2e.ts       # Signal Protocol wrapper
│   └── public/
│       ├── sw.js               # Service Worker
│       └── signal-protocol.js  # Signal Protocol (IIFE bundle)
│
└── messenger-backend/          # Express + WebSocket API server
    ├── src/
    │   ├── app.ts              # Server entry point
    │   ├── websocket/
    │   │   ├── ws.server.ts    # WS server, auth handshake, presence, ping/pong
    │   │   └── ws.handler.ts   # Event dispatcher
    │   ├── modules/            # Feature modules (auth, users, chats, messages…)
    │   ├── config/             # Database, Redis, S3 clients
    │   └── utils/              # JWT, push notifications, email, crypto
    └── prisma/schema.prisma    # Database schema
```

**Communication flow:**
```
Browser ←──── WebSocket (/ws) ────→ ws.server.ts   (real-time events)
Browser ←──── REST API (/api) ────→ Express router  (CRUD operations)
Browser ←──── /uploads      ────→ S3 / local disk   (media files)
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **PostgreSQL** 15+
- **Redis** 7+
- A [Resend](https://resend.com) account for email OTP

### Backend Setup

```bash
cd messenger-backend

# Copy the example env and fill in your values
cp .env.example .env

# Install dependencies
npm install

# Generate Prisma client & run migrations
npx prisma generate
npx prisma migrate dev

# Start the development server (http://localhost:3000)
npm run dev
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start Vite dev server (http://localhost:5173)
npm run dev
```

The Vite dev server automatically proxies `/api`, `/uploads`, and `/ws` to the backend at `localhost:3000`.

---

## Environment Variables

Copy `messenger-backend/.env.example` and fill in all values. The most important ones:

| Variable | Required | Description |
|---|:---:|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | Secret for signing refresh tokens (min 32 chars) |
| `REDIS_HOST` | ✅ | Redis hostname (default: `localhost`) |
| `RESEND_API_KEY` | ✅ | [Resend](https://resend.com) API key for email OTP |
| `ENCRYPTION_KEY` | ✅ | 64-char hex key for AES-256-GCM (email encryption) |
| `HASH_SECRET` | ✅ | HMAC secret for deterministic email hashing |
| `CORS_ORIGIN` | ✅ | Allowed origins, comma-separated (e.g. `https://h2von.com`) |
| `BASE_URL` | ✅ | Public base URL of the backend (e.g. `https://h2von.com`) |
| `S3_ENDPOINT` | ⬜ | S3-compatible endpoint for media storage |
| `S3_ACCESS_KEY` | ⬜ | S3 access key |
| `S3_SECRET_KEY` | ⬜ | S3 secret key |
| `S3_BUCKET` | ⬜ | S3 bucket name |
| `VAPID_PUBLIC_KEY` | ⬜ | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | ⬜ | Web Push VAPID private key |
| `APNS_KEY_ID` | ⬜ | Apple APNs key ID (for iOS push) |
| `APNS_TEAM_ID` | ⬜ | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | ⬜ | iOS app bundle ID |
| `APNS_KEY_CONTENT` | ⬜ | Base64-encoded `.p8` APNs key |

Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

Generate a secure encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API

The REST API is documented in [`API.md`](API.md).

**Base URL:** `https://h2von.com/api`

| Resource | Endpoints |
|---|---|
| Auth | `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh`, `POST /auth/logout` |
| Users | `GET /users/me`, `PATCH /users/me`, `GET /users/:id`, `GET /users/search` |
| Chats | `GET /chats`, `POST /chats/direct`, `POST /chats/group`, `POST /chats/secret` |
| Messages | `GET /chats/:id/messages`, `PATCH /messages/:id`, `DELETE /messages/:id` |
| Upload | `POST /upload`, `POST /upload/avatar` |
| Keys | `POST /keys/bundle`, `GET /keys/bundle/:userId` (Signal Protocol) |

---

## Deployment

The project deploys automatically via **GitHub Actions** on every push to `master`:

- **Backend** → SSH deploy → `npm ci` → `prisma migrate deploy` → `pm2 restart`
- **Frontend** → SSH deploy → `npm ci` → `vite build` → served as static files

See `.github/workflows/` for the full CI/CD pipeline configuration.

**Required GitHub Secrets:**

| Secret | Description |
|---|---|
| `SERVER_HOST` | SSH server hostname or IP |
| `SERVER_USER` | SSH username (e.g. `root`) |
| `SSH_PRIVATE_KEY` | Private SSH key for server access |

---

## Scripts

### Backend (`messenger-backend/`)

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled production server |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Run pending database migrations |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |

### Frontend (`frontend/`)

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server on port 5173 |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build locally |

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org)
4. Push and open a Pull Request

---

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

In short: you are free to use, modify, and distribute this software, but any derivative work must also be released under the GPL v3.
