<div align="center">

<img src="https://h2von.com/img/icon-white-512.png" alt="H2V" width="80" />

# H2V Messenger

### Fast. Private. Open Source.

The web client for a next-generation messenger built on transparency, speed, and encryption by default.

[![Try H2V](https://img.shields.io/badge/Try_H2V-h2von.com-7C3AED?style=for-the-badge)](https://web.h2von.com)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-2C4F7C?logo=solid&logoColor=white)](https://www.solidjs.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Live App](https://web.h2von.com) · [Report Bug](https://github.com/VeryFloy/H2V-web/issues/new?template=bug_report.yml) · [Request Feature](https://github.com/VeryFloy/H2V-web/issues/new?template=feature_request.yml) · [API Reference](API.md)

</div>

---

## Why H2V?

Most messengers ask you to choose: **privacy or convenience**. H2V doesn't.

We're building a messenger where **end-to-end encryption, rich media, and a polished UI** coexist without compromise. The web client is fully open source — you can audit every line of code that handles your messages, keys, and data.

- **Signal Protocol** — Secret chats are encrypted on-device. Keys never leave your browser.
- **No Electron, no bloat** — Pure web tech. Runs in any browser, installs as a PWA, weighs under 400 KB gzipped.
- **Built with SolidJS** — Fine-grained reactivity without a virtual DOM. Sub-millisecond UI updates.

> H2V is currently in active development. The web client is stable and used daily at [web.h2von.com](https://web.h2von.com).

---

## What's Inside

### Messaging

End-to-end encrypted **secret chats**, regular **direct** and **group chats** (up to 200 members), **Saved Messages** for your personal notes. Reply, forward, edit, delete, pin — everything you'd expect, and then some.

**Quick reply** — double-click a message on desktop or swipe left on mobile to instantly reply. **Failed message retry** — if a message fails to send (network drop), it's marked with a red indicator. Tap to retry instantly.

### Rich Media

Voice messages with **live waveform**, images/video/files with **drag-and-drop** and **clipboard paste**, **media grids** for photo albums (up to 10 per group), and **link previews** with YouTube/Vimeo embeds. **Client-side file size validation** (20 MB limit) prevents wasted uploads.

### Text Formatting

Live-preview **markdown formatting** in the input: **bold**, *italic*, ~~strikethrough~~, `code`, ||spoiler||, and blockquotes. Formatting toolbar appears on text selection. Keyboard shortcuts (Ctrl+B/I/E, Ctrl+Shift+X/P).

### Group Management

**Admin roles** — group owners can promote and demote admins. **Mute** groups with server-synced state. **Shared media gallery** with tabs (media, files, links, voice) and pagination. **Group descriptions** — add context to your groups. **Invite links** — generate shareable links to invite people to your groups.

### Chat Organization

**Pin** your important chats (up to 5), **archive** the rest (Telegram-style), **mute** noisy groups (synced across devices), **export** full chat history as JSON or HTML. Cross-device **drafts** so you never lose what you were typing.

### Search

Full-text **message search** with **date filters** and **cursor pagination** — results replace the chat list with a "load more" button. Click to jump straight to the message with a visual highlight.

### Platform

Installable as a **Progressive Web App** on desktop, Android, and iOS. **Push notifications** via Service Worker. **Multi-language** UI (Russian / English, more coming). **Auto-reconnect** with full chat and message resync.

---

## Tech

| | |
|---|---|
| **Framework** | [SolidJS](https://www.solidjs.com) — reactive UI with zero virtual DOM overhead |
| **Language** | [TypeScript](https://www.typescriptlang.org) — strict mode, full type coverage |
| **Bundler** | [Vite](https://vitejs.dev) — instant HMR, optimized production builds |
| **Styles** | CSS Modules — scoped, zero runtime |
| **Encryption** | [Signal Protocol](https://signal.org/docs/) — industry-standard E2E |
| **Realtime** | Native WebSocket with auto-reconnect |
| **PWA** | Service Worker, Web Push, installable |

---

## Quick Start

```bash
git clone https://github.com/VeryFloy/H2V-web.git
cd H2V-web
npm install
npm run dev
```

Open **http://localhost:5173**. The dev server proxies API requests to the configured upstream — edit `vite.config.ts` to point it at your own API, or just use [web.h2von.com](https://web.h2von.com) to try the live version.

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Type-check + production build → `dist/` |
| `npm run preview` | Preview the production build locally |

---

## Roadmap

H2V is evolving fast. Here's where we're headed:

### Now — Q1 2026

- [x] E2E encrypted secret chats (Signal Protocol)
- [x] E2E encrypted media in secret chats (AES-256-GCM)
- [x] Safety number verification for E2E chats
- [x] Media albums with grid layout
- [x] Link previews (YouTube, Vimeo, OG tags)
- [x] Chat pinning, archiving, muting (server-synced)
- [x] Cross-device drafts
- [x] Full message search with date filters and pagination
- [x] Saved Messages
- [x] Admin role management in groups
- [x] Group descriptions and invite links
- [x] Text formatting with live preview (bold, italic, code, spoiler, blockquote)
- [x] Quick reply — double-click (desktop) or swipe left (mobile)
- [x] Message send retry on failure
- [x] Client-side file validation
- [x] XSS sanitization

### Next — Q2 2026

- [ ] **Voice & video calls** — WebRTC peer-to-peer with STUN/TURN
- [ ] **Chat folders** — organize conversations with custom filters
- [ ] **Scheduled messages** — write now, send later
- [ ] **Polls** — anonymous & multiple-choice voting in groups

### Later — Q3–Q4 2026

- [ ] **Group calls** — SFU-based multi-party audio/video
- [ ] **Sticker packs** — custom stickers, community marketplace
- [ ] **Offline mode** — read & compose messages without internet (IndexedDB)
- [ ] **Media editor** — crop, draw, annotate before sending
- [ ] **App lock** — PIN / biometric protection via WebAuthn

### Future

- [ ] Desktop & mobile native apps (Tauri / Capacitor)
- [ ] Bots API
- [ ] Channels (broadcast messaging)
- [ ] Threads in group chats

> Have an idea? [Open a feature request](https://github.com/VeryFloy/H2V-web/issues/new?template=feature_request.yml) — we read every one.

---

## Contributing

H2V is open source and we welcome contributions of all sizes — from typo fixes to major features.

1. **Fork** the repository
2. Create a branch: `git checkout -b feat/your-idea`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `refactor:`
4. Open a **Pull Request** with a clear description

Before your first contribution, please read [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Project Structure

```
src/
├── api/            # REST client with token refresh
├── components/
│   ├── auth/       # OTP login flow
│   ├── chat/       # Messages, chat list, groups, media
│   └── ui/         # Sidebar, panels, modals
├── crypto/         # Signal Protocol encrypt/decrypt
├── stores/         # Reactive state (auth, chats, WS, UI, i18n)
├── types/          # TypeScript interfaces
└── utils/          # Formatting, avatars, waveform extraction

public/
├── sw.js           # Service Worker (push, offline)
├── signal-protocol.js
└── manifest.json   # PWA manifest
```

---

## License

**GNU General Public License v3.0** — see [LICENSE](LICENSE).

You are free to use, modify, and distribute this software under the terms of the GPL v3. If you distribute modified versions, you must also make your source code available under the same license.

---

<div align="center">

**[web.h2von.com](https://web.h2von.com)**

Made with care by the H2V team.

</div>
