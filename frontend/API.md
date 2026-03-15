# H2V Messenger — API Documentation

> **Version:** 1.2.0 · **Updated:** 2026-03-14  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [Rate Limiting](#3-rate-limiting)
4. [Response Format](#4-response-format)
5. [Health Endpoints](#5-health-endpoints)
6. [Auth Endpoints](#6-auth-endpoints)
7. [User Endpoints](#7-user-endpoints)
8. [Settings Endpoints](#8-settings-endpoints)
9. [Chat Endpoints](#9-chat-endpoints)
10. [Message Endpoints](#10-message-endpoints)
11. [File Upload](#11-file-upload)
12. [Keys (Signal Protocol)](#12-keys-signal-protocol)
13. [WebSocket](#13-websocket)
14. [Error Reference](#14-error-reference)
15. [Database Schema](#15-database-schema)
16. [Quick Reference Table](#16-quick-reference-table)

---

## 1. Overview

| | Value |
|---|---|
| **Base URL** | `https://<your-domain>` |
| **WebSocket URL** | `wss://<your-domain>/ws` |
| **Content-Type** | `application/json` (except file upload) |
| **Auth scheme** | Bearer JWT |
| **Static files** | `GET /uploads/<filename>` |
| **Health check** | `GET /health` (basic) · `GET /api/health` (DB + Redis) |

---

## 2. Authentication Flow

H2V uses **email OTP** (one-time password) authentication — no passwords required.

### Step 1 — Request OTP
```
POST /api/auth/send-otp  →  { email }
```
A 6-digit code is sent to the user's email (valid for 10 minutes).

### Step 2a — Existing user login
```
POST /api/auth/verify-otp  →  { email, code }
```
Returns tokens and user object directly.

### Step 2b — New user registration
```
POST /api/auth/verify-otp  →  { email, code }
```
Server responds with error `NICKNAME_REQUIRED` (HTTP 422).  
Client shows username input form.

### Step 3 — Complete registration
```
POST /api/auth/verify-otp  →  { email, code, nickname }
```
Account is created, tokens returned.

### Token Management

| Token | Lifetime | Storage |
|---|---|---|
| `accessToken` | 15 minutes | Client memory / localStorage |
| `refreshToken` | 30 days | DB table `refresh_tokens` |

When `accessToken` expires → `POST /api/auth/refresh` (old refresh token is invalidated — **token rotation**).

---

## 3. Rate Limiting

| Route group | Limit | Window |
|---|---|---|
| `/api/auth/*` | 20 requests | 15 minutes |
| All other `/api/*` | 300 requests | 1 minute |

```json
HTTP 429
{
  "success": false,
  "code": "RATE_LIMIT",
  "message": "Too many requests, try again later"
}
```

---

## 4. Response Format

All responses follow a unified format:

```json
// Success
{ "success": true, "data": { ... } }

// Error — always includes code
{ "success": false, "code": "ERROR_CODE", "message": "Human-readable message" }

// Validation error — includes field details
{ "success": false, "code": "VALIDATION_ERROR", "message": "Validation error", "errors": { ... } }
```

---

## 5. Health Endpoints

No authorization required. Not rate-limited.

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-03-08T12:00:00.000Z" }
```

### `GET /api/health`

```json
{
  "status": "ok",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "db": "ok",
  "redis": "ok"
}
```

---

## 6. Auth Endpoints

> Base path: `/api/auth`  
> **No authorization required.** Rate limit: 20 req / 15 min.

---

### `POST /api/auth/send-otp`

Send a 6-digit OTP to the user's email. Repeated requests are rate-limited to once per 60 seconds.

**Request body:**
```json
{ "email": "user@example.com" }
```

**Response `200`:**
```json
{ "success": true, "data": { "status": "pending" } }
```

**Errors:**

| Status | code | Reason |
|---|---|---|
| 429 | `OTP_TOO_SOON` | Retry too early (< 60s since last send) |
| 502 | `EMAIL_SEND_FAILED` | SMTP delivery failure |
| 422 | `EMAIL_INVALID` | Not a valid email |
| 422 | `DISPOSABLE_EMAIL` | Temporary/disposable email domain |

---

### `POST /api/auth/verify-otp`

Verify OTP and log in (existing user) or register (new user).

**Request body:**
```json
{
  "email":    "user@example.com",
  "code":     "123456",
  "nickname": "john.doe"
}
```

| Field | Required | Description |
|---|---|---|
| `email` | **yes** | Same email used in `send-otp` |
| `code` | **yes** | 6-digit OTP from email |
| `nickname` | only for new users | Min 5 chars, starts with a letter, `[a-zA-Z0-9.]` only |

**Response `200` (existing user):**
```json
{
  "success": true,
  "data": {
    "isNewUser": false,
    "user": {
      "id":       "cuid...",
      "nickname": "john.doe",
      "avatar":   null
    },
    "tokens": {
      "accessToken":  "eyJ...",
      "refreshToken": "eyJ..."
    }
  }
}
```

**Response `201` (new user, after providing nickname):**
```json
{
  "success": true,
  "data": {
    "isNewUser": true,
    "user": {
      "id":        "cuid...",
      "nickname":  "john.doe",
      "avatar":    null,
      "createdAt": "2026-03-08T12:00:00.000Z"
    },
    "tokens": { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
  }
}
```

**Errors:**

| Status | code | Reason |
|---|---|---|
| 400 | `OTP_EXPIRED` | Code not found or expired |
| 400 | `INVALID_CODE` | Wrong code |
| 429 | `OTP_MAX_ATTEMPTS` | Too many wrong attempts (> 5) |
| 422 | `NICKNAME_REQUIRED` | New user — client must ask for nickname |
| 409 | `NICKNAME_TAKEN` | Nickname already registered |

> When you receive `NICKNAME_REQUIRED`, show the username form and call `verify-otp` again with the same `email` + `code` + chosen `nickname`. The server keeps the verified state for 10 minutes.

---

### `POST /api/auth/refresh`

Exchange a refresh token for a new pair. Old token is immediately invalidated.

**Request body:**
```json
{ "refreshToken": "eyJ..." }
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "accessToken": "eyJ...", "refreshToken": "eyJ..." }
}
```

---

### `POST /api/auth/logout`

Invalidate a refresh token (server-side).

**Request body:**
```json
{ "refreshToken": "eyJ..." }
```

**Response `200`:**
```json
{ "success": true, "data": { "message": "Logged out" } }
```

---

## 7. User Endpoints

> Base path: `/api/users`  
> **Requires `Authorization: Bearer <accessToken>`.**

---

### `GET /api/users/me`

Get the current user's full profile.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id":         "cuid...",
    "nickname":   "john.doe",
    "firstName":  "John",
    "lastName":   "Doe",
    "avatar":     "/uploads/1740000000000-abc.jpg",
    "bio":        "Software engineer",
    "email":      "user@example.com",
    "lastOnline": "2026-03-08T11:55:00.000Z",
    "isOnline":   true,
    "createdAt":  "2026-01-01T00:00:00.000Z"
  }
}
```

> `email` is only included in `GET /api/users/me` (not in other users' profiles).

---

### `PATCH /api/users/me`

Update the current user's profile. All fields optional.

**Request body:**
```json
{
  "nickname":  "new.nick",
  "firstName": "John",
  "lastName":  "Doe",
  "avatar":    "/uploads/xyz.jpg",
  "bio":       "About me (max 70 chars)"
}
```

| Field | Type | Rules |
|---|---|---|
| `nickname` | string? | 5–32 chars, starts with letter, `[a-zA-Z0-9.]` |
| `firstName` | string \| null | max 64 chars |
| `lastName` | string \| null | max 64 chars |
| `avatar` | string \| null | URL path or null to remove |
| `bio` | string \| null | max 70 chars |

**Response `200`:** same as `GET /api/users/me`.

**Errors:**

| Status | code |
|---|---|
| 409 | `NICKNAME_TAKEN` |
| 422 | Validation error |

> After update, a `user:updated` WebSocket event is broadcast to all connected users who share a chat with this user.

---

### `DELETE /api/users/me`

Permanently delete the current user's account. All associated data (messages, chats, tokens, keys) is cascade-deleted. All active WebSocket connections are closed with code `4001`.

**Response `200`:**
```json
{ "success": true, "data": { "message": "Account deleted" } }
```

---

### `GET /api/users/search?q=<query>`

Search users by **nickname** (case-insensitive, prefix match). Does not return the current user. Returns up to 20 results.

| Param | Required | Description |
|---|---|---|
| `q` | **yes** | Search query (min 1 char) |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id":         "cuid...",
      "nickname":   "alice",
      "firstName":  "Alice",
      "lastName":   null,
      "avatar":     null,
      "bio":        null,
      "isOnline":   false,
      "lastOnline": "2026-03-08T11:00:00.000Z"
    }
  ]
}
```

> If a user has `showOnlineStatus: false` in their settings, their `isOnline` will be `false` and `lastOnline` will be `null` ("seen recently").

---

### `GET /api/users/:id`

Get any user's public profile by ID.

**Response `200`:** same structure as search result (no `email`).

**Errors:**

| Status | message |
|---|---|
| 404 | `User not found` |

---

### `POST /api/users/me/device-token`

Register a push notification token (FCM / APNs / Web Push). Idempotent.

**Request body:**
```json
{ "token": "fcm-or-apns-token-string", "platform": "IOS" }
```

| Field | Values |
|---|---|
| `platform` | `IOS` · `ANDROID` · `WEB` |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "cuid...", "token": "...", "platform": "IOS", "createdAt": "..."
  }
}
```

---

### `DELETE /api/users/me/device-token`

Remove a push token on device logout.

**Request body:**
```json
{ "token": "fcm-or-apns-token-string" }
```

**Response `200`:**
```json
{ "success": true, "data": { "message": "Device token removed" } }
```

---

## 8. Settings Endpoints

> Base path: `/api/users/me`  
> **Requires Authorization.** Settings are stored server-side and synced across devices.

---

### `GET /api/users/me/settings`

Get the current user's app settings.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "notifSound":        true,
    "notifDesktop":      true,
    "sendByEnter":       true,
    "fontSize":          "medium",
    "showOnlineStatus":  true,
    "showReadReceipts":  true,
    "mediaAutoDownload": true,
    "chatWallpaper":     "default",
    "locale":            "ru"
  }
}
```

---

### `PUT /api/users/me/settings`

Update settings. All fields optional — only provided fields are changed (merged).

**Request body:**
```json
{
  "notifSound":        true,
  "notifDesktop":      false,
  "sendByEnter":       true,
  "fontSize":          "medium",
  "showOnlineStatus":  true,
  "showReadReceipts":  true,
  "mediaAutoDownload": true,
  "chatWallpaper":     "default",
  "locale":            "ru"
}
```

| Field | Type | Values / Rules |
|---|---|---|
| `notifSound` | boolean | Play sound on new messages |
| `notifDesktop` | boolean | Show push notifications |
| `sendByEnter` | boolean | Enter = send (vs Ctrl+Enter) |
| `fontSize` | string | `"small"` · `"medium"` · `"large"` |
| `showOnlineStatus` | boolean | Others can see when you're online |
| `showReadReceipts` | boolean | Send "read" checkmarks |
| `mediaAutoDownload` | boolean | Auto-download photos/videos |
| `chatWallpaper` | string | `"default"` · `"dark"` · `"dots"` · `"gradient"` |
| `locale` | string | `"ru"` · `"en"` |

**Response `200`:** full settings object (same as GET).

> When `showOnlineStatus` is updated, a real-time presence update is applied immediately via WebSocket.

---

## 9. Chat Endpoints

> Base path: `/api/chats`  
> **Requires Authorization.**

---

### `GET /api/chats`

Get the current user's chat list, sorted by last activity (newest first).

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `cursor` | — | ID of the last received chat (pagination) |
| `limit` | 30 | 1–100 |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "id":        "cuid...",
        "type":      "DIRECT",
        "name":      null,
        "avatar":    null,
        "updatedAt": "2026-03-08T12:00:00.000Z",
        "unread":    3,
        "members": [
          {
            "userId": "cuid...",
            "role":   "OWNER",
            "user": {
              "id":        "cuid...",
              "nickname":  "alice",
              "firstName": "Alice",
              "lastName":  null,
              "avatar":    null,
              "isOnline":  true,
              "lastOnline": null
            }
          }
        ],
        "messages": [
          {
            "id":        "cuid...",
            "text":      "Hey!",
            "type":      "TEXT",
            "createdAt": "2026-03-08T12:00:00.000Z",
            "sender": { "id": "cuid...", "nickname": "alice" }
          }
        ]
      }
    ],
    "nextCursor": null
  }
}
```

> `unread` — count of messages not yet read by the current user.  
> `messages[0]` — last message for sidebar preview.  
> `nextCursor` is `null` when no more pages.

---

### `GET /api/chats/:id`

Get a single chat by ID (membership verified).

**Response `200`:** full chat object.

**Errors:**

| Status | message |
|---|---|
| 404 | `Chat not found or access denied` |

---

### `POST /api/chats/direct`

Create or find an existing direct (1-on-1) chat.

**Request body:**
```json
{ "targetUserId": "cuid..." }
```

**Response `201`:** full chat object.

> The chat is **not broadcast** to the target user until the first message is sent. The `chat:new` WebSocket event fires only on `message:send`.

**Errors:**

| Status | message |
|---|---|
| 500 | `Cannot create chat with yourself` |

---

### `POST /api/chats/group`

Create a group chat.

**Request body:**
```json
{
  "name":      "Team Chat",
  "memberIds": ["cuid...", "cuid..."]
}
```

**Response `201`:** full chat object.

---

### `POST /api/chats/secret`

Create a secret (E2E encrypted) chat.

**Request body:**
```json
{ "targetUserId": "cuid..." }
```

**Response `201`:** full chat object with `type: "SECRET"`.

---

### `PATCH /api/chats/:id`

Update group chat name or avatar.

**Request body:**
```json
{
  "name":   "New Group Name",
  "avatar": "/uploads/avatars/abc.webp"
}
```

**Response `200`:** full chat object.

> Requires `OWNER` or `ADMIN` role.

---

### `POST /api/chats/:id/members`

Add members to a group chat.

**Request body:**
```json
{ "userIds": ["cuid...", "cuid..."] }
```

**Response `200`:** full chat object.

> Requires `OWNER` or `ADMIN` role. Subject to `allowGroupInvites` privacy setting.

---

### `DELETE /api/chats/:id/members/:userId`

Remove a member from a group chat.

**Response `200`:** full chat object.

> `OWNER` can remove anyone. `ADMIN` can remove `MEMBER`s.

---

### `PATCH /api/chats/:id/pin`

Pin or unpin a message in the chat.

**Request body:**
```json
{ "messageId": "cuid..." }
```

Pass `null` as `messageId` to unpin.

**Response `200`:** full chat object.

---

### `PATCH /api/chats/:id/archive`

Archive or unarchive a chat for the current user.

**Request body:**
```json
{ "archived": true }
```

**Response `200`:**
```json
{ "success": true, "data": { "chatId": "cuid...", "archived": true } }
```

---

### `GET /api/chats/:id/shared`

Get shared media for a chat (images, videos, files).

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `type` | — | Filter: `IMAGE`, `VIDEO`, `FILE`, `AUDIO` |
| `cursor` | — | Pagination cursor |
| `limit` | 20 | 1–100 |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cuid...",
        "type": "IMAGE",
        "mediaUrl": "/uploads/photo.webp",
        "mediaName": "photo.jpg",
        "mediaSize": 204800,
        "createdAt": "2026-03-08T12:00:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

---

### `DELETE /api/chats/:id/leave`

Leave a chat. For **direct/secret chats**, both users' memberships are removed and the chat is deleted for both.

**Response `200`:**
```json
{ "success": true, "data": { "message": "Left chat" } }
```

> Triggers `chat:deleted` WebSocket event to all former members.

---

### `POST /api/chats/saved`

Get or create the user's Saved Messages (self-chat). Creates on first call, returns existing on subsequent calls.

**Response `200` / `201`:** full chat object with `type: "SELF"`.

---

### `PATCH /api/chats/:id/pin-chat`

Pin or unpin a chat for the current user (max 5 pinned).

**Request body:**
```json
{ "pinned": true }
```

**Response `200`:**
```json
{ "success": true, "data": { "chatId": "cuid...", "pinned": true, "pinnedAt": "2026-03-14T..." } }
```

**Errors:**

| Status | message |
|---|---|
| 400 | `Maximum 5 pinned chats` |

---

### `PUT /api/chats/:id/draft`

Save a draft message for a chat.

**Request body:**
```json
{ "text": "draft text", "replyToId": null }
```

**Response `200`:** draft object.

---

### `DELETE /api/chats/:id/draft`

Delete a draft for a chat.

**Response `200`:**
```json
{ "success": true, "data": { "message": "Draft deleted" } }
```

---

### `GET /api/chats/:chatId/messages/around`

Get messages around a specific date (for search navigation).

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `date` | — | ISO 8601 date string (required) |
| `limit` | 50 | Number of messages to return |

**Response `200`:** same as regular messages endpoint.

---

## 9.5. Contact Endpoints

> Base path: `/api/contacts`
> **Requires Authorization.**

---

### `GET /api/contacts`

Get the current user's contact list.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid...",
      "nickname": "alice",
      "firstName": "Alice",
      "avatar": null,
      "isOnline": true,
      "lastOnline": null,
      "isMutual": true
    }
  ]
}
```

---

### `POST /api/contacts/:contactId`

Add a user to contacts.

**Response `201`:** contact record.

---

### `DELETE /api/contacts/:contactId`

Remove a user from contacts.

**Response `200`:** `{ "success": true, "data": { "message": "Contact removed" } }`

---

### `GET /api/contacts/:contactId/check`

Check contact status with a specific user.

**Response `200`:**
```json
{ "success": true, "data": { "isContact": true, "isMutual": true } }
```

---

## 9.6. Block Endpoints

> **Requires Authorization.**

### `POST /api/users/:id/block`

Block a user.

### `DELETE /api/users/:id/block`

Unblock a user.

### `GET /api/users/me/blocked`

Get list of blocked users.

---

## 9.7. Link Preview

> **Requires Authorization.**

### `GET /api/link-preview?url=<url>`

Fetch OG metadata for a URL. Results are cached server-side for 10 minutes.

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `url` | **yes** | Full URL (http/https only) |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com/article",
    "title": "Article Title",
    "description": "Article description text...",
    "image": "https://example.com/og-image.jpg",
    "siteName": "example.com"
  }
}
```

---

## 10. Message Endpoints

> Base path: `/api`  
> **Requires Authorization.**

---

### `GET /api/chats/:chatId/messages`

Get message history (cursor pagination, newest first). Supports full-text search.

**Query parameters:**

| Param | Default | Description |
|---|---|---|
| `cursor` | — | ID of oldest received message (loads older messages) |
| `limit` | 50 | 1–100 |
| `q` | — | Full-text search in `text` field (1–200 chars) |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id":        "cuid...",
        "chatId":    "cuid...",
        "text":      "Hello!",
        "type":      "TEXT",
        "mediaUrl":  null,
        "replyToId": null,
        "isEdited":  false,
        "isDeleted": false,
        "createdAt": "2026-03-08T12:00:00.000Z",
        "sender": {
          "id":       "cuid...",
          "nickname": "john.doe",
          "avatar":   null
        },
        "readReceipts": [
          { "userId": "cuid...", "readAt": "2026-03-08T12:01:00.000Z" }
        ],
        "reactions": [
          { "id": "cuid...", "userId": "cuid...", "emoji": "👍" }
        ],
        "replyTo": null
      }
    ],
    "nextCursor": null
  }
}
```

> Messages ordered **newest first**. Reverse before rendering.  
> `type` values: `TEXT` · `IMAGE` · `VIDEO` · `AUDIO` · `FILE`  
> For AUDIO type: `mediaUrl` contains the voice message file URL.

---

### `DELETE /api/messages/:id`

Hard-delete your own message (removed from database).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "message": "Deleted",
    "newLastMessage": { /* last remaining message in chat, or null */ }
  }
}
```

> Triggers `message:deleted` WS event to all chat members with `{ messageId, chatId, newLastMessage }`.

---

### `PATCH /api/messages/:id`

Edit the text of your own message.

**Request body:**
```json
{ "text": "Corrected text" }
```

**Response `200`:** full message object.

---

### `POST /api/messages/:id/read`

Mark a message as read. Creates a `ReadReceipt` record for the current user.

**Response `200`:**
```json
{ "success": true, "data": { "message": "Marked as read" } }
```

> Triggers `message:read` WS event to the message sender.

---

### `POST /api/messages/:id/reactions`

Add a reaction (upsert — duplicates ignored).

**Request body:**
```json
{ "emoji": "👍" }
```

> **Allowed emoji:** `👍` `❤️` `😂` `😮` `😢` `🔥`

**Response `201`:** reaction object.

> Triggers `reaction:added` WS event to all chat members.

---

### `DELETE /api/messages/:id/reactions/:emoji`

Remove your reaction. `:emoji` must be URL-encoded (e.g. `%F0%9F%91%8D` for `👍`).

**Response `200`:**
```json
{ "success": true, "data": { "message": "Removed" } }
```

> Triggers `reaction:removed` WS event to all chat members.

---

## 11. File Upload

> **Requires Authorization.** Uses `multipart/form-data`.

### `POST /api/upload`

```
POST /api/upload
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

file=<binary>
```

**Limits:**

| Constraint | Value |
|---|---|
| Max file size | **20 MB** |
| Images | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |
| Video | `video/mp4`, `video/webm` |
| Audio | `audio/mpeg`, `audio/ogg`, `audio/webm` (voice messages) |
| Documents | `application/pdf`, `text/plain`, `application/zip`, `.doc`, `.docx` |

> **Images are auto-optimized**: resized to max 1920×1920px and converted to WebP (quality 82) using Sharp. Three versions are generated: original, medium (800px), and thumbnail (200px).
> **Magic bytes validation**: uploaded files are validated by their actual content (not just MIME type) using the `file-type` library.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "url":  "/uploads/1740825600000-a3b2c1d4.jpg",
    "type": "IMAGE",
    "name": "photo.jpg",
    "size": 204800
  }
}
```

### `POST /api/upload/avatar`

Upload an avatar image. Resized to 400×400 WebP.

**Limits:** Max 10 MB, images only.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "url": "/uploads/avatars/abc.webp",
    "type": "IMAGE",
    "name": "abc.webp",
    "size": 25600
  }
}
```

---

**Sending a voice message:**
```json
// 1. Upload audio file (audio/webm or audio/ogg)
POST /api/upload → { "url": "/uploads/voice-xyz.webm", "type": "AUDIO" }

// 2. Send via WebSocket
{
  "event": "message:send",
  "payload": {
    "chatId":   "cuid...",
    "text":     "",
    "type":     "AUDIO",
    "mediaUrl": "/uploads/voice-xyz.webm"
  }
}
```

---

## 12. Keys (Signal Protocol)

> Base path: `/api/keys`  
> **Requires Authorization.**

---

### `POST /api/keys/bundle`

Upload or replace the current user's PreKey Bundle.

**Request body:**
```json
{
  "registrationId":  12345,
  "identityKey":     "base64...",
  "signedPreKeyId":  1,
  "signedPreKey":    "base64...",
  "signedPreKeySig": "base64...",
  "oneTimePreKeys":  [
    { "keyId": 1, "publicKey": "base64..." }
  ]
}
```

**Response `201`:**
```json
{ "success": true, "data": { "uploaded": true } }
```

---

### `GET /api/keys/bundle/:userId`

Fetch a user's PreKey Bundle (atomically consumes one OTP prekey).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "registrationId":  12345,
    "identityKey":     "base64...",
    "signedPreKeyId":  1,
    "signedPreKey":    "base64...",
    "signedPreKeySig": "base64...",
    "preKey": { "keyId": 7, "publicKey": "base64..." }
  }
}
```

> `preKey` is `null` if OTP prekeys are exhausted. Replenish when count < 20.

---

### `GET /api/keys/has-bundle/:userId`

Check if a user has a bundle (no OTP consumed).

**Response `200`:**
```json
{ "success": true, "data": { "hasBundle": true } }
```

---

### `POST /api/keys/replenish`

Add more one-time prekeys.

**Request body:**
```json
{
  "preKeys": [
    { "keyId": 101, "publicKey": "base64..." }
  ]
}
```

**Response `200`:**
```json
{ "success": true, "data": { "added": 1 } }
```

---

### `GET /api/keys/count`

Get remaining OTP prekey count.

**Response `200`:**
```json
{ "success": true, "data": { "count": 47 } }
```

---

## 13. WebSocket

### Connection

```
wss://<your-domain>/ws
```

After connecting, authenticate by sending an `auth` event:

```json
{ "event": "auth", "payload": { "token": "<accessToken>" } }
```

Server responds with `auth:ok` on success or closes the connection with code `4001` on failure.

```javascript
const ws = new WebSocket(`wss://example.com/ws`);

ws.onopen = () => {
  ws.send(JSON.stringify({ event: 'auth', payload: { token: accessToken } }));
};

ws.onmessage = (e) => {
  const { event, payload } = JSON.parse(e.data);
  if (event === 'auth:ok') { /* authenticated, start app */ }
};
```

### Keep-alive

Send `presence:ping` every **25 seconds** to maintain online status and prevent connection timeout:

```json
{ "event": "presence:ping" }
```

---

### Client → Server Events

#### `auth`

Authenticate after connecting:

```json
{ "event": "auth", "payload": { "token": "<accessToken>" } }
```

Server responds with `auth:ok` containing user data and presence snapshot.

---

#### `message:send`

```json
{
  "event": "message:send",
  "payload": {
    "chatId":       "cuid...",
    "text":         "Hello!",
    "type":         "TEXT",
    "mediaUrl":     null,
    "replyToId":    null,
    "mediaGroupId": null
  }
}
```

| Field | Required | Description |
|---|---|---|
| `chatId` | **yes** | Target chat |
| `text` | no | Message text |
| `type` | no | `TEXT` · `IMAGE` · `VIDEO` · `AUDIO` · `FILE` (default: `TEXT`) |
| `mediaUrl` | no | URL from `/api/upload` |
| `replyToId` | no | ID of quoted message |
| `mediaGroupId` | no | Shared ID to group multiple media messages together |

> Server responds with `message:new` (all members) + `message:delivered` (sender, if ≥1 recipient online).  
> On the **first message** in a new direct chat, the `chat:new` event is sent to the recipient.

---

#### `message:read`

```json
{
  "event": "message:read",
  "payload": { "messageId": "cuid...", "chatId": "cuid..." }
}
```

> Server responds with `message:read` → sender only.

---

#### `typing:start` / `typing:stop`

```json
{ "event": "typing:start", "payload": { "chatId": "cuid..." } }
{ "event": "typing:stop",  "payload": { "chatId": "cuid..." } }
```

> Server responds with `typing:started` / `typing:stopped` → all members except sender.

---

#### `presence:ping`

```json
{ "event": "presence:ping" }
```

Extends online TTL. No response.

---

#### `presence:away`

Notify server that the user has switched away (tab hidden, browser minimized).

```json
{ "event": "presence:away" }
```

---

#### `presence:back`

Notify server that the user has returned.

```json
{ "event": "presence:back" }
```

---

#### `message:listened`

Mark a voice message as listened.

```json
{ "event": "message:listened", "payload": { "messageId": "cuid...", "chatId": "cuid..." } }
```

---

#### `message:forward`

Forward a message to another chat.

```json
{
  "event": "message:send",
  "payload": {
    "chatId": "target-chat-id",
    "text": "forwarded text",
    "type": "TEXT",
    "forwardedFromId": "original-message-id",
    "forwardSenderName": "Original Sender"
  }
}
```

---

### Server → Client Events

#### `auth:ok`

Sent after successful authentication.

```json
{
  "event": "auth:ok",
  "payload": {
    "userId": "cuid...",
    "onlineUserIds": ["cuid...", "cuid..."]
  }
}
```

---

#### `message:new`

New message. Delivered to **all chat members** (including sender).

```json
{
  "event": "message:new",
  "payload": {
    "id":          "cuid...",
    "chatId":      "cuid...",
    "text":        "Hello!",
    "type":        "TEXT",
    "mediaUrl":    null,
    "replyToId":   null,
    "isEdited":    false,
    "isDeleted":   false,
    "createdAt":   "2026-03-08T12:00:00.000Z",
    "sender": { "id": "cuid...", "nickname": "john.doe", "avatar": null },
    "readReceipts": [],
    "reactions":    [],
    "replyTo":      null
  }
}
```

---

#### `message:delivered`

Delivered to **sender only** when ≥1 recipient is online.

```json
{
  "event": "message:delivered",
  "payload": { "messageId": "cuid...", "chatId": "cuid..." }
}
```

---

#### `message:read`

Delivered to **sender only**.

```json
{
  "event": "message:read",
  "payload": { "messageId": "cuid...", "chatId": "cuid...", "readBy": "cuid..." }
}
```

---

#### `message:edited`

Sent to **all chat members**.

```json
{
  "event": "message:edited",
  "payload": { "id": "cuid...", "chatId": "cuid...", "text": "Updated text", "isEdited": true }
}
```

---

#### `message:deleted`

Sent to **all chat members**.

```json
{
  "event": "message:deleted",
  "payload": { "messageId": "cuid...", "chatId": "cuid..." }
}
```

---

#### `chat:new`

New chat appeared (e.g. first message in a new direct chat). Sent to **recipient only**.

```json
{
  "event": "chat:new",
  "payload": { /* full chat object */ }
}
```

---

#### `chat:deleted`

Chat was deleted or user left. Sent to **all former members**.

```json
{
  "event": "chat:deleted",
  "payload": { "chatId": "cuid..." }
}
```

---

#### `chat:updated`

Chat metadata updated (name, avatar, pinned message). Sent to **all members**.

```json
{
  "event": "chat:updated",
  "payload": { "chatId": "cuid...", "name": "New Name", "avatar": "...", "pinnedMessageId": "..." }
}
```

---

#### `chat:member-left`

A member left the group. Sent to **remaining members**.

```json
{
  "event": "chat:member-left",
  "payload": { "chatId": "cuid...", "userId": "cuid..." }
}
```

---

#### `message:listened`

A voice message was listened to. Sent to **sender**.

```json
{
  "event": "message:listened",
  "payload": { "messageId": "cuid...", "chatId": "cuid...", "userId": "cuid..." }
}
```

---

#### `reaction:added` / `reaction:removed`

Sent to **all chat members**.

```json
{
  "event": "reaction:added",
  "payload": {
    "reaction": { "id": "cuid...", "messageId": "cuid...", "userId": "cuid...", "emoji": "👍" },
    "chatId": "cuid..."
  }
}

{
  "event": "reaction:removed",
  "payload": { "messageId": "cuid...", "userId": "cuid...", "emoji": "👍", "chatId": "cuid..." }
}
```

---

#### `typing:started` / `typing:stopped`

Sent to **all members except the typer**.

```json
{ "event": "typing:started", "payload": { "chatId": "cuid...", "userId": "cuid..." } }
{ "event": "typing:stopped", "payload": { "chatId": "cuid...", "userId": "cuid..." } }
```

---

#### `user:online` / `user:offline`

Broadcast to **all connected users** (respecting `showOnlineStatus` privacy setting).

```json
{ "event": "user:online",  "payload": { "userId": "cuid...", "lastOnline": null } }
{ "event": "user:offline", "payload": { "userId": "cuid...", "lastOnline": "2026-03-08T12:05:30.000Z" } }
```

> If user has `showOnlineStatus: false`, their `user:online` is NOT broadcast. Other users see them as "seen recently" with `lastOnline: null`.

---

#### `presence:snapshot`

Sent **only to newly connecting client** with list of currently online users.

```json
{
  "event": "presence:snapshot",
  "payload": { "onlineUserIds": ["cuid...", "cuid..."] }
}
```

---

#### `user:updated`

A user updated their profile. Broadcast to **all users sharing a chat** with the updated user.

```json
{
  "event": "user:updated",
  "payload": {
    "id":        "cuid...",
    "nickname":  "new.nick",
    "firstName": "John",
    "lastName":  "Doe",
    "avatar":    "/uploads/new-avatar.jpg",
    "bio":       "Updated bio"
  }
}
```

---

#### `error`

Sent when server cannot process an incoming WS event.

```json
{ "event": "error", "payload": { "message": "Failed to send message" } }
```

---

## 14. Error Reference

### HTTP Error Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `400` | Bad Request |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not Found |
| `409` | Conflict (duplicate) |
| `422` | Unprocessable (validation) |
| `429` | Too Many Requests |
| `502` | External service failure (email) |
| `500` | Internal Server Error |

### Error Codes Reference

| code | Status | Description |
|---|---|---|
| `OTP_TOO_SOON` | 429 | Resend requested < 60s after previous send |
| `EMAIL_SEND_FAILED` | 502 | SMTP delivery failed |
| `OTP_EXPIRED` | 400 | Code expired (10 min TTL) or not found |
| `INVALID_CODE` | 400 | Wrong OTP code |
| `OTP_MAX_ATTEMPTS` | 429 | 5 wrong attempts — code invalidated |
| `DISPOSABLE_EMAIL` | 422 | Temporary email domain blocked |
| `EMAIL_INVALID` | 422 | Invalid email format |
| `NICKNAME_REQUIRED` | 422 | New user must provide a username |
| `NICKNAME_TAKEN` | 409 | Username already registered |
| `NICKNAME_TOO_SHORT` | 422 | Username < 5 chars |
| `NICKNAME_INVALID_CHARS` | 422 | Invalid characters in username |
| `INVALID_CREDENTIALS` | 401 | Wrong nickname/password (legacy login) |

---

## 15. Database Schema

### Models

| Model | Description |
|---|---|
| `User` | User accounts with profile (nickname, firstName, lastName, avatar, bio, settings) |
| `RefreshToken` | Active JWT refresh tokens |
| `DeviceToken` | FCM/APNs/Web push tokens |
| `Chat` | Chats (`DIRECT` / `GROUP` / `SECRET` / `SELF`) |
| `ChatMember` | Chat membership (`OWNER` / `ADMIN` / `MEMBER`) with `isArchived` flag, `pinnedAt` (DateTime?) |
| `Draft` | User drafts per chat (text, replyToId, timestamps) |
| `UserBlock` | User blocking records |
| `Contact` | User contact lists |
| `VoiceListen` | Voice message listen records |
| `Message` | Messages with soft-delete, supports TEXT/IMAGE/VIDEO/AUDIO/FILE. `mediaGroupId` for grouped media |
| `Reaction` | Emoji reactions on messages |
| `ReadReceipt` | Per-user message read timestamps |
| `PreKeyBundle` | Signal Protocol identity bundle |
| `OneTimePreKey` | Signal Protocol ephemeral prekeys |

### User settings schema (stored as JSON in `settings` column)

```json
{
  "notifSound":        true,
  "notifDesktop":      true,
  "sendByEnter":       true,
  "fontSize":          "medium",
  "showOnlineStatus":  true,
  "showReadReceipts":  true,
  "mediaAutoDownload": true,
  "chatWallpaper":     "default",
  "locale":            "ru"
}
```

### Key Enums

```
ChatType:       DIRECT | GROUP | SECRET | SELF
ChatMemberRole: OWNER  | ADMIN | MEMBER
MessageType:    TEXT | IMAGE | FILE | AUDIO | VIDEO | SYSTEM
Platform:       IOS | ANDROID | WEB
```

---

## 16. Quick Reference Table

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Basic liveness |
| GET | `/api/health` | — | DB + Redis status |
| POST | `/api/auth/send-otp` | — | Send OTP to email |
| POST | `/api/auth/verify-otp` | — | Verify OTP → login or register |
| POST | `/api/auth/refresh` | — | Refresh token pair |
| POST | `/api/auth/logout` | — | Invalidate refresh token |
| GET | `/api/users/me` | JWT | My profile |
| PATCH | `/api/users/me` | JWT | Update profile |
| DELETE | `/api/users/me` | JWT | Delete account |
| GET | `/api/users/me/settings` | JWT | Get app settings |
| PUT | `/api/users/me/settings` | JWT | Update app settings |
| POST | `/api/users/me/device-token` | JWT | Register push token |
| DELETE | `/api/users/me/device-token` | JWT | Remove push token |
| GET | `/api/users/me/blocked` | JWT | Blocked users list |
| POST | `/api/users/:id/block` | JWT | Block user |
| DELETE | `/api/users/:id/block` | JWT | Unblock user |
| GET | `/api/users/search?q=` | JWT | Search by nickname |
| GET | `/api/users/:id` | JWT | User profile by ID |
| GET | `/api/contacts` | JWT | Contact list |
| POST | `/api/contacts/:contactId` | JWT | Add contact |
| DELETE | `/api/contacts/:contactId` | JWT | Remove contact |
| GET | `/api/contacts/:contactId/check` | JWT | Check contact status |
| GET | `/api/chats` | JWT | Chat list (`?archived=true` for archive) |
| GET | `/api/chats/:id` | JWT | Single chat |
| GET | `/api/chats/:id/shared` | JWT | Shared media |
| POST | `/api/chats/direct` | JWT | Create/find direct chat |
| POST | `/api/chats/group` | JWT | Create group chat |
| POST | `/api/chats/secret` | JWT | Create secret chat |
| PATCH | `/api/chats/:id` | JWT | Update chat (name/avatar) |
| POST | `/api/chats/:id/members` | JWT | Add members |
| DELETE | `/api/chats/:id/members/:userId` | JWT | Remove member |
| PATCH | `/api/chats/:id/pin` | JWT | Pin/unpin message |
| PATCH | `/api/chats/:id/archive` | JWT | Archive/unarchive chat |
| DELETE | `/api/chats/:id/leave` | JWT | Leave / delete chat |
| POST | `/api/chats/saved` | JWT | Get/create Saved Messages |
| PATCH | `/api/chats/:id/pin-chat` | JWT | Pin/unpin chat (max 5) |
| PUT | `/api/chats/:id/draft` | JWT | Save draft |
| DELETE | `/api/chats/:id/draft` | JWT | Delete draft |
| GET | `/api/chats/:chatId/messages` | JWT | Message history + search |
| GET | `/api/chats/:chatId/messages/around` | JWT | Messages around date |
| DELETE | `/api/messages/:id` | JWT | Hard-delete message |
| PATCH | `/api/messages/:id` | JWT | Edit message |
| POST | `/api/messages/:id/read` | JWT | Mark as read |
| POST | `/api/messages/:id/reactions` | JWT | Add reaction |
| DELETE | `/api/messages/:id/reactions/:emoji` | JWT | Remove reaction |
| POST | `/api/keys/bundle` | JWT | Upload Signal bundle |
| GET | `/api/keys/bundle/:userId` | JWT | Fetch bundle (consumes OTP key) |
| GET | `/api/keys/has-bundle/:userId` | JWT | Check bundle exists |
| POST | `/api/keys/replenish` | JWT | Add OTP prekeys |
| GET | `/api/keys/count` | JWT | OTP key count |
| POST | `/api/upload` | JWT | Upload file (max 20MB) |
| POST | `/api/upload/avatar` | JWT | Upload avatar (max 10MB) |
| GET | `/api/link-preview?url=` | JWT | Fetch URL preview |
| GET | `/uploads/:filename` | — | Serve uploaded file |

### WebSocket Events

| Direction | Event | Recipient |
|---|---|---|
| C → S | `auth` | — |
| C → S | `message:send` | — |
| C → S | `message:read` | — |
| C → S | `message:listened` | — |
| C → S | `typing:start` | — |
| C → S | `typing:stop` | — |
| C → S | `presence:ping` | — |
| C → S | `presence:away` | — |
| C → S | `presence:back` | — |
| S → C | `auth:ok` | Connecting client |
| S → C | `message:new` | All chat members |
| S → C | `message:delivered` | Sender only |
| S → C | `message:read` | All chat members |
| S → C | `message:edited` | All chat members |
| S → C | `message:deleted` | All chat members |
| S → C | `message:listened` | Sender only |
| S → C | `chat:new` | Recipient only |
| S → C | `chat:deleted` | All former members |
| S → C | `chat:updated` | All chat members |
| S → C | `chat:member-left` | Remaining members |
| S → C | `reaction:added` | All chat members |
| S → C | `reaction:removed` | All chat members |
| S → C | `typing:started` | All except typer |
| S → C | `typing:stopped` | All except typer |
| S → C | `user:online` | Relevant connected users |
| S → C | `user:offline` | Relevant connected users |
| S → C | `user:updated` | Users sharing a chat |
| S → C | `draft:updated` | Draft owner (other devices) |
| S → C | `presence:snapshot` | Newly connecting client |
| S → C | `error` | Requesting client |
