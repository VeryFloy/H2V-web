import { createSignal } from 'solid-js';
import type { WsEvent } from '../types';

type Handler = (event: WsEvent) => void | Promise<void>;

let ws: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY_MS = 30_000;
const handlers = new Set<Handler>();

const [connected, setConnected] = createSignal(false);

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

  try {
    ws = new WebSocket(getWsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    // Send token as first message (handshake) — keeps token out of server logs and browser history
    ws!.send(JSON.stringify({ event: 'auth', payload: { token } }));
    reconnectAttempts = 0;
    setConnected(true);
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'presence:ping' }));
      }
    }, 25_000);
  };

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as WsEvent;
      handlers.forEach((h) => h(event));
    } catch { /* ignore malformed frames */ }
  };

  ws.onclose = (e: CloseEvent) => {
    setConnected(false);
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (e.code === 4001) return;
    scheduleReconnect();
  };

  ws.onerror = () => { ws?.close(); };
}

function scheduleReconnect() {
  const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * Math.pow(2, reconnectAttempts));
  const jitter = Math.random() * 1000;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    const storedToken = localStorage.getItem('accessToken');
    if (storedToken) connect(storedToken);
  }, base + jitter);
}

function disconnect() {
  reconnectAttempts = 0;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  setConnected(false);
}

function send(data: object): boolean {
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
// Two event sources:
//   • visibilitychange — fires when switching TABS within the same browser window
//   • blur / focus     — fires when switching between browser WINDOWS or apps
// Both start a 10-second timer. If the user doesn't come back, the WS is
// closed and the backend marks them offline.

let awayTimer: ReturnType<typeof setTimeout> | null = null;
let wasAwayDisconnect = false;

function goAway() {
  if (awayTimer) clearTimeout(awayTimer);
  awayTimer = setTimeout(() => {
    awayTimer = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      wasAwayDisconnect = true;
      ws.onclose = null;
      ws.close(1000, 'away');
      ws = null;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      setConnected(false);
    }
  }, 10_000);
}

function comeBack() {
  if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
  if (wasAwayDisconnect || !connected()) {
    wasAwayDisconnect = false;
    const token = localStorage.getItem('accessToken');
    if (token) connect(token);
  }
}

if (typeof document !== 'undefined') {
  const isIosStandalone =
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    (('standalone' in navigator && (navigator as any).standalone) ||
      window.matchMedia('(display-mode: standalone)').matches);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') goAway();
    else comeBack();
  });

  if (!isIosStandalone) {
    window.addEventListener('blur', goAway);
    window.addEventListener('focus', comeBack);
  }

  window.addEventListener('beforeunload', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.onclose = null;
      ws.close(1000, 'page unload');
    }
  });
}

export const wsStore = { connected, connect, disconnect, send, subscribe };
