// src/state.js
import { DateTime } from "luxon";

export function dayKeyJakarta(tsMs) {
  return DateTime.fromMillis(tsMs, { zone: "Asia/Jakarta" }).toFormat("yyyy-LL-dd");
}

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

    rules: null, // { stepSize, minQty, tickSize, minNotional? }
    bb: null,

    position: {
      side: "NONE",
      qty: 0,
      entryPrice: null,
      entryMark: null
    },

    tp1Hit: false,

    pending: null,

    armedLong: false,
    armedShort: false,

    lastEntryAt: 0,
    tradesToday: 0,
    tradesDayKey: dayKeyJakarta(Date.now()),

    prevMark: null,

    cooldownUntil: 0,
    pausedUntil: 0,
    stopEvents: [],

    inFlight: false,
    queuedMark: null,

    dayRealizedPnl: 0,
    dayWins: 0,
    dayLosses: 0,
    dayFeesEst: 0
  };
}
