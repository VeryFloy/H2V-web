<div align="center">

<img src="https://h2von.com/img/icon-white-512.png" alt="H2V" width="80" />

# H2V Messenger

**Fast, private, open-source messaging.**

[![Try H2V](https://img.shields.io/badge/Try_H2V-h2von.com-7C3AED?style=for-the-badge)](https://web.h2von.com)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C?logo=solid&logoColor=white)](https://www.solidjs.com)

</div>

---

## Features

- **End-to-end encryption** — Signal Protocol for secret chats. Keys never leave your device.
- **Direct, group & secret chats** — up to 200 members, admin roles, invite links.
- **Rich media** — images, video, voice messages, files, link previews.
- **Real-time** — typing indicators, read receipts, online presence.
- **PWA** — installable on any platform, push notifications, works offline.
- **No bloat** — pure SolidJS, under 400 KB gzipped, no Electron.

---

## Quick Start

```bash
git clone https://github.com/VeryFloy/H2V-web.git
cd H2V-web
npm install
npm run dev
```

Open **http://localhost:5173**. Dev server proxies to the API — edit `vite.config.ts` to point at your own backend.

| Command | Description |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |

---

## Tech Stack

| | |
|---|---|
| **UI** | [SolidJS](https://www.solidjs.com) — fine-grained reactivity, no virtual DOM |
| **Language** | TypeScript (strict) |
| **Build** | [Vite](https://vitejs.dev) |
| **Styles** | CSS Modules |
| **E2E** | [Signal Protocol](https://signal.org/docs/) |
| **Realtime** | WebSocket |

---

## Project Structure

```
src/
├── api/          # HTTP client
├── components/   # Auth, chat, UI components
├── crypto/       # Signal Protocol integration
├── stores/       # Reactive state management
├── types/        # TypeScript interfaces
└── utils/        # Helpers

public/
├── sw.js         # Service Worker
└── manifest.json # PWA manifest
```

---

## Contributing

1. Fork → branch (`feat/...`) → PR
2. [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `refactor:`
3. CSS Modules only, state in stores, text via i18n

---

## License

[GPL v3](LICENSE) — free to use, modify, and distribute. Modified versions must remain open source.

---

<div align="center">

**[web.h2von.com](https://web.h2von.com)** · [API Reference](API.md) · [Report Bug](https://github.com/VeryFloy/H2V-web/issues)

</div>
