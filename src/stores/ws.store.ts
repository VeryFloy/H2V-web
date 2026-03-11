import { createSignal } from 'solid-js';
import type { WsEvent, WsSendEvent } from '../types';
import { refreshTokens } from '../api/client';

type Handler = (event: WsEvent) => void | Promise<void>;

let ws: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 30_000;
const PROACTIVE_REFRESH_MS = 12 * 60 * 1000; // refresh token every 12 minutes (expires in 15)
const handlers = new Set<Handler>();

const [connected, setConnected] = createSignal(false);
const [connecting, setConnecting] = createSignal(false);

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname;
  const port = import.meta.env.DEV ? '3000' : (window.location.port || (proto === 'wss' ? '443' : '80'));
  return `${proto}://${host}:${port}/ws`;
}

function connect(token: string) {
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
    // Send token as first message (handshake) — keeps token out of server logs and browser history.
    // Do NOT set connected=true here: the server may still reject the token with code 4001.
    // connected is set only after we receive the 'auth:ok' confirmation below.
    ws!.send(JSON.stringify({ event: 'auth', payload: { token } }));
  };

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WsEvent;

      // Intercept auth:ok before forwarding to subscribers: only now is the
      // connection truly established from the application's perspective.
      if (event.event === 'auth:ok') {
        reconnectAttempts = 0;
        setConnecting(false);
        setConnected(true);
        // Presence ping — only when NOT away (no point pinging if user is away)
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (!isAway && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'presence:ping' }));
          }
        }, 25_000);
        // Proactive token refresh — keeps access token fresh so the user
        // never gets kicked out after 15 min of inactivity.
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => {
          refreshTokens().catch(() => {});
        }, PROACTIVE_REFRESH_MS);
        return;
      }

      handlers.forEach((h) => h(event));
    } catch { /* ignore malformed frames */ }
  };

  ws.onclose = (e: CloseEvent) => {
    setConnected(false);
    setConnecting(false);
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (e.code === 4001) {
      // Token was rejected — force logout so the user is not stuck logged-in but disconnected.
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
  reconnectTimer = setTimeout(async () => {
    const storedToken = localStorage.getItem('accessToken');
    if (!storedToken) return;

    // Refresh the access token before reconnecting: if it expired during a
    // network hiccup the server would reject with code 4001 and force a logout
    // even though the refresh token is still valid.
    const refreshed = await refreshTokens().catch(() => false);
    const token = refreshed ? (localStorage.getItem('accessToken') ?? storedToken) : storedToken;
    connect(token);
  }, base + jitter);
}

function disconnect() {
  reconnectAttempts = 0;
  isAway = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
  setConnecting(false);
}

function send(data: WsSendEvent): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function subscribe(handler: Handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

// ── Away detection ───────────────────────────────────────────────────────────
// When the tab goes hidden we tell the server (presence:away) so partners see
// the user as offline, but the WebSocket stays alive — messages keep arriving
// and trigger client-side Notification API.  Only visibilitychange is used;
// blur/focus is too aggressive (devtools, overlapping windows, etc.).

let awayTimer: ReturnType<typeof setTimeout> | null = null;
let isAway = false;

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
  if (!connected()) {
    // Refresh the access token first — it may have expired while the tab was hidden.
    // Without this, connect() sends an expired token → server returns 4001 → logout.
    await refreshTokens().catch(() => {});
    const token = localStorage.getItem('accessToken');
    if (token) connect(token);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') goAway();
    else comeBack();
  });

  window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.onclose = null;
      ws.close(1000, 'page unload');
    }
  });
}

export const wsStore = { connected, connecting, connect, disconnect, send, subscribe };
