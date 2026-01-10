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

  // ✅ SL simple: 1% dari entry
  slPct: 0.01,

  sizing: {
    marginUSDT: 60,
    leverage: 5,
    get notionalUSDT() { return this.marginUSDT * this.leverage; }
  },

  guards: {
    // ✅ anti spam (touch sekali)
    armedEnabled: true,  // setelah entry, bot baru boleh entry lagi kalau balik masuk band dulu
    debounce: true,      // pakai crossing event (prev < trigger lalu >= trigger)

    // (boleh tetap dimatikan)
    cooldownEnabled: false,
    minGapEnabled: false,
    maxTradesEnabled: false,
    killSwitchEnabled: false,

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
    positionMode: "AUTO",

    // ✅ simple & anti IOC spam
    entryType: "MARKET",       // bisa ganti LIMIT kalau mau, tapi MARKET paling “1x dan beres”
    entryTimeInForce: "IOC",
    entrySlipTicks: 1,

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
