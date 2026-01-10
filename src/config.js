// src/config.js
export const CFG = {
  symbols: ["SOLUSDT", "DOGEUSDT", "ETHUSDT", "XRPUSDT"],

  timeframe: "5m",
  barMs: 5 * 60 * 1000,

  bb: { period: 20, stdDev: 2 },
  triggerMult: 0.3,

  // TP system
  tp1Pct: 0.01,
  tp2Pct: 0.03,
  tp1CloseFrac: 0.5,

  // SL catastrophic relative to BB width
  slMult: 0.7,

  sizing: {
    marginUSDT: 60,
    leverage: 5,
    get notionalUSDT() { return this.marginUSDT * this.leverage; }
  },

  guards: {
    // toggles
    cooldownEnabled: false,
    minGapEnabled: false,
    maxTradesEnabled: false,
    killSwitchEnabled: false,
    armedEnabled: false,
    debounce: false,

    // defaults aman (tidak undefined)
    cooldownBarsAfterSL: 2,
    minMinutesBetweenEntries: 30,
    maxTradesPerDay: 10,

    killSwitch: {
      maxStops: 2,
      windowMs: 60 * 60 * 1000,
      pauseMs:  60 * 60 * 1000
    }
  },

  exec: {
    // ✅ penting untuk hedge mode
    // AUTO = deteksi via /fapi/v1/positionSide/dual (kalau kamu sudah implement)
    // ONE_WAY / HEDGE = paksa mode kalau belum implement auto-detect
    positionMode: "AUTO", // "AUTO" | "ONE_WAY" | "HEDGE"

    entryType: "LIMIT",         // "MARKET" atau "LIMIT"
    entryTimeInForce: "IOC",    // kalau LIMIT
    entrySlipTicks: 1,          // kalau LIMIT: geser 1 tick untuk improve fill

    exitType: "MARKET",
    recvWindow: 5000,

    pendingTimeoutMs: 30_000,
    hardPendingMs: 180_000
  },

  userStream: {
    keepAliveMs: 25 * 60 * 1000,
    maxKeepAliveFails: 3
  }
};
