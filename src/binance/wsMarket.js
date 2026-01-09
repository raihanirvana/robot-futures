import WebSocket from "ws";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const WS_BASE = USE_TESTNET ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";

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

  function connect() {
    if (!alive || connecting) return;
    connecting = true;

    try { ws?.terminate?.(); } catch {}
    ws = new WebSocket(url);

    ws.on("open", () => {
      connecting = false;
      retry = 0;
    });

    ws.on("message", (buf) => {
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

    // ✅ NEW: reconnect on error too
    ws.on("error", () => {
      connecting = false;
      if (!alive) return;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    retry += 1;
    const base = Math.min(30000, 1000 * (2 ** Math.min(5, retry)));
    const jitter = Math.floor(Math.random() * 1000); // ✅ NEW jitter
    setTimeout(connect, base + jitter);
  }

  connect();

  return () => {
    alive = false;
    try { ws?.close(); } catch {}
    try { ws?.terminate?.(); } catch {}
  };
}
