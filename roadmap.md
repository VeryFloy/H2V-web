## Версия 1.0.0 — Android: Liquid Glass UI (05.03.2026)

### Что сделано
- Liquid glass нижняя панель: библиотека haze (backdrop blur) + hazeChild
- Animated glow pill для активного таба + spring анимации иконок
- Specular highlight border (верхняя светящаяся линия)
- Components.kt: liquidGlass modifier с vертикальным градиентом + specular top line
- Theme.kt: обновлённая палитра — AccentBlue #4E86FF, AppBg #0C0C0E
- AuthScreen: анимированный фон, пульсирующий логотип, gradient submit кнопка
- Animation: spring/tween переходы, EaseOutCubic/EaseInCubic easing
- BUILD SUCCESSFUL — app-debug.apk готов

## Версия 0.9.0 — Android: сборка и исправление ошибок (05.03.2026)

### Что сделано
- Исправлен AGP: 8.5.2 → 8.7.3 (поддержка compileSdk 35)
- Добавлены android.useAndroidX=true, android.enableJetifier=true в gradle.properties
- Добавлена зависимость material-icons-extended
- Исправлены иконки: Group→People, WifiOff→CloudOff, ChevronLeft→ArrowBack, Logout→ExitToApp
- Исправлены импорты MutableInteractionSource в ChatScreen.kt
- Исправлены вызовы Modifier.padding(horizontal, bottom)
- Исправлен вызов updateMe() с обязательными параметрами
- Тема XML заменена на android:Theme.Material.Light.NoActionBar
- BUILD SUCCESSFUL — app-debug.apk готов

# H2V Messenger — Roadmap

## Версия 0.1.0 — Базовый бэкенд (01.03.2026)

### Что сделано

#### Структура проекта
- `messenger-backend/` — Node.js + TypeScript + Express
- Prisma 7 (PostgreSQL) + Redis (ioredis) + WebSocket (ws)
- JWT авторизация (access + refresh токены)

#### Аутентификация (`/api/auth`)
- [x] `POST /register` — регистрация (nickname, email, password)
- [x] `POST /login` — вход, возврат access + refresh токена
- [x] `POST /refresh` — обновление access-токена по refresh
- [x] `POST /logout` — инвалидация refresh-токена

#### Пользователи (`/api/users`)
- [x] `GET /me` — свой профиль
- [x] `PATCH /me` — обновить nickname / avatar / bio
- [x] `GET /search?q=` — поиск по nickname
- [x] `GET /:id` — профиль любого пользователя

#### Чаты (`/api/chats`)
- [x] `GET /` — список чатов с последним сообщением
- [x] `GET /:id` — детали чата
- [x] `POST /direct` — создать личный чат (DIRECT)
- [x] `POST /group` — создать групповой чат
- [x] `DELETE /:id/leave` — покинуть чат

#### Сообщения (`/api/chats/:chatId/messages`, `/api/messages/:id`)
- [x] `GET /chats/:chatId/messages` — история (cursor pagination)
- [x] `PATCH /messages/:id` — редактировать сообщение
- [x] `DELETE /messages/:id` — soft-delete сообщения

#### WebSocket (`ws://host/ws?token=JWT`)
| Event (клиент → сервер) | Описание |
|------------------------|----------|
| `message:send` | Отправить сообщение в чат |
| `message:read` | Отметить сообщение прочитанным |
| `typing:start` | Начал набирать текст |
| `typing:stop` | Перестал набирать |
| `presence:ping` | Heartbeat онлайн-статуса |

| Event (сервер → клиент) | Описание |
|------------------------|----------|
| `message:new` | Новое сообщение в чате |
| `message:read` | Кто-то прочитал сообщение |
| `message:deleted` | Сообщение удалено |
| `typing:started` | Пользователь печатает |
| `typing:stopped` | Перестал печатать |
| `user:online` | Пользователь онлайн |
| `user:offline` | Пользователь офлайн |
| `error` | Ошибка |

#### Структура БД (Prisma / PostgreSQL)
- `users` — id, nickname, email, password_hash, avatar, bio, last_online, is_online
- `refresh_tokens` — id, token, user_id, expires_at
- `chats` — id, type (DIRECT/GROUP), name, avatar, description
- `chat_members` — id, chat_id, user_id, role (OWNER/ADMIN/MEMBER)
- `messages` — id, chat_id, sender_id, text, type, media_url, reply_to_id, is_edited, is_deleted
- `read_receipts` — id, message_id, user_id, read_at

#### Redis (присутствие)
- `user:{id}:online` — TTL 60s, продлевается heartbeat каждые 30s
- `user:{id}:last_online` — ISO-дата последнего онлайна
- `chat:{id}:typing:{userId}` — TTL 5s, обновляется при наборе

---

## Версия 0.4.0 — Signal Protocol E2E Encryption (01.03.2026)

### Что сделано

#### Backend: новые модели Prisma
- [x] `prekey_bundles` — identity key, signed prekey, registration ID (1 на пользователя)
- [x] `one_time_prekeys` — одноразовые prekeys, удаляются при выдаче
- [x] `messages.ciphertext` — зашифрованный blob (base64)
- [x] `messages.signal_type` — тип Signal сообщения (0=plain, 1=preKeyWhisper, 3=whisper)
- [x] Миграция `e2e_signal_protocol` применена

#### Backend: API ключей (`/api/keys`)
- [x] `POST /api/keys/bundle` — загрузить свой PreKeyBundle + OneTimePreKeys
- [x] `GET /api/keys/bundle/:userId` — получить bundle собеседника (OTP key удаляется)
- [x] `POST /api/keys/replenish` — пополнить одноразовые prekeys
- [x] `GET /api/keys/count` — количество оставшихся OTP keys

#### Backend: сообщения с шифрованием
- [x] `message.service.sendMessage()` принимает `ciphertext` + `signalType`
- [x] WS event `message:send` поддерживает `ciphertext` + `signalType`
- [x] Сервер не расшифровывает — передаёт blob as-is

#### Frontend: Signal Protocol
- [x] Библиотека `@privacyresearch/libsignal-protocol-typescript` собрана в `signal-protocol.js` (esbuild, IIFE)
- [x] `crypto-store.js` — реализация `StorageType` через IndexedDB
- [x] Генерация ключей при регистрации/входе (identity, signed prekey, 100 OTP keys)
- [x] Автоматическая загрузка ключей на сервер (`POST /api/keys/bundle`)
- [x] Построение сессии (X3DH) при открытии чата
- [x] Шифрование при отправке (`SessionCipher.encrypt`)
- [x] Дешифровка при получении (`SessionCipher.decryptWhisperMessage` / `decryptPreKeyWhisperMessage`)
- [x] Поддержка Double Ratchet — сессия обновляется автоматически

#### UI: индикаторы E2E
- [x] Иконка замка на каждом зашифрованном сообщении
- [x] Бейдж "E2E" в заголовке чата
- [x] Иконка замка в списке чатов (direct)
- [x] В sidebar: "Зашифрованное сообщение" для зашифрованных превью
- [x] Fallback: "Не удалось расшифровать" при ошибке декрипта

#### Ограничения (by design)
- Нет бэкапа ключей — при очистке IndexedDB/смене браузера история нечитаема
- E2E только для DIRECT-чатов (групповые — plaintext)
- Старые plaintext-сообщения сохранены, новые — encrypted

---

## Backlog (следующие итерации)

- [x] ~~Загрузка медиафайлов~~ → реализовано, S3 в планах
- [ ] Push-уведомления (FCM / APNs)
- [x] ~~Реакции на сообщения~~ → реализовано в 0.6.0
- [x] ~~Пересылка сообщений~~ → реализовано
- [x] ~~Роль ADMIN в группах~~ → реализовано
- [x] ~~Rate limiting~~ → реализовано в 0.5.0
- [ ] Swagger / OpenAPI документация
- [ ] Unit и интеграционные тесты (Vitest)
- [ ] Docker Compose (postgres + redis + app)
- [ ] Sender Keys для групповых E2E чатов
- [x] ~~Пополнение OTP keys при малом количестве~~ → реализовано в 0.6.1
- [ ] Верификация identity ключей (QR-код / fingerprint)

---

## Версии

| Версия | Дата | Описание |
|--------|------|----------|
| 0.1.0 | 01.03.2026 | Базовый бэкенд: auth, users, chats, messages, WS |
| 0.1.1 | 01.03.2026 | Фикс Prisma 7 config, Redis optional fallback, сервер запущен |
| 0.2.0 | 01.03.2026 | Фронтенд: SPA на ванильном JS (auth, чаты, WS, typing, presence) |
| 0.3.0 | 01.03.2026 | Realtime: unread badges, typing animation, checkmarks, sounds, reconnect |
| 0.4.0 | 01.03.2026 | Signal Protocol E2E: X3DH + Double Ratchet, шифрование всех direct-сообщений |
| 0.4.1 | 01.03.2026 | Fix: регистрация не блокируется ошибками E2E key init |
| 0.4.2 | 01.03.2026 | Fix: расшифрованные сообщения видны после перезагрузки (localStorage cache) |
| 0.5.0 | 01.03.2026 | Security: rate limiting, race condition OTP fix, ciphertext очищается при удалении, лимит JSON 2mb |
| 0.5.1 | 01.03.2026 | Performance: индексы БД, cursor-based pagination для чатов |
| 0.6.0 | 01.03.2026 | Features: реакции, загрузка файлов/медиа, поиск по сообщениям, reply, контекстное меню |
| 0.6.1 | 01.03.2026 | Fix E2E + presence: has-bundle endpoint, presence:snapshot, автопополнение prekeys |
| 0.6.2 | 01.03.2026 | Документация: создан API.md — полная документация REST, WS, схемы БД |
| 0.7.0 | 01.03.2026 | iOS-готовность: DELETE /api/users/me, device-token, REST message:read, health check |
| 0.8.0 | 05.03.2026 | Android: Kotlin + Jetpack Compose — Auth, ChatList, Chat, Profile (HTTPS/WSS) |
| 0.9.0 | 05.03.2026 | Android: сборка и исправление ошибок, AGP 8.7.3, material-icons-extended |
| 1.0.0 | 05.03.2026 | Android: Liquid Glass UI — haze blur, animated glow pill, specular highlight |
