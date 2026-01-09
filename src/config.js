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
    // ✅ per-guard toggles
    cooldownEnabled: false,     // cek cooldownUntil + set cooldown onStopLoss
    minGapEnabled: false,       // minMinutesBetweenEntries
    maxTradesEnabled: false,    // maxTradesPerDay
    killSwitchEnabled: false,   // pausedUntil + stopEvents window
    armedEnabled: false,        // armedLong/armedShort anti spam
    debounce: true,            // sudah ada (crossing) vs touch

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
    entryType: "MARKET",
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
