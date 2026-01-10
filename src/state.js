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

    // exchange rules
    rules: null, // { stepSize, minQty, maxQty?, tickSize, minNotional? }

    // indicators
    bb: null,    // { upper, middle, lower, width, longTrigger, shortTrigger, updatedAt }

    // position state
    position: {
      side: "NONE",       // NONE | LONG | SHORT
      qty: 0,
      entryPrice: null,   // avg fill price
      entryMark: null     // mark at submit time (fallback)
    },

    tp1Hit: false,

    // pending order (extended for safety)
    // {
    //   type: "ENTRY"|"EXIT",
    //   clientId, side,
    //   reason?, mode?, qty,
    //   markAtSubmit, since,
    //   targetPx?,
    //   filledCum?: number,          // cumulative filled qty seen so far
    //   cancelRequestedAt?: number   // avoid spamming cancel
    // }
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

    // concurrency
    inFlight: false,
    queuedMark: null,

    // stats
    dayRealizedPnl: 0,
    dayWins: 0,
    dayLosses: 0,
    dayFeesEst: 0
  };
}
