/* ─── Error codes → русский ─────────────────────────────────────── */
const ERROR_MESSAGES = {
  EMAIL_TAKEN:           'Этот email уже занят',
  NICKNAME_TAKEN:        'Этот никнейм уже занят',
  INVALID_CREDENTIALS:   'Неверный email или пароль',
  NICKNAME_TOO_SHORT:    'Никнейм минимум 3 символа',
  NICKNAME_INVALID_CHARS:'Никнейм: только латиница, цифры и _',
  PASSWORD_TOO_SHORT:    'Пароль минимум 8 символов',
  EMAIL_INVALID:         'Неверный формат email',
  FIELD_REQUIRED:        'Заполните все поля',
};
function tr(code) { return ERROR_MESSAGES[code] ?? code ?? 'Ошибка'; }

/* ─── Config ────────────────────────────────────────────────────── */
const API = window.location.origin;
const WS_PROTO = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTO}//${window.location.host}/ws`;

/* ─── State ──────────────────────────────────────────────────────── */
const state = {
  accessToken:  localStorage.getItem('accessToken') || null,
  refreshToken: localStorage.getItem('refreshToken') || null,
  me:           JSON.parse(localStorage.getItem('me') || 'null'),
  chats:        [],
  activeChatId: null,
  onlineUsers:  new Set(),
  ws:           null,
  wsHeartbeat:  null,
  typingTimers: {},
  unread:       {},
  signalStore:  null,
};

/* ════════════════════════════════════════════════════════════════════
   Signal Protocol E2E Encryption
   ════════════════════════════════════════════════════════════════════ */
const { KeyHelper, SignalProtocolAddress, SessionBuilder, SessionCipher } = window.SignalLib || {};
const { arrayBufferToBase64, base64ToArrayBuffer, textToArrayBuffer, arrayBufferToText } = window.SignalUtils || {};

const PREKEY_COUNT = 100;
const pendingPlaintext = {}; // chatId → last sent plaintext (for own message display)

function getSignalStore() {
  if (!state.signalStore && state.me) {
    state.signalStore = new window.SignalStore(state.me.id);
  }
  return state.signalStore;
}

async function initSignalKeys() {
  const store = getSignalStore();
  if (!store) return;

  if (await store.hasIdentityKeyPair()) {
    console.log('[E2E] Keys already exist');
    return;
  }

  console.log('[E2E] Generating identity keys...');
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

  await store.storeIdentityKeyPair(identityKeyPair);
  await store.storeLocalRegistrationId(registrationId);
  await store.storeSignedPreKey(1, signedPreKey.keyPair);

  const preKeys = [];
  for (let i = 1; i <= PREKEY_COUNT; i++) {
    const pk = await KeyHelper.generatePreKey(i);
    await store.storePreKey(i, pk.keyPair);
    preKeys.push({
      keyId: i,
      publicKey: arrayBufferToBase64(pk.keyPair.pubKey),
    });
  }

  await api('POST', '/api/keys/bundle', {
    registrationId,
    identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
    signedPreKeyId: signedPreKey.keyId,
    signedPreKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
    signedPreKeySig: arrayBufferToBase64(signedPreKey.signature),
    oneTimePreKeys: preKeys,
  });

  console.log('[E2E] Keys generated and uploaded');
}

function getAddress(userId) {
  return new SignalProtocolAddress(userId, 1);
}

async function hasSession(userId) {
  const store = getSignalStore();
  if (!store) return false;
  const addr = getAddress(userId);
  const record = await store.loadSession(addr.toString());
  return !!record;
}

async function buildSession(partnerId) {
  const store = getSignalStore();
  if (!store) return false;

  try {
    const res = await api('GET', `/api/keys/bundle/${partnerId}`);
    if (!res?.success || !res.data) {
      console.warn('[E2E] No bundle for', partnerId);
      return false;
    }

    const bundle = res.data;
    const addr = getAddress(partnerId);

    const preKeyBundle = {
      registrationId: bundle.registrationId,
      identityKey: base64ToArrayBuffer(bundle.identityKey),
      signedPreKey: {
        keyId: bundle.signedPreKeyId,
        publicKey: base64ToArrayBuffer(bundle.signedPreKey),
        signature: base64ToArrayBuffer(bundle.signedPreKeySig),
      },
    };

    if (bundle.preKey) {
      preKeyBundle.preKey = {
        keyId: bundle.preKey.keyId,
        publicKey: base64ToArrayBuffer(bundle.preKey.publicKey),
      };
    }

    const builder = new SessionBuilder(store, addr);
    await builder.processPreKey(preKeyBundle);
    console.log('[E2E] Session built with', partnerId);
    return true;
  } catch (err) {
    console.error('[E2E] Failed to build session:', err);
    return false;
  }
}

async function encryptMessage(partnerId, plaintext) {
  const store = getSignalStore();
  if (!store) return null;

  try {
    const addr = getAddress(partnerId);
    const cipher = new SessionCipher(store, addr);
    const encrypted = await cipher.encrypt(textToArrayBuffer(plaintext));
    return {
      ciphertext: arrayBufferToBase64(
        typeof encrypted.body === 'string'
          ? new TextEncoder().encode(encrypted.body).buffer
          : encrypted.body
      ),
      signalType: encrypted.type,
    };
  } catch (err) {
    console.error('[E2E] Encrypt failed:', err);
    return null;
  }
}

async function decryptMessage(senderId, ciphertext, signalType) {
  const store = getSignalStore();
  if (!store) return null;

  try {
    const addr = getAddress(senderId);
    const cipher = new SessionCipher(store, addr);
    const body = base64ToArrayBuffer(ciphertext);

    let plainBuf;
    if (signalType === 3) {
      plainBuf = await cipher.decryptWhisperMessage(body);
    } else {
      plainBuf = await cipher.decryptPreKeyWhisperMessage(body);
    }

    return arrayBufferToText(plainBuf);
  } catch (err) {
    console.error('[E2E] Decrypt failed:', err);
    return null;
  }
}

function isE2EAvailable() {
  return !!(window.SignalLib && window.SignalStore && window.SignalUtils);
}

/* ─── API ────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;

  let res;
  try {
    res = await fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Нет соединения с сервером');
  }

  const json = await res.json().catch(() => ({}));

  if (res.status === 401 && state.refreshToken) {
    const ok = await refreshTokens();
    if (ok) return api(method, path, body);
    logout();
    return null;
  }

  if (!res.ok) throw new Error(tr(json?.message));
  return json;
}

async function refreshTokens() {
  try {
    const res = await fetch(`${API}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: state.refreshToken }),
    });
    if (!res.ok) return false;
    const { data } = await res.json();
    saveTokens(data);
    return true;
  } catch { return false; }
}

function saveTokens({ accessToken, refreshToken }) {
  state.accessToken  = accessToken;
  state.refreshToken = refreshToken;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

/* ════════════════════════════════════════════════════════════════════
   WebSocket — connect / reconnect / heartbeat
   ════════════════════════════════════════════════════════════════════ */
function connectWS() {
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  clearInterval(state.wsHeartbeat);

  showConnectionStatus('connecting');

  const ws = new WebSocket(`${WS_URL}?token=${state.accessToken}`);
  state.ws = ws;

  ws.onopen = () => {
    console.log('[WS] connected');
    showConnectionStatus('online');

    // Heartbeat каждые 25 сек
    state.wsHeartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ event: 'presence:ping' }));
    }, 25_000);
  };

  ws.onmessage = ({ data }) => {
    try { handleWsEvent(JSON.parse(data)); } catch {}
  };

  ws.onclose = (e) => {
    clearInterval(state.wsHeartbeat);
    if (e.code === 4001) {
      // Невалидный токен — не реконнектим
      showConnectionStatus('offline');
      return;
    }
    showConnectionStatus('reconnecting');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => {};
}

function wsSend(event, payload) {
  if (state.ws?.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify({ event, payload }));
}

function showConnectionStatus(status) {
  let el = document.getElementById('conn-status');
  if (!el) return;

  const map = {
    online:       { text: '',                    cls: '' },
    connecting:   { text: 'Подключение...',      cls: 'conn-warn' },
    reconnecting: { text: 'Переподключение...', cls: 'conn-warn' },
    offline:      { text: 'Нет связи',           cls: 'conn-err' },
  };
  const s = map[status] || map.offline;
  el.textContent = s.text;
  el.className = 'conn-status ' + s.cls;
}

/* ════════════════════════════════════════════════════════════════════
   WS Event Router
   ════════════════════════════════════════════════════════════════════ */
function handleWsEvent({ event, payload }) {
  switch (event) {
    case 'message:new':       onNewMessage(payload);      break;
    case 'message:delivered': onMessageDelivered(payload); break;
    case 'message:read':      onMessageRead(payload);     break;
    case 'typing:started':    onTypingStarted(payload);   break;
    case 'typing:stopped':    onTypingStopped(payload);   break;
    case 'user:online':       onUserOnline(payload);      break;
    case 'user:offline':      onUserOffline(payload);     break;
  }
}

/* ─── message:new ───────────────────────────────────────────────── */
async function onNewMessage(msg) {
  const isMine = msg.sender?.id === state.me.id;
  const isEncrypted = !!(msg.ciphertext && msg.signalType > 0);

  let chat = state.chats.find(c => c.id === msg.chatId);
  if (!chat) {
    loadChats();
    return;
  }

  let previewText = msg.text || '[медиа]';
  if (isEncrypted) {
    if (isMine && pendingPlaintext[msg.chatId]) {
      previewText = pendingPlaintext[msg.chatId];
      msg._decryptedText = previewText;
      delete pendingPlaintext[msg.chatId];
    } else if (isMine) {
      previewText = msg._decryptedText || '🔒 Зашифрованное сообщение';
    } else if (isE2EAvailable() && msg.sender?.id) {
      const dec = await decryptMessage(msg.sender.id, msg.ciphertext, msg.signalType);
      if (dec) {
        previewText = dec;
        msg._decryptedText = dec;
      } else {
        previewText = '🔒 Зашифрованное сообщение';
      }
    } else {
      previewText = '🔒 Зашифрованное сообщение';
    }
  }

  chat.lastMsg = previewText;
  chat.lastMsgTime = msg.createdAt;
  chat.lastSenderNick = msg.sender?.nickname || '';

  if (!isMine && state.activeChatId !== msg.chatId) {
    state.unread[msg.chatId] = (state.unread[msg.chatId] || 0) + 1;
    playNotificationSound();
  }

  sortChats();
  renderChatList();

  if (state.activeChatId === msg.chatId) {
    await appendMessage(msg);
    scrollToBottom();
    if (!isMine) wsSend('message:read', { messageId: msg.id, chatId: msg.chatId });
  }
}

/* ─── message:delivered — получатель онлайн, сообщение дошло ──── */
function onMessageDelivered({ messageId }) {
  const el = document.querySelector(`[data-msg-id="${messageId}"] .msg-check`);
  if (el && !el.classList.contains('read')) {
    el.classList.add('delivered');
    el.innerHTML = '✓✓';
    el.title = 'Доставлено';
  }
}

/* ─── message:read ──────────────────────────────────────────────── */
function onMessageRead({ messageId }) {
  const el = document.querySelector(`[data-msg-id="${messageId}"] .msg-check`);
  if (el) {
    el.classList.remove('delivered');
    el.classList.add('read');
    el.innerHTML = '✓✓';
    el.title = 'Прочитано';
  }
}

/* ─── typing ────────────────────────────────────────────────────── */
function onTypingStarted({ chatId, userId }) {
  if (userId === state.me.id) return;

  // В sidebar показываем "печатает..." вместо last msg
  const chat = state.chats.find(c => c.id === chatId);
  if (chat) chat._typing = true;
  renderChatList();

  // В окне чата
  if (chatId === state.activeChatId) {
    const bar = document.getElementById('cw-typing');
    const name = chat ? getChatPartnerName(chat) : '...';
    if (bar) bar.innerHTML = `<span class="typing-dots">${escHtml(name)} печатает<span>.</span><span>.</span><span>.</span></span>`;
  }

  // Автоочистка через 5 сек
  clearTimeout(state.typingTimers[chatId]);
  state.typingTimers[chatId] = setTimeout(() => onTypingStopped({ chatId }), 5000);
}

function onTypingStopped({ chatId }) {
  clearTimeout(state.typingTimers[chatId]);

  const chat = state.chats.find(c => c.id === chatId);
  if (chat) { chat._typing = false; renderChatList(); }

  if (chatId === state.activeChatId) {
    const bar = document.getElementById('cw-typing');
    if (bar) bar.innerHTML = '';
  }
}

/* ─── presence ──────────────────────────────────────────────────── */
// userId → ISO дата последнего выхода
const lastOnlineCache = {};

function onUserOnline({ userId }) {
  state.onlineUsers.add(userId);
  refreshPresenceUI(userId);
}

function onUserOffline({ userId, lastOnline }) {
  state.onlineUsers.delete(userId);
  if (lastOnline) lastOnlineCache[userId] = lastOnline;
  refreshPresenceUI(userId);
}

function refreshPresenceUI(userId) {
  renderChatList();

  if (!state.activeChatId) return;
  const chat = state.chats.find(c => c.id === state.activeChatId);
  if (!chat) return;
  const partnerId = getPartnerUserId(chat);
  if (partnerId !== userId) return;

  updateChatHeaderStatus(partnerId);
}

function updateChatHeaderStatus(partnerId) {
  const el = document.getElementById('cw-status');
  if (!el || !partnerId) return;

  if (state.onlineUsers.has(partnerId)) {
    el.textContent = 'онлайн';
    el.className = 'chat-status online';
  } else {
    const lastSeen = lastOnlineCache[partnerId] || getPartnerLastOnline(partnerId);
    el.textContent = lastSeen ? formatLastSeen(lastSeen) : 'офлайн';
    el.className = 'chat-status';
  }
}

function getPartnerLastOnline(partnerId) {
  for (const chat of state.chats) {
    const m = chat.members?.find(m => (m.user?.id || m.userId) === partnerId);
    if (m?.user?.lastOnline) return m.user.lastOnline;
  }
  return null;
}

function formatLastSeen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'был(а) только что';
  if (diffMin < 60) return `был(а) ${diffMin} мин. назад`;

  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `был(а) в ${time}`;
  if (isYesterday) return `был(а) вчера в ${time}`;
  return `был(а) ${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}`;
}

/* ─── Notification sound (generated) ────────────────────────────── */
let audioCtx;
function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1100, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  } catch {}
}

/* ════════════════════════════════════════════════════════════════════
   Auth
   ════════════════════════════════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`${name}-screen`).classList.add('active');
}

async function login(email, password) {
  const res = await api('POST', '/api/auth/login', { email, password });
  await finishAuth(res.data);
}

async function register(nickname, email, password) {
  if (!nickname) throw new Error(tr('FIELD_REQUIRED'));
  if (nickname.length < 3) throw new Error(tr('NICKNAME_TOO_SHORT'));
  if (!/^[a-zA-Z0-9_]+$/.test(nickname)) throw new Error(tr('NICKNAME_INVALID_CHARS'));
  if (password.length < 8) throw new Error(tr('PASSWORD_TOO_SHORT'));
  const res = await api('POST', '/api/auth/register', { nickname, email, password });
  await finishAuth(res.data);
}

async function finishAuth({ user, tokens }) {
  saveTokens(tokens);
  state.me = user;
  localStorage.setItem('me', JSON.stringify(user));
  state.signalStore = null;
  if (isE2EAvailable()) {
    await initSignalKeys();
  }
  await bootApp();
}

function logout() {
  api('POST', '/api/auth/logout', { refreshToken: state.refreshToken }).catch(() => {});
  clearInterval(state.wsHeartbeat);
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }
  localStorage.clear();
  Object.assign(state, {
    accessToken: null, refreshToken: null, me: null,
    chats: [], activeChatId: null, ws: null, onlineUsers: new Set(), unread: {},
  });
  showScreen('auth');
}

/* ════════════════════════════════════════════════════════════════════
   Boot
   ════════════════════════════════════════════════════════════════════ */
async function bootApp() {
  showScreen('app');

  const $nick = document.getElementById('my-nickname');
  const $av   = document.getElementById('my-avatar');
  $nick.textContent = state.me.nickname;
  $av.textContent = state.me.nickname[0].toUpperCase();
  $av.className = `my-avatar av-${charColor(state.me.nickname[0])}`;

  if (isE2EAvailable()) {
    state.signalStore = null;
    await initSignalKeys();
  }

  await loadChats();
  connectWS();
}

/* ════════════════════════════════════════════════════════════════════
   Chats
   ════════════════════════════════════════════════════════════════════ */
async function loadChats() {
  const res = await api('GET', '/api/chats');
  if (!res?.success) return;

  state.chats = res.data.map(chat => {
    const lastMsg = chat.messages?.[0];
    let preview = lastMsg?.text || '';
    if (lastMsg?.ciphertext && lastMsg?.signalType > 0) {
      preview = '🔒 Зашифрованное сообщение';
    }
    return {
      ...chat,
      lastMsg:        preview,
      lastMsgTime:    lastMsg?.createdAt || chat.updatedAt,
      lastSenderNick: lastMsg?.sender?.nickname || '',
      _typing:        false,
    };
  });

  sortChats();
  renderChatList();
}

function sortChats() {
  state.chats.sort((a, b) =>
    new Date(b.lastMsgTime || 0) - new Date(a.lastMsgTime || 0));
}

function renderChatList() {
  const el = document.getElementById('chat-list');
  if (!state.chats.length) {
    el.innerHTML = '<div class="empty-state">Нет чатов — найди собеседника через поиск</div>';
    return;
  }

  el.innerHTML = state.chats.map(chat => {
    const name      = getChatName(chat);
    const initial   = name[0]?.toUpperCase() || '?';
    const colorCls  = `av-${charColor(initial)}`;
    const partnerId = getPartnerUserId(chat);
    const isOnline  = partnerId && state.onlineUsers.has(partnerId);
    const isActive  = chat.id === state.activeChatId ? 'active' : '';
    const unread    = state.unread[chat.id] || 0;

    // Подстрока — typing или lastMsg
    let subtitle;
    if (chat._typing) {
      subtitle = '<span class="typing-label">печатает...</span>';
    } else {
      const prefix = chat.lastSenderNick ? `${chat.lastSenderNick}: ` : '';
      subtitle = escHtml(prefix + (chat.lastMsg || 'Нет сообщений'));
    }

    // Время
    const timeStr = chat.lastMsgTime ? formatTime(chat.lastMsgTime) : '';

    return `
      <div class="chat-item ${isActive}" data-chat-id="${chat.id}" onclick="openChat('${chat.id}')">
        <div class="chat-item-avatar ${colorCls}" data-user-id="${partnerId}">
          ${initial}
          ${isOnline ? '<div class="online-dot"></div>' : ''}
        </div>
        <div class="chat-item-info">
          <div class="chat-item-top">
            <div class="chat-item-name">${escHtml(name)}${(chat.type !== 'GROUP') ? '<span class="e2e-icon">🔒</span>' : ''}</div>
            <div class="chat-item-time">${timeStr}</div>
          </div>
          <div class="chat-item-bottom">
            <div class="chat-item-last">${subtitle}</div>
            ${unread ? `<div class="unread-badge">${unread}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════════
   Open Chat
   ════════════════════════════════════════════════════════════════════ */
async function openChat(chatId) {
  state.activeChatId = chatId;
  state.unread[chatId] = 0;
  renderChatList();

  const chat = state.chats.find(c => c.id === chatId);
  const area = document.getElementById('chat-area');

  const tpl = document.getElementById('chat-window-tpl');
  const clone = tpl.content.cloneNode(true);
  area.innerHTML = '';
  area.appendChild(clone);

  const name      = getChatName(chat);
  const initial   = name[0]?.toUpperCase() || '?';
  const partnerId = getPartnerUserId(chat);

  document.getElementById('cw-name').textContent = name;
  document.getElementById('cw-avatar').textContent = initial;
  document.getElementById('cw-avatar').className = `chat-avatar av-${charColor(initial)}`;

  updateChatHeaderStatus(partnerId);

  // Build E2E session if needed (direct chats only)
  let e2eReady = false;
  if (isE2EAvailable() && partnerId && chat?.type !== 'GROUP') {
    if (await hasSession(partnerId)) {
      e2eReady = true;
    } else {
      e2eReady = await buildSession(partnerId);
    }
  }

  const e2eBadge = document.getElementById('cw-e2e');
  if (e2eBadge) e2eBadge.style.display = e2eReady ? 'inline-flex' : 'none';

  // История
  const res = await api('GET', `/api/chats/${chatId}/messages?limit=50`);
  const msgs = (res?.data || []).reverse();
  const container = document.getElementById('cw-messages');
  container.innerHTML = '';
  for (const m of msgs) {
    await appendMessage(m);
  }
  scrollToBottom();

  // Форма
  const form  = document.getElementById('cw-form');
  const input = document.getElementById('cw-input');
  let typingActive = false, typingTimer = null;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    clearTimeout(typingTimer);
    if (typingActive) { wsSend('typing:stop', { chatId }); typingActive = false; }

    if (e2eReady && partnerId) {
      const enc = await encryptMessage(partnerId, text);
      if (enc) {
        pendingPlaintext[chatId] = text;
        wsSend('message:send', { chatId, ciphertext: enc.ciphertext, signalType: enc.signalType });
        return;
      }
    }
    wsSend('message:send', { chatId, text });
  };

  input.oninput = () => {
    if (!typingActive) { wsSend('typing:start', { chatId }); typingActive = true; }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { wsSend('typing:stop', { chatId }); typingActive = false; }, 2500);
  };

  input.focus();
}

/* ════════════════════════════════════════════════════════════════════
   Message rendering
   ════════════════════════════════════════════════════════════════════ */
async function appendMessage(msg) {
  const container = document.getElementById('cw-messages');
  if (!container) return;

  if (container.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const isMine = msg.sender?.id === state.me.id;
  const isEncrypted = !!(msg.ciphertext && msg.signalType > 0);
  let text;

  if (msg.isDeleted) {
    text = '[удалено]';
  } else if (isEncrypted) {
    if (msg._decryptedText) {
      text = msg._decryptedText;
    } else if (!isMine && isE2EAvailable() && msg.sender?.id) {
      const decrypted = await decryptMessage(msg.sender.id, msg.ciphertext, msg.signalType);
      text = decrypted || '🔒 Не удалось расшифровать';
    } else {
      text = '🔒 Зашифрованное сообщение';
    }
  } else {
    text = msg.text || '[медиа]';
  }

  const time = new Date(msg.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const hasRead = msg.readReceipts?.some(r => r.userId !== state.me.id);

  const group = document.createElement('div');
  group.className = `msg-group ${isMine ? 'mine' : 'theirs'}`;
  group.dataset.msgId = msg.id;

  if (!isMine) {
    const sn = document.createElement('div');
    sn.className = 'msg-sender-name';
    sn.textContent = msg.sender?.nickname || '';
    group.appendChild(sn);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  if (isEncrypted) {
    const lock = document.createElement('span');
    lock.className = 'msg-lock';
    lock.title = 'E2E зашифровано';
    lock.textContent = '🔒';
    meta.appendChild(lock);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = time;
  meta.appendChild(timeEl);

  if (isMine) {
    const check = document.createElement('span');
    if (hasRead) {
      check.className = 'msg-check read';
      check.innerHTML = '✓✓';
      check.title = 'Прочитано';
    } else {
      check.className = 'msg-check sent';
      check.innerHTML = '✓';
      check.title = 'Отправлено';
    }
    meta.appendChild(check);
  }

  group.appendChild(bubble);
  group.appendChild(meta);
  container.appendChild(group);
}

function scrollToBottom() {
  const c = document.getElementById('cw-messages');
  if (c) requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
}

/* ════════════════════════════════════════════════════════════════════
   User search
   ════════════════════════════════════════════════════════════════════ */
let searchTimer = null;

document.getElementById('user-search').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById('search-results');
  if (q.length < 2) { box.classList.add('hidden'); return; }

  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const res = await api('GET', `/api/users/search?q=${encodeURIComponent(q)}`);
    const users = (res?.data || []).filter(u => u.id !== state.me.id);

    if (!users.length) {
      box.innerHTML = '<div class="search-empty">Не найдено</div>';
    } else {
      box.innerHTML = users.map(u => {
        const online = state.onlineUsers.has(u.id);
        return `
          <div class="search-user-item" onclick="startChat('${u.id}')">
            <div class="chat-item-avatar av-${charColor(u.nickname[0])}" style="width:32px;height:32px;font-size:13px">
              ${u.nickname[0].toUpperCase()}
            </div>
            <span style="font-size:14px;flex:1">${escHtml(u.nickname)}</span>
            ${online ? '<span class="online-label">онлайн</span>' : ''}
          </div>`;
      }).join('');
    }
    box.classList.remove('hidden');
  }, 300);
});

document.getElementById('user-search').addEventListener('blur', () => {
  setTimeout(() => document.getElementById('search-results').classList.add('hidden'), 200);
});

async function startChat(userId) {
  document.getElementById('user-search').value = '';
  document.getElementById('search-results').classList.add('hidden');

  const res = await api('POST', '/api/chats/direct', { targetUserId: userId });
  if (!res?.success) return;

  const chat = res.data;
  if (!state.chats.find(c => c.id === chat.id)) {
    state.chats.unshift({ ...chat, lastMsg: '', lastMsgTime: chat.updatedAt, lastSenderNick: '', _typing: false });
  }
  sortChats();
  renderChatList();
  openChat(chat.id);
}

/* ════════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════════ */
function getChatName(chat) {
  if (chat.type === 'GROUP') return chat.name || 'Группа';
  const p = chat.members?.find(m => (m.user?.id || m.userId) !== state.me.id);
  return p?.user?.nickname || p?.nickname || 'Чат';
}

function getChatPartnerName(chat) {
  const m = chat.members?.find(m => (m.user?.id || m.userId) !== state.me.id);
  return m?.user?.nickname || 'пользователь';
}

function getPartnerUserId(chat) {
  if (chat.type === 'GROUP') return null;
  const m = chat.members?.find(m => (m.user?.id || m.userId) !== state.me.id);
  return m?.user?.id || m?.userId || null;
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000)
    return d.toLocaleDateString('ru', { weekday: 'short' });
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function charColor(ch = '') { return (ch.toUpperCase().charCodeAt(0) || 0) % 6; }

/* ════════════════════════════════════════════════════════════════════
   Auth UI
   ════════════════════════════════════════════════════════════════════ */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Входим...';
  try {
    await login(
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-password').value,
    );
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Войти';
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  const btn = document.getElementById('reg-btn');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Создаём...';
  try {
    await register(
      document.getElementById('reg-nickname').value.trim(),
      document.getElementById('reg-email').value.trim(),
      document.getElementById('reg-password').value,
    );
  } catch (err) {
    errEl.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Создать аккаунт';
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);

/* ─── Init ────────────────────────────────────────────────────────── */
(async () => {
  if (state.accessToken && state.me) {
    try { await bootApp(); }
    catch { logout(); }
  } else {
    showScreen('auth');
  }
})();
