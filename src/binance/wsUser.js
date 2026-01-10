// src/binance/wsUser.js
import WebSocket from "ws";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const WS_BASE = USE_TESTNET ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";

// watchdog defaults
const STALE_MS = 30_000;
const WATCHDOG_MS = 5_000;

export function connectUserWS({ listenKey, onOrderTradeUpdate }) {
  const url = `${WS_BASE}/ws/${listenKey}`;

  let ws = null;
  let alive = true;
  let retry = 0;
  let connecting = false;

  let reconnectTimer = null;
  let watchdogTimer = null;
  let lastMsgAt = Date.now();

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearWatchdog() {
    if (watchdogTimer) clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  function armWatchdog() {
    clearWatchdog();
    watchdogTimer = setInterval(() => {
      if (!alive) return;
      const age = Date.now() - lastMsgAt;
      if (age > STALE_MS) {
        try { ws?.terminate?.(); } catch {}
        scheduleReconnect();
      }
    }, WATCHDOG_MS);
  }

  function connect() {
    if (!alive || connecting) return;
    connecting = true;

    clearReconnectTimer();

    try { ws?.terminate?.(); } catch {}
    ws = new WebSocket(url);

    ws.on("open", () => {
      connecting = false;
      retry = 0;
      lastMsgAt = Date.now();
      armWatchdog();
    });

    ws.on("message", (buf) => {
      lastMsgAt = Date.now();

      try {
        const msg = JSON.parse(buf.toString());
        if (msg.e === "ORDER_TRADE_UPDATE") onOrderTradeUpdate(msg);
      } catch {}
    });

    ws.on("close", () => {
      connecting = false;
      if (!alive) return;
      scheduleReconnect();
    });

    ws.on("error", () => {
      connecting = false;
      if (!alive) return;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
  if (!alive) return;

  // ✅ kalau sudah ada timer, jangan schedule lagi (hindari retry double)
  if (reconnectTimer) return;

  retry += 1;
  const base = Math.min(30_000, 1000 * (2 ** Math.min(5, retry)));
  const jitter = Math.floor(Math.random() * 1000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null; // ✅ reset sebelum connect
    connect();
  }, base + jitter);
}

  connect();

  return () => {
    alive = false;
    clearReconnectTimer();
    clearWatchdog();
    try { ws?.close(); } catch {}
    try { ws?.terminate?.(); } catch {}
  };
}
