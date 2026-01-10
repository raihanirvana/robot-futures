// src/binance/wsMarket.js
import WebSocket from "ws";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const WS_BASE = USE_TESTNET ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";

// watchdog defaults
const STALE_MS = 20_000;       // kalau >20s tidak ada message, anggap stale
const WATCHDOG_MS = 5_000;     // cek setiap 5s

export function connectMarketWSMulti({ symbols, timeframe, onKlineClosed, onMark }) {
  const streams = [];
  for (const sym of symbols) {
    const s = sym.toLowerCase();
    streams.push(`${s}@kline_${timeframe}`);
    streams.push(`${s}@markPrice@1s`);
  }

  const url = `${WS_BASE}/stream?streams=${streams.join("/")}`;

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
        const data = msg.data;
        if (!data) return;

        if (data.e === "kline") {
          const k = data.k;
          if (k && k.x === true) {
            onKlineClosed({
              symbol: data.s,
              close: k.c,
              closeTime: k.T
            });
          }
        } else if (data.e === "markPriceUpdate") {
          onMark({
            symbol: data.s,
            markPrice: data.p,
            eventTime: data.E
          });
        }
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
