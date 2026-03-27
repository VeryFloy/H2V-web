# H2V Messenger — API Reference

> **Version:** 2.2.0 · **Updated:** 2026-03-27  
> This document describes the public HTTP and WebSocket API consumed by the H2V web client.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Response Format](#3-response-format)
4. [Health](#4-health)
5. [Auth Endpoints](#5-auth-endpoints)
6. [User Endpoints](#6-user-endpoints)
7. [Settings Endpoints](#7-settings-endpoints)
8. [Chat Endpoints](#8-chat-endpoints)
9. [Message Endpoints](#9-message-endpoints)
10. [File Upload](#10-file-upload)
11. [Keys (Signal Protocol)](#11-keys-signal-protocol)
12. [Link Preview](#12-link-preview)
13. [Reports](#13-reports)
14. [Push Notifications](#14-push-notifications)
15. [WebSocket](#15-websocket)
16. [Error Reference](#16-error-reference)

---

## 1. Overview

| | Value |
|---|---|
| **Base URL** | `https://<your-domain>` |
| **WebSocket URL** | `wss://<your-domain>/ws` |
| **Content-Type** | `application/json` (except file upload) |
| **Auth scheme** | Session-based (`h2v_session` httpOnly cookie or `Authorization: Bearer <token>`) |
| **Static files** | `GET /uploads/<filename>` |
| **Health check** | `GET /health` (basic) · `GET /api/health` (detailed) |
| **Public profile** | `GET /u/:nickname` (HTML) · `GET /api/users/public/:nickname` (JSON) |

### CSRF Protection

All mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/*` must include:

```
X-Requested-With: H2V
```

Safe methods (`GET`, `HEAD`, `OPTIONS`) are exempt.

---

## 2. Authentication

H2V uses **email OTP** authentication — no passwords required.

### Flow

1. **Request OTP** — `POST /api/auth/send-otp` with `{ email }`. A 6-digit code is sent.
2. **Verify OTP** — `POST /api/auth/verify-otp` with `{ email, code }`.
   - **Existing user** → Session cookie is set, user object returned.
   - **New user** → Server returns `NICKNAME_REQUIRED` with a `verifyToken`.
3. **Complete registration** — Call `verify-otp` again with `{ email, code, nickname, verifyToken }`.

An alternative **password login** is available for users who have set a password:
```
POST /api/auth/login  →  { nickname, password }
```

### Session Info

| Property | Value |
|---|---|
| Lifetime | 90 days (sliding — extended on activity) |
| Cookie name | `h2v_session` |
| Cookie flags | `httpOnly`, `secure` (prod), `sameSite: lax` |
| Bearer header | `Authorization: Bearer <sessionToken>` |

---

## 3. Response Format

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "code": "ERROR_CODE", "message": "Human-readable message" }
```

---

## 4. Health

### `GET /health`

```json
{ "status": "ok", "timestamp": "..." }
```

### `GET /api/health`

```json
{ "status": "ok", "timestamp": "...", "db": "ok", "redis": "ok" }
```

---

## 5. Auth Endpoints

> Base: `/api/auth` · No auth required (except session management).

### `POST /api/auth/send-otp`

**Body:** `{ "email": "user@example.com" }`

**Response `200`:** `{ "success": true, "data": { "status": "pending" } }`

| Error code | Status | Reason |
|---|---|---|
| `OTP_TOO_SOON` | 429 | Resend too early |
| `EMAIL_SEND_FAILED` | 502 | Delivery failure |
| `EMAIL_INVALID` | 422 | Invalid email |
| `DISPOSABLE_EMAIL` | 422 | Temporary email blocked |

---

### `POST /api/auth/verify-otp`

**Body:**

| Field | Required | Description |
|---|---|---|
| `email` | yes | Same email used in `send-otp` |
| `code` | yes | 6-digit OTP |
| `nickname` | new users | 5–32 chars, starts with letter, `[a-zA-Z0-9.]` |
| `verifyToken` | step 3 | Token from `NICKNAME_REQUIRED` response |

**Response `200` (existing user):**
```json
{
  "success": true,
  "data": {
    "isNewUser": false,
    "user": { "id": "...", "nickname": "john.doe", "avatar": null }
  }
}
```

**Response `201` (new user):**
```json
{
  "success": true,
  "data": {
    "isNewUser": true,
    "user": { "id": "...", "nickname": "john.doe", "avatar": null, "createdAt": "..." }
  }
}
```

Session token is set via httpOnly cookie. Non-browser clients read it from `Set-Cookie`.

| Error code | Status |
|---|---|
| `OTP_EXPIRED` | 400 |
| `INVALID_CODE` | 400 |
| `OTP_MAX_ATTEMPTS` | 429 |
| `NICKNAME_REQUIRED` | 422 |
| `NICKNAME_TAKEN` | 409 |

> On `NICKNAME_REQUIRED`, save the returned `verifyToken` and re-submit with `nickname` + `verifyToken`.

---

### `POST /api/auth/login`

**Body:** `{ "nickname": "...", "password": "..." }`

| Error code | Status |
|---|---|
| `INVALID_CREDENTIALS` | 401 |
| `LOGIN_LOCKED` | 429 |

---

### `POST /api/auth/logout`

Clears session cookie. No body required.

---

### `GET /api/auth/sessions`

> Requires auth.

List active sessions.

```json
{
  "data": [
    {
      "id": "...",
      "deviceName": "Chrome, Windows",
      "location": "Moscow, Russia",
      "lastActiveAt": "...",
      "createdAt": "...",
      "isCurrent": true
    }
  ]
}
```

### `DELETE /api/auth/sessions/:id`

Terminate a specific session (not the current one).

### `DELETE /api/auth/sessions`

Terminate all sessions except current.

---

## 6. User Endpoints

> Base: `/api/users` · Requires auth.

### `GET /api/users/me`

Full profile including `email` (decrypted server-side).

```json
{
  "data": {
    "id": "...", "numericId": 42, "nickname": "john.doe",
    "firstName": "John", "lastName": "Doe",
    "avatar": "/uploads/...", "bio": "...",
    "email": "user@example.com",
    "lastOnline": "...", "isOnline": true, "createdAt": "..."
  }
}
```

### `PATCH /api/users/me`

| Field | Type | Rules |
|---|---|---|
| `nickname` | string? | 5–32 chars, starts with letter, `[a-zA-Z0-9.]` |
| `firstName` | string \| null | max 64 |
| `lastName` | string \| null | max 64 |
| `avatar` | string \| null | path or null |
| `bio` | string \| null | max 70 |

Broadcasts `user:updated` WS event to shared-chat members.

### `DELETE /api/users/me`

Permanently deletes account. Closes all WebSocket connections.

### `GET /api/users/search?q=<query>`

Search by nickname. Returns up to 20 results.

### `GET /api/users/:id`

Public profile by ID.

### `GET /api/users/public/:nickname`

> No auth required.

Public profile by nickname (limited fields).

### `POST /api/users/me/device-token`

Register push token: `{ "token": "...", "platform": "IOS" | "ANDROID" | "WEB" }`

### `DELETE /api/users/me/device-token`

Remove push token: `{ "token": "..." }`

---

## 7. Settings Endpoints

> Base: `/api/users/me` · Requires auth.

### `GET /api/users/me/settings`

### `PUT /api/users/me/settings`

| Field | Type | Values |
|---|---|---|
| `notifSound` | boolean | |
| `notifDesktop` | boolean | |
| `sendByEnter` | boolean | |
| `fontSize` | string | `"small"` · `"medium"` · `"large"` |
| `showOnlineStatus` | string | `"all"` · `"contacts"` · `"nobody"` |
| `showReadReceipts` | string | `"all"` · `"contacts"` · `"nobody"` |
| `showAvatar` | string | `"all"` · `"contacts"` · `"nobody"` |
| `allowGroupInvites` | string | `"all"` · `"contacts"` · `"nobody"` |
| `mediaAutoDownload` | boolean | |
| `chatWallpaper` | string | `"default"` · `"dark"` · `"dots"` · `"gradient"` |
| `locale` | string | `"ru"` · `"en"` |
| `autoDeleteMonths` | string | `"1"` · `"3"` · `"6"` · `"12"` · `"never"` |
| `voiceSpeed` | number | `0` · `1` · `2` |

All fields optional on update. Returns full settings object.

---

## 8. Chat Endpoints

> Base: `/api/chats` · Requires auth.

### `GET /api/chats`

Chat list sorted by last activity.

| Param | Default | Description |
|---|---|---|
| `cursor` | — | Pagination cursor |
| `limit` | 30 | 1–100 |
| `archived` | `false` | `true` for archived chats |

Response includes `chats[]` with members, last message, unread count, draft, and `nextCursor`.

### `GET /api/chats/:id`

Single chat (membership verified).

### `POST /api/chats/saved`

Get or create Saved Messages (`type: "SELF"`).

### `POST /api/chats/direct`

Create/find direct chat: `{ "targetUserId": "..." }`

Chat is not visible to the target until the first message.

### `POST /api/chats/group`

Create group: `{ "name": "...", "memberIds": ["..."] }` — max 200 members.

### `POST /api/chats/secret`

Create E2E encrypted chat: `{ "targetUserId": "..." }`

### `PATCH /api/chats/:id`

Update group (name, avatar, description). Requires OWNER or ADMIN.

### `DELETE /api/chats/:id`

Delete group. Requires OWNER.

### `POST /api/chats/:id/invite`

Create invite link: `{ "expiresInHours": 24, "maxUses": 50 }` (all optional). Requires OWNER or ADMIN.

### `GET /api/chats/:id/invite`

List active invite links.

### `DELETE /api/chats/invite/:linkId`

Revoke invite link.

### `GET /api/chats/join/:code`

Preview invite link info (group name, avatar, member count).

### `POST /api/chats/join/:code`

Join group via invite code.

### `POST /api/chats/:id/members`

Add members. Requires OWNER or ADMIN.

### `DELETE /api/chats/:id/members/:userId`

Remove member. OWNER can remove anyone, ADMIN removes MEMBERs.

### `PATCH /api/chats/:id/members/:userId/role`

Change role: `{ "role": "ADMIN" | "MEMBER" }`. OWNER only.

### `PATCH /api/chats/:id/mute`

Mute/unmute: `{ "muted": true }`

### `PATCH /api/chats/:id/pin-chat`

Pin/unpin chat (max 5): `{ "pinned": true }`

### `PATCH /api/chats/:id/pin`

Pin/unpin message: `{ "messageId": "..." | null }`

### `PATCH /api/chats/:id/archive`

Archive/unarchive: `{ "archived": true }`

### `PUT /api/chats/:id/draft`

Save draft: `{ "text": "...", "replyToId": null }`

### `DELETE /api/chats/:id/draft`

Delete draft.

### `GET /api/chats/:id/shared`

Shared media with tab filter: `?tab=media|files|links|voice&cursor=...&limit=50`

### `DELETE /api/chats/:id/leave`

Leave chat. Direct/secret: deleted for both. Group: ownership transferred if owner leaves.

### `GET /api/chats/:id/export`

Export chat as `?format=json|html`.

### `GET /api/chats/export/all`

Export all chats. Strict rate limit.

---

## 8.5. Contacts

> Base: `/api/contacts` · Requires auth.

| Method | Path | Description |
|---|---|---|
| GET | `/api/contacts` | List contacts (includes `isMutual`) |
| POST | `/api/contacts/:userId` | Add contact |
| DELETE | `/api/contacts/:userId` | Remove contact |
| GET | `/api/contacts/check/:userId` | Check contact status |

---

## 8.6. Block

> Requires auth.

| Method | Path | Description |
|---|---|---|
| POST | `/api/users/:id/block` | Block user (not notified) |
| DELETE | `/api/users/:id/block` | Unblock user |
| GET | `/api/users/me/blocked` | Blocked IDs (`?full=1` for objects) |

---

## 9. Message Endpoints

> Requires auth.

### `GET /api/chats/:chatId/messages`

| Param | Default | Description |
|---|---|---|
| `cursor` | — | Oldest message ID |
| `limit` | 50 | 1–100 |
| `q` | — | Full-text search (1–200 chars) |
| `from` | — | ISO date filter |
| `to` | — | ISO date filter |
| `senderId` | — | Filter by sender |
| `type` | — | `TEXT`, `IMAGE`, `VIDEO`, `AUDIO`, `FILE` |

Messages ordered newest first. Types: `TEXT` · `IMAGE` · `VIDEO` · `AUDIO` · `FILE` · `SYSTEM`.

### `GET /api/chats/:chatId/messages/around`

Jump to date: `?date=<ISO>&limit=50`

### `GET /api/messages/search?q=<query>`

Global search across all chats. Cursor pagination.

### `DELETE /api/messages/:id`

Delete message. `?forEveryone=true` removes for all, otherwise hides for self only.

### `POST /api/messages/:id/hide`

Hide message for yourself only.

### `PATCH /api/messages/:id`

Edit own message: `{ "text": "..." }`. Secret chats: `{ "ciphertext": "...", "signalType": 3 }`.

### `POST /api/messages/:id/read`

Mark as read (creates receipts for all unread messages up to this one).

### `POST /api/messages/:id/reactions`

Add reaction: `{ "emoji": "👍" }`. Allowed: `👍` `❤️` `😂` `😮` `😢` `🔥`

### `DELETE /api/messages/:id/reactions/:emoji`

Remove reaction. Emoji must be URL-encoded.

---

## 10. File Upload

> Requires auth. `multipart/form-data`.

### `POST /api/upload`

| Category | Max size |
|---|---|
| Images (`jpeg`, `png`, `gif`, `webp`) | **20 MB** |
| Video (`mp4`, `webm`, `quicktime`) | **1 GB** |
| Audio (`mpeg`, `ogg`, `webm`, `mp4`, `aac`, `x-m4a`) | **1 GB** |
| Documents (`pdf`, `txt`, `zip`, `rar`, `7z`, `doc`, `docx`) | **100 MB** |

Images are auto-optimized: resized to max 1920×1920 and converted to WebP. Three versions: original, medium (800px), thumbnail (200px).

Videos: thumbnail + poster extracted, 720p compressed version generated.

**Response `201`:**
```json
{
  "data": {
    "url": "/uploads/...",
    "type": "IMAGE",
    "name": "photo.jpg",
    "size": 204800,
    "thumbUrl": "/uploads/thumbs/...",
    "mediumUrl": "/uploads/medium/..."
  }
}
```

`thumbUrl` and `mediumUrl` are present for images only.

### `POST /api/upload/avatar`

Avatar image. Max 10 MB, resized to 400×400 WebP.

### `POST /api/upload/encrypted`

E2E encrypted media blob for secret chats. Max **100 MB**. Stored as `.enc`.

---

## 11. Keys (Signal Protocol)

> Base: `/api/keys` · Requires auth.

| Method | Path | Description |
|---|---|---|
| POST | `/api/keys/bundle` | Upload PreKey Bundle |
| GET | `/api/keys/bundle/:userId` | Fetch bundle (consumes 1 OTP key) |
| GET | `/api/keys/has-bundle/:userId` | Check bundle exists |
| POST | `/api/keys/replenish` | Add OTP prekeys |
| GET | `/api/keys/count` | Remaining OTP key count |

Replenish when count drops below 20.

---

## 12. Link Preview

> Base: `/api/link-preview` · Requires auth.

### `GET /api/link-preview?url=<url>`

Fetch OG metadata. Cached server-side. Supports YouTube/Vimeo oEmbed.

```json
{
  "data": {
    "url": "...", "title": "...", "description": "...",
    "image": "...", "siteName": "..."
  }
}
```

### `GET /api/link-preview/proxy?url=<url>`

Proxy external images (avoids CORS). Streams with correct `Content-Type`. Max 5 MB.

---

## 13. Reports

### `POST /api/reports`

| Field | Required | Description |
|---|---|---|
| `targetUserId` | no | User being reported |
| `targetMessageId` | no | Message being reported |
| `targetChatId` | no | Chat being reported |
| `reason` | yes | `SPAM` · `ABUSE` · `VIOLENCE` · `NSFW` · `OTHER` |
| `details` | no | Additional info |

At least one target field required.

---

## 14. Push Notifications

### `GET /api/push/vapid-key`

> No auth required.

Returns VAPID public key for Web Push subscriptions.

---

## 15. WebSocket

### Connection

```
wss://<your-domain>/ws
```

Auth via cookie (automatic) or token event after connecting:

```json
{ "event": "auth", "payload": { "token": "<sessionToken>" } }
```

Server sends `auth:ok` on success or closes with code `4001`.

### Limits

- Max payload: **64 KB**
- Rate limiting applied per socket

### Close Codes

| Code | Meaning |
|---|---|
| `4001` | Auth failed / account deleted |
| `4003` | Session terminated |

### Keep-alive

Send `presence:ping` every **25 seconds**.

---

### Client → Server

| Event | Payload |
|---|---|
| `auth` | `{ token }` |
| `message:send` | `{ chatId, text?, type?, mediaUrl?, mediaName?, mediaSize?, replyToId?, ciphertext?, signalType?, forwardedFromId?, forwardSenderName?, mediaGroupId? }` |
| `message:read` | `{ messageId, chatId }` |
| `message:listened` | `{ messageId, chatId }` |
| `typing:start` | `{ chatId }` |
| `typing:stop` | `{ chatId }` |
| `presence:ping` | _(none)_ |
| `presence:away` | _(none)_ |
| `presence:back` | _(none)_ |

`message:send` type values: `TEXT` (default) · `IMAGE` · `VIDEO` · `AUDIO` · `FILE`

For secret chats, include `ciphertext` + `signalType` (`3` = PreKey, `1` = Whisper) instead of `text`.

---

### Server → Client

| Event | Delivered to | Key fields |
|---|---|---|
| `auth:ok` | Connecting client | `userId`, `onlineUserIds` |
| `message:new` | All chat members | Full message object |
| `message:delivered` | Sender only | `messageId`, `chatId` |
| `message:read` | All chat members | `messageId`, `chatId`, `readBy`, `readAt` |
| `message:edited` | All chat members | Full message object |
| `message:deleted` | All / sender only | `messageId`, `chatId`, `newLastMessage` |
| `message:listened` | All chat members | `messageId`, `chatId`, `listenedBy` |
| `chat:new` | Recipient(s) | Full chat object |
| `chat:deleted` | Affected members | `chatId` |
| `chat:updated` | All members | Full or partial chat object |
| `chat:member-left` | Remaining members | `chatId`, `userId` |
| `draft:updated` | User's other devices | `chatId`, `text`, `replyToId` |
| `reaction:added` | All chat members | `reaction`, `chatId` |
| `reaction:removed` | All chat members | `messageId`, `userId`, `emoji`, `chatId` |
| `typing:started` | All except typer | `chatId`, `userId` |
| `typing:stopped` | All except typer | `chatId`, `userId` |
| `user:online` | Relevant users | `userId`, `lastOnline` |
| `user:offline` | Relevant users | `userId`, `lastOnline` |
| `user:updated` | Shared-chat users | User profile fields |
| `presence:snapshot` | Connecting client | `onlineUserIds` |
| `error` | Requesting client | `message` |

> Privacy settings (`showOnlineStatus`, `showReadReceipts`) are enforced server-side. If a user sets `showOnlineStatus: "nobody"`, their online events are not broadcast.

---

## 16. Error Reference

| Code | Status | Description |
|---|---|---|
| `OTP_TOO_SOON` | 429 | Resend requested too early |
| `EMAIL_SEND_FAILED` | 502 | SMTP failure |
| `OTP_EXPIRED` | 400 | Code expired or not found |
| `INVALID_CODE` | 400 | Wrong code |
| `OTP_MAX_ATTEMPTS` | 429 | Too many wrong attempts |
| `DISPOSABLE_EMAIL` | 422 | Temporary email blocked |
| `EMAIL_INVALID` | 422 | Invalid email |
| `NICKNAME_REQUIRED` | 422 | New user — provide nickname |
| `NICKNAME_TAKEN` | 409 | Nickname exists |
| `NICKNAME_TOO_SHORT` | 422 | < 5 characters |
| `NICKNAME_INVALID_CHARS` | 422 | Invalid characters |
| `INVALID_CREDENTIALS` | 401 | Wrong nickname/password |
| `LOGIN_LOCKED` | 429 | Too many failed attempts |
| `SESSION_NOT_FOUND` | 404 | Session does not exist |
| `BLOCKED` | 403 | Blocked by user |
| `PIN_LIMIT` | 400 | Max 5 pinned chats |
| `GROUP_LIMIT_EXCEEDED` | 400 | Max 200 group members |
| `PRIVACY_GROUP_INVITE` | 403 | Privacy settings prevent invite |
| `CSRF_REJECTED` | 403 | Missing CSRF header |
| `RATE_LIMIT` | 429 | Too many requests |
| `VALIDATION_ERROR` | 422 | Invalid request body |
| `INTERNAL_ERROR` | 500 | Server error |
