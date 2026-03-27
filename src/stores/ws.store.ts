import { createSignal } from 'solid-js';
import type { WsEvent, WsSendEvent } from '../types';

type Handler = (event: WsEvent) => void | Promise<void>;

let ws: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let _reconnectEnabled = false;
let _wasConnected = false;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_PENDING_QUEUE = 200;
const QUEUE_STORAGE_KEY = 'h2v_ws_outbox';
const handlers = new Set<Handler>();
const _pendingQueue: WsSendEvent[] = [];
const _onReconnect: Array<() => void> = [];

function persistQueue() {
  try {
    if (_pendingQueue.length > 0) {
      sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(_pendingQueue));
    } else {
      sessionStorage.removeItem(QUEUE_STORAGE_KEY);
    }
  } catch { /* quota or private mode */ }
}

function restoreQueue() {
  try {
    const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return;
    const items = JSON.parse(raw) as WsSendEvent[];
    for (const item of items) {
      if (_pendingQueue.length < MAX_PENDING_QUEUE) _pendingQueue.push(item);
    }
    sessionStorage.removeItem(QUEUE_STORAGE_KEY);
  } catch { /* ignore corrupt data */ }
}

restoreQueue();

const [connected, setConnected] = createSignal(false);
const [connecting, setConnecting] = createSignal(false);

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname;
  const port = window.location.port || (proto === 'wss' ? '443' : '80');
  return `${proto}://${host}:${port}/ws`;
}

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  setConnecting(true);

  try {
    ws = new WebSocket(getWsUrl());
  } catch {
    setConnecting(false);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    // Cookie is sent automatically on upgrade — no need to send auth message.
    // Server will authenticate via the h2v_session cookie and respond with auth:ok.
  };

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WsEvent;

      if (event.event === 'auth:ok') {
        reconnectAttempts = 0;
        setConnecting(false);
        setConnected(true);
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (!isAway && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'presence:ping' }));
          }
        }, 25_000);

        while (_pendingQueue.length > 0) {
          const item = _pendingQueue.shift()!;
          ws!.send(JSON.stringify(item));
        }
        persistQueue();

        if (_wasConnected) {
          _onReconnect.forEach(fn => fn());
        }
        _wasConnected = true;
        return;
      }

      handlers.forEach((h) => h(event));
    } catch { /* ignore malformed frames */ }
  };

  ws.onclose = (e: CloseEvent) => {
    setConnected(false);
    setConnecting(false);
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (e.code === 4001) {
      window.dispatchEvent(new CustomEvent('h2v:auth-expired'));
      return;
    }
    if (e.code === 4003) {
      window.dispatchEvent(new CustomEvent('h2v:session-terminated'));
      window.dispatchEvent(new CustomEvent('h2v:auth-expired'));
      return;
    }
    scheduleReconnect();
  };

  ws.onerror = () => { ws?.close(); };
}

function scheduleReconnect() {
  const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * Math.pow(2, reconnectAttempts));
  const jitter = Math.random() * 1000;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    connect();
  }, base + jitter);
}

function disconnect() {
  reconnectAttempts = 0;
  isAway = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
  setConnecting(false);
}

function send(data: WsSendEvent): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  if (_pendingQueue.length < MAX_PENDING_QUEUE) {
    _pendingQueue.push(data);
    persistQueue();
    return true;
  }
  handlers.forEach((h) => h({
    event: 'error',
    payload: { message: 'queue_overflow' },
  } as WsEvent));
  return false;
}

function subscribe(handler: Handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

// ── Away detection ───────────────────────────────────────────────────────────
let awayTimer: ReturnType<typeof setTimeout> | null = null;
let isAway = false;
const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let _lastActivity = Date.now();

function goAway() {
  if (awayTimer) clearTimeout(awayTimer);
  awayTimer = setTimeout(() => {
    awayTimer = null;
    if (!isAway && ws?.readyState === WebSocket.OPEN) {
      isAway = true;
      ws.send(JSON.stringify({ event: 'presence:away' }));
    }
  }, 1_000);
}

async function comeBack() {
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (isAway && ws?.readyState === WebSocket.OPEN) {
    isAway = false;
    ws.send(JSON.stringify({ event: 'presence:back' }));
  }
  if (!connected() && _reconnectEnabled) {
    connect();
  }
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => goAway(), IDLE_TIMEOUT_MS);
}

function onUserActivity() {
  const now = Date.now();
  if (now - _lastActivity < 1000) return;
  _lastActivity = now;
  if (isAway) comeBack();
  resetIdleTimer();
}

function setReconnectEnabled(enabled: boolean) {
  _reconnectEnabled = enabled;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') goAway();
    else comeBack();
  });

  window.addEventListener('blur', () => goAway());
  window.addEventListener('focus', () => comeBack());

  for (const evt of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const) {
    document.addEventListener(evt, onUserActivity, { passive: true });
  }
  resetIdleTimer();

  window.addEventListener('beforeunload', () => {
    persistQueue();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.onclose = null;
      ws.close(1000, 'page unload');
    }
  });
}

function onReconnect(fn: () => void) {
  _onReconnect.push(fn);
  return () => {
    const idx = _onReconnect.indexOf(fn);
    if (idx >= 0) _onReconnect.splice(idx, 1);
  };
}

export const wsStore = { connected, connecting, connect, disconnect, send, subscribe, setReconnectEnabled, onReconnect, get isAway() { return isAway; } };
