<div align="center">

# H2V Messenger — Web Client

**A privacy-focused real-time messenger with end-to-end encryption**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C?logo=solid&logoColor=white)](https://www.solidjs.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Live Demo](https://h2von.com) · [Report Bug](https://github.com/VeryFloy/H2V-web/issues/new?template=bug_report.yml) · [Request Feature](https://github.com/VeryFloy/H2V-web/issues/new?template=feature_request.yml)

</div>

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [API Documentation](../API.md)
- [Contributing](#contributing)
- [License](#license)

---

## About

H2V Web is the browser client for the H2V Messenger platform. Built with **SolidJS** for fine-grained reactivity and performance. Installable as a **Progressive Web App** on desktop, Android, or iOS.

**Secret Chats** use the [Signal Protocol](https://signal.org/docs/) for end-to-end encryption: messages are encrypted on-device before being sent.

This client connects to an API over REST and WebSocket. Use the [live demo](https://h2von.com) or point the dev proxy to your own API server.

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
| Progressive Web App — installable on any device | ✅ |
| Multi-language support (RU / EN) | ✅ |
| User search, blocking, contact management | ✅ |
| Profile — avatar, bio, display name | ✅ |
| Chat pinning & muting | ✅ |
| Message pinning | ✅ |
| Message search | ✅ |

---

## Tech Stack

| Technology | Purpose |
|---|---|
| [SolidJS](https://www.solidjs.com) | Reactive UI — fine-grained reactivity, no virtual DOM |
| [TypeScript](https://www.typescriptlang.org) | Type safety across the codebase |
| [Vite](https://vitejs.dev) | Dev server, HMR, production bundler |
| CSS Modules | Scoped component styles |
| [Signal Protocol](https://signal.org/docs/) | E2E encryption (client-side bundle) |
| Service Worker | PWA offline support, push notifications |
| Native WebSocket | Real-time connection |
| Native Fetch | REST API client with token refresh |

---

## Project Structure

```
src/
├── api/
│   └── client.ts       # REST client — fetch wrapper, token refresh
├── components/
│   ├── auth/           # OTP login flow
│   ├── chat/           # MessageArea, ChatList, group management
│   └── ui/             # Sidebar, ProfilePanel, SettingsPanel, ContactsPanel
├── crypto/
│   └── e2e.ts          # Signal Protocol wrapper (encrypt / decrypt)
├── stores/              # SolidJS reactive state
│   ├── ws.store.ts     # WebSocket lifecycle, reconnection
│   ├── chat.store.ts   # Chats & messages
│   ├── auth.store.ts   # Authentication state
│   ├── e2e.store.ts    # E2E encryption state
│   └── ...
├── types/
│   └── index.ts        # TypeScript interfaces & WsEvent union
└── utils/
    ├── format.ts       # displayName, formatLastSeen
    ├── avatar.ts       # Deterministic avatar colors
    └── waveform.ts     # Audio waveform extraction

public/
├── sw.js               # Service Worker (push, offline)
├── signal-protocol.js  # Signal Protocol IIFE bundle
└── manifest.json       # PWA manifest
```

---

## Getting Started

**Requirements:** Node.js 20+

```bash
git clone https://github.com/VeryFloy/H2V-web.git
cd H2V-web
npm install
npm run dev
```

The dev server starts at **http://localhost:5173**. It proxies `/api`, `/uploads`, and `/ws` to `http://localhost:3000` — configure the proxy target in `vite.config.ts` if your API runs elsewhere.

To try the app without running an API, use the [live demo](https://h2von.com).

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server on port 5173 |
| `npm run build` | TypeScript check + production build → `dist/` |
| `npm run preview` | Serve the production build locally |

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org)
4. Push and open a Pull Request

---

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.
