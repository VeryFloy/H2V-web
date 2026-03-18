# Contributing to H2V API Server

Thank you for your interest! This document covers how to set up the backend and submit changes.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)

---

## Development Setup

**Requirements:** Node.js 20+, PostgreSQL 15+, Redis 7+, [Resend](https://resend.com) account

```bash
# 1. Clone the repo
git clone https://github.com/VeryFloy/H2V-servers.git
cd H2V-servers

# 2. Copy env and configure
cp .env.example .env
# Edit .env — fill in:
#   DATABASE_URL (PostgreSQL)
#   JWT_SECRET, JWT_REFRESH_SECRET (min 32 chars each)
#   REDIS_HOST (default: localhost)
#   RESEND_API_KEY (from Resend dashboard)
#   ENCRYPTION_KEY, HASH_SECRET (use node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
#   CORS_ORIGIN (e.g. http://localhost:5173)
#   BASE_URL (e.g. https://h2von.com or http://localhost:3000)

# 3. Install dependencies
npm install

# 4. Generate Prisma client & run migrations
npx prisma generate
npx prisma migrate dev

# 5. Start dev server
npm run dev
```

The API runs at **http://localhost:3000**. To test with the web client, run [H2V-web](https://github.com/VeryFloy/H2V-web) — it proxies `/api`, `/uploads`, and `/ws` to this port.

---

## Project Structure

```
src/
├── app.ts              # Express + WebSocket mount
├── websocket/           # WS server, auth, presence, event handlers
├── modules/             # auth, users, chats, messages, keys, contacts, upload
├── config/             # DB, Redis, S3
├── middleware/         # Auth, error handling
└── utils/              # JWT, push, email, crypto

prisma/
├── schema.prisma       # Database schema
└── migrations/         # SQL migrations
```

---

## Code Style

- **TypeScript** everywhere — no `any` unless unavoidable
- **Zod** for all request/response validation
- **Native `ws`** for WebSocket — no Socket.IO
- Keep functions small and focused
- No `console.log` in production paths — use `console.warn` / `console.error`

Before opening a PR, verify:

```bash
npx tsc --noEmit   # must pass with zero errors
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add contact search endpoint
fix: correct APNs badge count for unread messages
chore: update Prisma to 7.4
refactor: simplify presence heartbeat logic
```

---

## Submitting a Pull Request

1. Create a branch: `git checkout -b feat/your-feature-name`
2. Make your changes — keep commits atomic
3. Run `npx tsc --noEmit` to verify types
4. Push and open a PR against `main`
5. Fill in the PR template with description and testing notes

---

## Reporting Issues

Please search for existing issues before opening a new one. For bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version, PostgreSQL/Redis versions
- Relevant logs (redact secrets)
