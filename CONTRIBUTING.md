# Contributing to H2V Web

Thank you for your interest in contributing! This document explains how to get set up and how to submit changes.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)

---

## Development Setup

**Requirements:** Node.js 20+, a running [H2V-servers](https://github.com/VeryFloy/H2V-servers) backend.

```bash
git clone https://github.com/VeryFloy/H2V-web.git
cd H2V-web
npm install
npm run dev
```

Open `http://localhost:5173` — the Vite dev server proxies `/api`, `/uploads`, and `/ws` to the backend at `localhost:3000`.

---

## Project Structure

```
src/
├── api/            # REST client — fetch wrapper with token refresh
├── stores/         # Reactive state (SolidJS stores)
├── components/     # UI components (chat, auth, ui panels)
├── crypto/         # Signal Protocol wrapper for E2E encryption
└── types/          # Shared TypeScript interfaces & WsEvent union
```

---

## Code Style

- **TypeScript** everywhere — no `any` unless absolutely unavoidable
- **No axios**, no Socket.IO — native `fetch` and native `WebSocket` only
- **SolidJS stores** for state — no Redux, no Zustand
- CSS Modules for styles — no global class names
- No `console.log` in production paths

Before opening a PR, verify:

```bash
npm run build   # must pass with zero TypeScript errors
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add message forwarding to group chats
fix: prevent duplicate typing:stop events on chat switch
chore: update vite to 7.x
refactor: simplify ws reconnect backoff
docs: update README
```

---

## Submitting a Pull Request

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Make your changes** — keep commits atomic and focused
3. **Verify** `npm run build` passes with zero errors
4. **Push** and open a PR — fill in the PR template

PRs are reviewed within a few days. Small, focused PRs are merged faster than large ones.

---

## Reporting Issues

Use the GitHub issue templates:
- [Bug Report](https://github.com/VeryFloy/H2V-web/issues/new?template=bug_report.yml)
- [Feature Request](https://github.com/VeryFloy/H2V-web/issues/new?template=feature_request.yml)

Please search for existing issues before opening a new one.
