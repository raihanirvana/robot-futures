import WebSocket from "ws";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const WS_BASE = USE_TESTNET ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";

export function connectUserWS({ listenKey, onOrderTradeUpdate }) {
  const url = `${WS_BASE}/ws/${listenKey}`;

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
    retry += 1;
    const base = Math.min(30000, 1000 * (2 ** Math.min(5, retry)));
    const jitter = Math.floor(Math.random() * 1000); // ✅ NEW
    setTimeout(connect, base + jitter);
  }

  connect();

  return () => {
    alive = false;
    try { ws?.close(); } catch {}
    try { ws?.terminate?.(); } catch {}
  };
}
