// src/app.js
import "dotenv/config";
import { CFG } from "./config.js";
import { createState, ensureDay, dayKeyJakarta } from "./state.js";

import { createCloseSeries } from "./domain/series.js";
import { bollinger } from "./domain/indicators.js";
import { calcQtyFromNotional, roundDownToStep, formatQtyByStep } from "./domain/sizing.js";
import { canEnterNow, onStopLoss } from "./domain/guards.js";
import {
  updateTriggers,
  resetArmedOnReenterBand,
  crossedLongTrigger,
  crossedShortTrigger
} from "./domain/strategy.js";

import { BinanceRest } from "./binance/rest.js";
import { connectMarketWSMulti } from "./binance/wsMarket.js";
import { connectUserWS } from "./binance/wsUser.js";

import { createPerfLogger } from "./logger.js";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function fmt(n, d = 8) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "NaN";
  return x.toFixed(d);
}

const perf = createPerfLogger({ log });

function newCid(prefix, symbol, nowMs) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${symbol}_${nowMs}_${rand}`;
}

// ===== Tick helpers =====
function decimalsFromTick(tickSize) {
  const s = String(tickSize).trim().toLowerCase();
  if (s.includes("e-")) {
    const m = s.match(/e-(\d+)/);
    if (m) return Number(m[1]) || 0;
  }
  if (!s.includes(".")) return 0;
  return s.split(".")[1].length;
}

function formatPriceByTick(price, tickSize, side) {
  const px = Number(price);
  const tick = Number(tickSize);

  if (!Number.isFinite(px) || px <= 0) return null;
  if (!Number.isFinite(tick) || tick <= 0) return String(px);

  const steps = px / tick;
  const roundedSteps =
    side === "LONG"
      ? Math.floor(steps + 1e-12)
      : Math.ceil(steps - 1e-12);

  const outPx = roundedSteps * tick;
  const d = decimalsFromTick(tickSize);

  let out = outPx.toFixed(Math.min(d, 12));
  if (out.includes(".")) out = out.replace(/\.?0+$/, "");
  return out;
}

// ✅ apply entrySlipTicks
function computeEntryLimitPrice(st, side) {
  if (!st.bb) return null;
  const trigger = side === "LONG" ? st.bb.longTrigger : st.bb.shortTrigger;

  const slipTicks = Number(CFG.exec.entrySlipTicks ?? 0);
  const tick = Number(st.rules?.tickSize ?? 0);

  if (!Number.isFinite(trigger)) return null;
  if (!Number.isFinite(slipTicks) || slipTicks === 0) return trigger;
  if (!Number.isFinite(tick) || tick <= 0) return trigger;

  // LONG: BUY LIMIT -> a bit higher improves fill; SHORT: SELL LIMIT -> a bit lower improves fill
  const adj = slipTicks * tick;
  return side === "LONG" ? (trigger + adj) : (trigger - adj);
}

// ===== Hedge mode helper =====
function maybeAddPositionSide(order, sideForHedge) {
  if ((CFG.exec.positionMode || "ONE_WAY") !== "HEDGE") return order;

  // In hedge mode, Binance expects positionSide LONG/SHORT
  const ps = sideForHedge === "LONG" ? "LONG" : "SHORT";
  return { ...order, positionSide: ps };
}

// ===== Per-symbol containers =====
const SYMS = CFG.symbols;
const symState = new Map();
const symCloses = new Map();

for (const s of SYMS) {
  symState.set(s, createState(s));
  symCloses.set(s, createCloseSeries(500));
}

let listenKey = null;
let stopUserWS = null;
let stopMarketWS = null;
let keepAliveTimer = null;
let dayTimer = null;

async function cancelAllOpenOrdersForSymbol(symbol) {
  try {
    const orders = await BinanceRest.openOrders(symbol, CFG.exec.recvWindow);
    if (!Array.isArray(orders) || orders.length === 0) return;

    log("[BOOT] openOrders found:", symbol, "count=", orders.length);

    for (const o of orders) {
      try {
        if (o.orderId) {
          await BinanceRest.cancelOrder({ symbol, orderId: o.orderId, recvWindow: CFG.exec.recvWindow });
        } else if (o.clientOrderId) {
          await BinanceRest.cancelOrder({ symbol, origClientOrderId: o.clientOrderId, recvWindow: CFG.exec.recvWindow });
        }
      } catch (e) {
        log("[BOOT] cancel openOrder FAIL", symbol, o.orderId || o.clientOrderId, e?.response?.data?.msg || e.message);
      }
    }

    log("[BOOT] openOrders cancel attempted:", symbol);
  } catch (e) {
    log("[BOOT] openOrders fetch FAIL", symbol, e?.response?.data?.msg || e.message);
  }
}

async function initSymbol(symbol) {
  const st = symState.get(symbol);

  st.rules = await BinanceRest.exchangeInfo(symbol);
  log("[BOOT]", symbol, "rules:", st.rules);

  try {
    await BinanceRest.setMarginTypeIsolated(symbol);
    log("[BOOT]", symbol, "margin ISOLATED");
  } catch (e) {
    log("[BOOT]", symbol, "margin type (ignore):", e?.response?.data?.msg || e.message);
  }

  await BinanceRest.setLeverage(symbol, CFG.sizing.leverage);
  log("[BOOT]", symbol, "leverage:", CFG.sizing.leverage);

  await cancelAllOpenOrdersForSymbol(symbol);
}

async function startUserStream() {
  const r = await BinanceRest.startListenKey();
  listenKey = r.listenKey;
  log("[BOOT] listenKey acquired");

  if (stopUserWS) stopUserWS();
  stopUserWS = connectUserWS({ listenKey, onOrderTradeUpdate: handleOrderTradeUpdate });

  if (keepAliveTimer) clearInterval(keepAliveTimer);

  let fails = 0;
  keepAliveTimer = setInterval(async () => {
    try {
      await BinanceRest.keepAliveListenKey(listenKey);
      fails = 0;
      log("[USER] listenKey keepalive OK");
    } catch (e) {
      fails++;
      log("[USER] listenKey keepalive FAIL:", e?.response?.data || e.message);
      if (fails >= CFG.userStream.maxKeepAliveFails) {
        log("[USER] keepalive failed", fails, "times -> exit for restart");
        process.exit(1);
      }
    }
  }, CFG.userStream.keepAliveMs);
}

async function safeInit() {
  log("[BOOT] Base:", BinanceRest.baseUrl());
  log("[BOOT] Symbols:", SYMS.join(", "));
  log(
    "[BOOT] TF:",
    CFG.timeframe,
    "BB:",
    CFG.bb.period,
    CFG.bb.stdDev,
    "triggerMult:",
    CFG.triggerMult,
    "slMult:",
    CFG.slMult,
    "entryType:",
    CFG.exec.entryType
  );

  for (const s of SYMS) await initSymbol(s);
  await startUserStream();

  if (stopMarketWS) stopMarketWS();
  stopMarketWS = connectMarketWSMulti({
    symbols: SYMS,
    timeframe: CFG.timeframe,
    onKlineClosed: handleKlineClosed,
    onMark: handleMark
  });

  log("[BOOT] Market WS started", CFG.timeframe);

  if (dayTimer) clearInterval(dayTimer);
  dayTimer = setInterval(() => {
    const now = Date.now();
    const day = dayKeyJakarta(now);
    for (const s of SYMS) {
      const st = symState.get(s);
      if (!st) continue;
      if (st.tradesDayKey !== day) continue;
      log("[DAY]", s, "dayPnL=", st.dayRealizedPnl.toFixed(4), "W/L=", `${st.dayWins}/${st.dayLosses}`, "trades=", st.tradesToday);
    }
  }, 5 * 60 * 1000);
}

function handleKlineClosed({ symbol, close, closeTime }) {
  const st = symState.get(symbol);
  const cs = symCloses.get(symbol);
  if (!st || !cs) return;

  cs.pushClosed(close);
  const lastN = cs.lastN(CFG.bb.period);
  if (!lastN) return;

  st.bb = bollinger(lastN, CFG.bb.period, CFG.bb.stdDev);
  st.bb.updatedAt = closeTime;
  updateTriggers(st, CFG.triggerMult);
}

function slPriceBBRelative(st, side) {
  if (!st.bb) return null;
  const { lower, upper, width } = st.bb;
  if (![lower, upper, width].every(Number.isFinite)) return null;
  if (side === "LONG") return lower - CFG.slMult * width;
  if (side === "SHORT") return upper + CFG.slMult * width;
  return null;
}

function tp1Price(entry, side) {
  const e = Number(entry);
  if (!Number.isFinite(e) || e <= 0) return null;
  return side === "LONG" ? e * (1 + CFG.tp1Pct) : e * (1 - CFG.tp1Pct);
}
function tp2Price(entry, side) {
  const e = Number(entry);
  if (!Number.isFinite(e) || e <= 0) return null;
  return side === "LONG" ? e * (1 + CFG.tp2Pct) : e * (1 - CFG.tp2Pct);
}
function hitBEP(mark, entry, side) {
  if (side === "LONG") return mark <= entry;
  if (side === "SHORT") return mark >= entry;
  return false;
}

function computePartialQty(st, fullQty) {
  const q = Number(fullQty);
  if (!Number.isFinite(q) || q <= 0) return 0;

  const raw = q * CFG.tp1CloseFrac;
  const rounded = roundDownToStep(raw, st.rules?.stepSize);

  const minQty = Number(st.rules?.minQty ?? 0);
  if (!Number.isFinite(rounded) || rounded <= 0) return 0;
  if (rounded < minQty) return 0;

  if (rounded >= q) return q;
  return rounded;
}

async function syncPositionFromExchange(st) {
  try {
    const arr = await BinanceRest.positionRisk(st.symbol, CFG.exec.recvWindow);
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) return;

    const amt = Number(p.positionAmt || 0);
    const entry = Number(p.entryPrice || 0);

    if (!Number.isFinite(amt) || amt === 0) {
      st.position = { side: "NONE", qty: 0, entryPrice: null, entryMark: null };
      st.tp1Hit = false;
      return;
    }

    if (!st.position) st.position = { side: "NONE", qty: 0, entryPrice: null, entryMark: null };

    st.position.side = amt > 0 ? "LONG" : "SHORT";
    st.position.qty = Math.abs(amt);
    st.position.entryPrice = Number.isFinite(entry) && entry > 0 ? entry : st.position.entryPrice;
  } catch (e) {
    log("[SYNC] positionRisk FAIL", st.symbol, e?.response?.data || e.message);
  }
}

async function hardReleaseStuckPending(st, nowMs) {
  if (!st.pending) return false;
  const age = nowMs - (st.pending.since || nowMs);
  if (age < CFG.exec.hardPendingMs) return false;

  const { clientId, type } = st.pending;
  log("[PENDING] HARD CHECK", st.symbol, type, clientId, "ageMs=", age);

  try {
    const o = await BinanceRest.getOrderByClientId(st.symbol, clientId, CFG.exec.recvWindow);
    const status = o?.status;
    if (status) log("[PENDING] order status", st.symbol, clientId, status);

    const terminal = (status === "FILLED" || status === "CANCELED" || status === "REJECTED" || status === "EXPIRED");

    if (terminal) {
      await syncPositionFromExchange(st);
      st.pending = null;
      await cancelAllOpenOrdersForSymbol(st.symbol);
      log("[PENDING] HARD RELEASE terminal -> pending cleared", st.symbol, clientId);
      return true;
    }

    try {
      await BinanceRest.cancelOrder({ symbol: st.symbol, origClientOrderId: clientId, recvWindow: CFG.exec.recvWindow });
      log("[PENDING] HARD cancel attempted", st.symbol, clientId);
    } catch (e2) {
      log("[PENDING] HARD cancel FAIL", st.symbol, clientId, e2?.response?.data?.msg || e2.message);
    }

    await syncPositionFromExchange(st);
    st.pending = null;
    await cancelAllOpenOrdersForSymbol(st.symbol);

    st.pausedUntil = Math.max(st.pausedUntil || 0, nowMs + 30_000);
    log("[PENDING] HARD RELEASE open->cleared+sync+pause30s", st.symbol, clientId);
    return true;

  } catch (e) {
    log("[PENDING] HARD getOrder FAIL", st.symbol, clientId, e?.response?.data?.msg || e.message);
    await syncPositionFromExchange(st);
    st.pending = null;
    await cancelAllOpenOrdersForSymbol(st.symbol);

    st.pausedUntil = Math.max(st.pausedUntil || 0, nowMs + 30_000);
    log("[PENDING] HARD RELEASE fallback cleared+sync+pause30s", st.symbol, clientId);
    return true;
  }
}

async function maybeCancelStuckPending(st, nowMs) {
  if (!st.pending) return;
  const age = nowMs - (st.pending.since || nowMs);
  if (age < CFG.exec.pendingTimeoutMs) return;

  if (st.pending.cancelRequestedAt) return; // ✅ cancel once
  st.pending.cancelRequestedAt = nowMs;

  const { clientId, type } = st.pending;
  log("[PENDING] Timeout -> cancel", st.symbol, type, clientId, "ageMs=", age);

  try {
    await BinanceRest.cancelOrder({ symbol: st.symbol, origClientOrderId: clientId, recvWindow: CFG.exec.recvWindow });
    log("[PENDING] Cancel OK", st.symbol, clientId);
  } catch (e) {
    log("[PENDING] Cancel FAIL", st.symbol, clientId, e?.response?.data?.msg || e.message);
  }
}

async function enterPosition(st, side, mark, nowMs) {
  const armedEnabled = (CFG.guards?.armedEnabled !== false);

  if (armedEnabled) {
    if (side === "LONG") st.armedLong = true;
    if (side === "SHORT") st.armedShort = true;
  }

  const qty = calcQtyFromNotional(CFG.sizing.notionalUSDT, mark, st.rules);
  if (qty <= 0) {
    log("[ENTER] Qty too small; skip.", st.symbol, side);
    if (armedEnabled) {
      if (side === "LONG") st.armedLong = false;
      if (side === "SHORT") st.armedShort = false;
    }
    return;
  }

  const qtyStr = formatQtyByStep(qty, st.rules?.stepSize);
  const clientId = newCid("E", st.symbol, nowMs);

  st.pending = { type: "ENTRY", clientId, side, qty, markAtSubmit: mark, since: nowMs, filledCum: 0 };

  try {
    let baseOrder = {
      symbol: st.symbol,
      side: side === "LONG" ? "BUY" : "SELL",
      type: CFG.exec.entryType,
      quantity: qtyStr,
      newClientOrderId: clientId,
      recvWindow: CFG.exec.recvWindow
    };

    baseOrder = maybeAddPositionSide(baseOrder, side);

    if (CFG.exec.entryType === "LIMIT") {
      const triggerPx = computeEntryLimitPrice(st, side);
      if (triggerPx == null) throw new Error("No triggerPx");

      const pxStr = formatPriceByTick(triggerPx, st.rules?.tickSize, side);
      if (!pxStr) throw new Error("Bad limit price");

      baseOrder.price = pxStr;
      baseOrder.timeInForce = CFG.exec.entryTimeInForce || "IOC";

      log("[ENTER]", st.symbol, side, "LIMIT", "mark=", fmt(mark), "trigger=", fmt(triggerPx), "price=", pxStr, "qty=", qtyStr, "cid=", clientId);
    } else {
      log("[ENTER]", st.symbol, side, "MARKET", "mark=", fmt(mark), "qty=", qtyStr, "cid=", clientId);
    }

    await BinanceRest.placeOrder(baseOrder);

  } catch (e) {
    log("[ENTER] Order failed:", st.symbol, e?.response?.data || e.message);

    if (armedEnabled) {
      if (side === "LONG") st.armedLong = false;
      if (side === "SHORT") st.armedShort = false;
    }

    st.pending = null;
  }
}

async function exitPosition(st, reason, mark, nowMs, mode = "FULL", targetPx = null) {
  const side = st.position.side;
  const fullQty = Number(st.position.qty);
  if (side === "NONE" || !Number.isFinite(fullQty) || fullQty <= 0) return;

  let qty = fullQty;
  if (mode === "PARTIAL") {
    const p = computePartialQty(st, fullQty);
    if (p > 0) qty = p;
    else mode = "FULL";
  }

  const qtyStr = formatQtyByStep(qty, st.rules?.stepSize);
  const clientId = newCid("X", st.symbol, nowMs);

  st.pending = {
    type: "EXIT",
    clientId,
    side,
    reason,
    mode,
    qty,
    markAtSubmit: mark,
    since: nowMs,
    targetPx,
    filledCum: 0
  };

  log("[EXIT]", st.symbol, reason, mode, side, "mark=", fmt(mark), "qty=", fmt(qty, 8), "fullQty=", fmt(fullQty, 8), "target=", targetPx != null ? fmt(targetPx) : "na", "cid=", clientId);

  try {
    let order = {
      symbol: st.symbol,
      side: side === "LONG" ? "SELL" : "BUY",
      type: CFG.exec.exitType,
      quantity: qtyStr,
      reduceOnly: true,
      newClientOrderId: clientId,
      recvWindow: CFG.exec.recvWindow
    };

    order = maybeAddPositionSide(order, side);

    await BinanceRest.placeOrder(order);
  } catch (e) {
    log("[EXIT] Order failed:", st.symbol, e?.response?.data || e.message);
    st.pending = null;
  }
}

// latest mark overwrite
function handleMark(payload) {
  const st = symState.get(payload.symbol);
  if (!st) return;

  st.queuedMark = payload;
  if (st.inFlight) return;

  drainMarkQueue(st).catch(() => {});
}

async function drainMarkQueue(st) {
  if (st.inFlight) return;
  st.inFlight = true;

  try {
    while (st.queuedMark) {
      const payload = st.queuedMark;
      st.queuedMark = null;
      await processMark(st, payload);
    }
  } finally {
    st.inFlight = false;
  }
}

async function processMark(st, { markPrice }) {
  const nowWall = Date.now();
  ensureDay(st, nowWall);
  perf.ensureDay(st.symbol, nowWall);

  const mark = Number(markPrice);
  if (!Number.isFinite(mark) || mark <= 0) {
    st.prevMark = null;
    return;
  }

  if (!st.bb || !st.rules) {
    st.prevMark = mark;
    return;
  }

  // pending: allow catastrophic SL even while pending EXIT/ENTRY
  if (st.pending) {
    const side = st.position.side;
    const hasPos = (side !== "NONE" && Number(st.position.qty) > 0);

    if (hasPos) {
      const entry = st.position.entryPrice ?? st.position.entryMark ?? mark;
      const slBB = slPriceBBRelative(st, side);

      if (slBB != null) {
        const slHit =
          (side === "LONG" && mark <= slBB) ||
          (side === "SHORT" && mark >= slBB);

        if (slHit) {
          try {
            if (st.pending?.clientId) {
              await BinanceRest.cancelOrder({ symbol: st.symbol, origClientOrderId: st.pending.clientId, recvWindow: CFG.exec.recvWindow });
              log("[PENDING] cancel before SL attempt", st.symbol, st.pending.clientId);
            }
          } catch (e) {
            log("[PENDING] cancel before SL FAIL", st.symbol, st.pending?.clientId, e?.response?.data?.msg || e.message);
          }

          st.pending = null;
          await cancelAllOpenOrdersForSymbol(st.symbol);

          await exitPosition(st, "SL_BB", mark, nowWall, "FULL", slBB);
          st.prevMark = mark;
          return;
        }
      }
    }

    await hardReleaseStuckPending(st, nowWall);
    if (st.pending) await maybeCancelStuckPending(st, nowWall);

    st.prevMark = mark;
    return;
  }

  const armedEnabled = (CFG.guards?.armedEnabled !== false);
  resetArmedOnReenterBand(st, mark, armedEnabled);

  // EXIT management
  if (st.position.side !== "NONE") {
    const side = st.position.side;
    const entry = st.position.entryPrice ?? st.position.entryMark ?? mark;

    const slBB = slPriceBBRelative(st, side);
    const t1 = tp1Price(entry, side);
    const t2 = tp2Price(entry, side);

    if (slBB != null) {
      if (side === "LONG" && mark <= slBB) { await exitPosition(st, "SL_BB", mark, nowWall, "FULL", slBB); st.prevMark = mark; return; }
      if (side === "SHORT" && mark >= slBB) { await exitPosition(st, "SL_BB", mark, nowWall, "FULL", slBB); st.prevMark = mark; return; }
    }

    if (!st.tp1Hit && t1 != null) {
      if (side === "LONG" && mark >= t1) { await exitPosition(st, "TP1", mark, nowWall, "PARTIAL", t1); st.prevMark = mark; return; }
      if (side === "SHORT" && mark <= t1) { await exitPosition(st, "TP1", mark, nowWall, "PARTIAL", t1); st.prevMark = mark; return; }
    }

    if (st.tp1Hit && hitBEP(mark, entry, side)) {
      await exitPosition(st, "BEP", mark, nowWall, "FULL", entry);
      st.prevMark = mark;
      return;
    }

    if (t2 != null) {
      if (side === "LONG" && mark >= t2) { await exitPosition(st, "TP2", mark, nowWall, "FULL", t2); st.prevMark = mark; return; }
      if (side === "SHORT" && mark <= t2) { await exitPosition(st, "TP2", mark, nowWall, "FULL", t2); st.prevMark = mark; return; }
    }

    st.prevMark = mark;
    return;
  }

  // ENTRY
  if (!canEnterNow(st, CFG, nowWall)) {
    st.prevMark = mark;
    return;
  }

  const longSignal = CFG.guards.debounce ? crossedLongTrigger(st, mark) : (mark <= st.bb.longTrigger);
  const shortSignal = CFG.guards.debounce ? crossedShortTrigger(st, mark) : (mark >= st.bb.shortTrigger);

  const allowLong = armedEnabled ? (!st.armedLong) : true;
  const allowShort = armedEnabled ? (!st.armedShort) : true;

  if (allowLong && longSignal) { await enterPosition(st, "LONG", mark, nowWall); st.prevMark = mark; return; }
  if (allowShort && shortSignal) { await enterPosition(st, "SHORT", mark, nowWall); st.prevMark = mark; return; }

  st.prevMark = mark;
}

// ✅ EXIT partial fill safe using cum delta
function handleOrderTradeUpdate(msg) {
  try {
    const o = msg.o;
    if (!o) return;

    const symbol = o.s;
    const st = symState.get(symbol);
    if (!st) return;

    const nowWall = Date.now();
    ensureDay(st, nowWall);
    perf.ensureDay(symbol, nowWall);

    const status = o.X;          // NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED
    const side = o.S;            // BUY / SELL
    const avgPrice = Number(o.ap || 0);
    const cumFilledQty = Number(o.z || 0);
    const lastFillPrice = Number(o.L || 0);
    const clientId = o.c;

    const terminal = (status === "FILLED" || status === "CANCELED" || status === "REJECTED" || status === "EXPIRED");

    if (!st.pending || st.pending.clientId !== clientId) {
      if ((status === "FILLED" || status === "PARTIALLY_FILLED") && cumFilledQty > 0) {
        if (st.position.side === "LONG" && side === "BUY") st.position.entryPrice = avgPrice || st.position.entryPrice;
        if (st.position.side === "SHORT" && side === "SELL") st.position.entryPrice = avgPrice || st.position.entryPrice;
      }
      return;
    }

    // ENTRY pending
    if (st.pending.type === "ENTRY") {
      if (status === "PARTIALLY_FILLED" && cumFilledQty > 0) {
        const newSide = (side === "BUY") ? "LONG" : "SHORT";
        st.position.side = newSide;
        st.position.qty = cumFilledQty;
        st.position.entryPrice = avgPrice || st.position.entryPrice;
        st.position.entryMark = st.pending.markAtSubmit ?? null;
        return;
      }

      if (status === "FILLED" && cumFilledQty > 0) {
        const newSide = (side === "BUY") ? "LONG" : "SHORT";
        st.position.side = newSide;
        st.position.qty = cumFilledQty;
        st.position.entryPrice = avgPrice || null;
        st.position.entryMark = st.pending.markAtSubmit ?? null;

        st.tp1Hit = false;
        st.tradesToday += 1;
        st.lastEntryAt = nowWall;

        const entryRef = Number(st.position.entryPrice ?? st.position.entryMark ?? 0);

        const tp1 = tp1Price(entryRef, st.position.side);
        const tp2 = tp2Price(entryRef, st.position.side);
        const sl = slPriceBBRelative(st, st.position.side);

        perf.recordEntry({
          symbol,
          side: st.position.side,
          entryPrice: entryRef,
          qty: cumFilledQty,
          nowMs: nowWall,
          clientId,
          tp1,
          tp2,
          sl
        });

        log("[USER] ENTRY FILLED", symbol, "cid=", clientId, "side=", st.position.side, "entry=", fmt(entryRef), "qty=", fmt(cumFilledQty, 8));

        st.pending = null;
        return;
      }

      if (terminal && status !== "FILLED") {
        log("[USER] ENTRY terminal(not filled)", symbol, clientId, "status=", status);

        const armedEnabled = (CFG.guards?.armedEnabled !== false);
        if (armedEnabled) {
          if (st.pending.side === "LONG") st.armedLong = false;
          if (st.pending.side === "SHORT") st.armedShort = false;
        }

        st.pending = null;
        return;
      }
      return;
    }

    // EXIT pending
    if (st.pending.type === "EXIT") {
      const prevCum = Number(st.pending.filledCum || 0);
      const currCum = Number.isFinite(cumFilledQty) ? cumFilledQty : 0;
      const deltaQty = Math.max(0, currCum - prevCum);

      if (deltaQty > 0) {
        st.pending.filledCum = currCum;

        const reason = st.pending.reason;
        const mode = st.pending.mode;

        const entryRef = Number(st.position.entryPrice ?? st.position.entryMark ?? 0);
        const fillPx = (Number.isFinite(lastFillPrice) && lastFillPrice > 0)
          ? lastFillPrice
          : (Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : 0);

        let pnlUSDT = 0;
        if (deltaQty > 0 && entryRef > 0 && fillPx > 0) {
          pnlUSDT = (st.position.side === "LONG")
            ? (fillPx - entryRef) * deltaQty
            : (entryRef - fillPx) * deltaQty;

          st.dayRealizedPnl += pnlUSDT;
          if (pnlUSDT >= 0) st.dayWins += 1;
          else st.dayLosses += 1;
        }

        const newQty = Math.max(0, Number(st.position.qty) - deltaQty);
        st.position.qty = newQty;

        if (reason === "TP1") st.tp1Hit = true;

        perf.recordExit({
          symbol,
          reason,
          mode,
          exitPrice: fillPx,
          qtyClosed: deltaQty,
          pnlUSDT,
          nowMs: nowWall,
          clientId,
          targetPx: st.pending.targetPx ?? null,
          remainingQty: newQty,
          isFinal: newQty <= 0
        });

        log("[USER] EXIT FILL", symbol, "cid=", clientId, "reason=", reason, "mode=", mode, "fill=", fmt(fillPx), "deltaQty=", fmt(deltaQty, 8), "remaining=", fmt(newQty, 8));

        if (newQty <= 0) {
          st.position = { side: "NONE", qty: 0, entryPrice: null, entryMark: null };
          st.tp1Hit = false;
        }

        if (reason === "SL_BB") {
          onStopLoss(st, CFG, nowWall);
          log("[GUARD] SL confirmed", symbol, "cooldownUntil=", new Date(st.cooldownUntil).toISOString(), "pausedUntil=", st.pausedUntil ? new Date(st.pausedUntil).toISOString() : "none");
        }
      }

      if (status === "FILLED") {
        st.pending = null;
        return;
      }

      if (terminal && status !== "FILLED") {
        log("[USER] EXIT terminal", symbol, clientId, "status=", status, "cumQty=", fmt(cumFilledQty, 8));
        st.pending = null;
        return;
      }

      return;
    }

  } catch {
    // silent
  }
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log("[SYS] shutdown start", signal);

  try { stopMarketWS?.(); } catch {}
  try { stopUserWS?.(); } catch {}
  try { if (keepAliveTimer) clearInterval(keepAliveTimer); } catch {}
  try { if (dayTimer) clearInterval(dayTimer); } catch {}

  for (const s of SYMS) {
    const st = symState.get(s);
    if (!st) continue;

    try {
      if (st.pending?.clientId) {
        await BinanceRest.cancelOrder({ symbol: s, origClientOrderId: st.pending.clientId, recvWindow: CFG.exec.recvWindow });
      }
    } catch {}

    try { await cancelAllOpenOrdersForSymbol(s); } catch {}
  }

  try { perf.printTotals(); } catch {}

  log("[SYS] shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

safeInit().catch((e) => {
  console.error("Boot failed:", e?.response?.data || e.message);
  process.exit(1);
});
