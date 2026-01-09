import { DateTime } from "luxon";

export function dayKeyJakarta(tsMs) {
  return DateTime.fromMillis(tsMs, { zone: "Asia/Jakarta" }).toFormat("yyyy-LL-dd");
}

// Reset harian konsisten (dipanggil dari app.js)
export function ensureDay(state, nowMs) {
  const today = dayKeyJakarta(nowMs);
  if (state.tradesDayKey !== today) {
    state.tradesDayKey = today;
    state.tradesToday = 0;

    state.dayRealizedPnl = 0;
    state.dayWins = 0;
    state.dayLosses = 0;
    state.dayFeesEst = 0;
  }
}

export function createState(symbol) {
  return {
    symbol,

    rules: null, // { stepSize, minQty, tickSize }
    bb: null,    // { upper, middle, lower, width, longTrigger, shortTrigger, updatedAt }

    position: {
      side: "NONE",       // NONE | LONG | SHORT
      qty: 0,
      entryPrice: null,   // avg fill price
      entryMark: null     // mark at submit time (fallback)
    },

    tp1Hit: false,

    // pending order:
    // { type: "ENTRY"|"EXIT", clientId, side, reason?, mode?, qty, markAtSubmit, since }
    pending: null,

    armedLong: false,
    armedShort: false,

    lastEntryAt: 0, // update on ENTRY FILLED
    tradesToday: 0, // update on ENTRY FILLED
    tradesDayKey: dayKeyJakarta(Date.now()),

    prevMark: null,

    cooldownUntil: 0,
    pausedUntil: 0,
    stopEvents: [],

    // ===== Safety / Concurrency =====
    inFlight: false,
    queuedMark: null, // latest mark payload while inFlight

    // ===== Logging stats =====
    dayRealizedPnl: 0,
    dayWins: 0,
    dayLosses: 0,
    dayFeesEst: 0
  };
}
