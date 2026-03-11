# Contributing to H2V Web

Thanks for your interest! Here's how to get started.

## Setup

**Requirements:** Node.js 20+, a running [H2V-servers](https://github.com/VeryFloy/H2V-servers) backend.

```bash
git clone https://github.com/VeryFloy/H2V-web.git
cd H2V-web
npm install
npm run dev
```

The Vite dev server proxies `/api`, `/uploads`, and `/ws` to `localhost:3000`.

## Code Style

- **TypeScript** everywhere — no implicit `any`
- **No axios**, no Socket.IO — native `fetch` and native `WebSocket` only
- **SolidJS stores** for state — no Redux, no Zustand
- CSS Modules for styles — no global class names

Before opening a PR:

```bash
npm run build   # must pass with zero errors
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add contact list panel
fix: reset typing indicator on chat switch
chore: update vite to 7.x
refactor: simplify ws reconnect backoff
```

## Submitting a Pull Request

1. Fork and create a branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Verify `npm run build` passes
4. Push and open a PR — fill in the PR template

## Reporting Issues

- [Bug Report](https://github.com/VeryFloy/H2V-web/issues/new?template=bug_report.yml)
- [Feature Request](https://github.com/VeryFloy/H2V-web/issues/new?template=feature_request.yml)
