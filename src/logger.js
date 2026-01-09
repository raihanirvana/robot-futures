// src/logger.js
import { DateTime } from "luxon";
import { dayKeyJakarta } from "./state.js";

function fmt(n, d = 8) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "NaN";
  return x.toFixed(d);
}

function isoJakarta(tsMs) {
  return DateTime.fromMillis(tsMs, { zone: "Asia/Jakarta" }).toFormat("yyyy-LL-dd HH:mm:ss");
}

export function createPerfLogger({ log }) {
  // per-symbol perf + open session
  const perf = new Map();

  function get(sym) {
    if (!perf.has(sym)) {
      perf.set(sym, {
        dayKey: dayKeyJakarta(Date.now()),
        day: { sessions: 0, wins: 0, losses: 0, be: 0, netUSDT: 0 },
        total: { sessions: 0, wins: 0, losses: 0, be: 0, netUSDT: 0 },

        // open session (entry -> multiple exits)
        open: null
        // open = {
        //   entryAtMs, entryCid, side, entryPrice, qtyOpen,
        //   tp1, tp2, sl,
        //   realizedUSDT
        // }
      });
    }
    return perf.get(sym);
  }

  function ensureDay(symbol, nowMs) {
    const p = get(symbol);
    const dk = dayKeyJakarta(nowMs);
    if (dk === p.dayKey) return;

    // print yesterday summary
    log(
      `[DAY] ${symbol} ${p.dayKey} sessions=${p.day.sessions} ` +
      `W=${p.day.wins} L=${p.day.losses} BE=${p.day.be} ` +
      `NET=${p.day.netUSDT.toFixed(6)}`
    );

    p.dayKey = dk;
    p.day = { sessions: 0, wins: 0, losses: 0, be: 0, netUSDT: 0 };
  }

  function recordEntry({ symbol, side, entryPrice, qty, nowMs, clientId, tp1, tp2, sl }) {
    const p = get(symbol);

    // overwrite open session if any (shouldn't happen normally)
    p.open = {
      entryAtMs: nowMs,
      entryCid: clientId || null,
      side,
      entryPrice: Number(entryPrice),
      qtyOpen: Number(qty),
      tp1: tp1 != null ? Number(tp1) : null,
      tp2: tp2 != null ? Number(tp2) : null,
      sl:  sl != null ? Number(sl)  : null,
      realizedUSDT: 0
    };

    log(
      `[ENTRY] ${symbol} ${isoJakarta(nowMs)} side=${side} ` +
      `qty=${fmt(qty, 8)} entry=${fmt(entryPrice, 8)} ` +
      `tp1=${tp1 != null ? fmt(tp1, 8) : "na"} ` +
      `tp2=${tp2 != null ? fmt(tp2, 8) : "na"} ` +
      `sl=${sl != null ? fmt(sl, 8) : "na"} ` +
      `cid=${clientId || "na"}`
    );
  }

  function recordExit({
    symbol,
    reason,
    mode,
    exitPrice,
    qtyClosed,
    pnlUSDT,
    nowMs,
    clientId,
    targetPx,
    remainingQty,
    isFinal
  }) {
    const p = get(symbol);
    const open = p.open;

    // Kalau open session belum ada (misal bot restart), tetap log exit-nya
    if (!open) {
      log(
        `[EXIT] ${symbol} ${isoJakarta(nowMs)} reason=${reason} mode=${mode} ` +
        `qty=${fmt(qtyClosed, 8)} exit=${fmt(exitPrice, 8)} ` +
        `pnl=${Number(pnlUSDT).toFixed(6)} target=${targetPx != null ? fmt(targetPx, 8) : "na"} ` +
        `cid=${clientId || "na"} (NO_OPEN_SESSION)`
      );
      return;
    }

    // update open session
    open.realizedUSDT += Number(pnlUSDT || 0);
    open.qtyOpen = Math.max(0, Number(remainingQty ?? open.qtyOpen));

    log(
      `[EXIT] ${symbol} ${isoJakarta(nowMs)} reason=${reason} mode=${mode} side=${open.side} ` +
      `qty=${fmt(qtyClosed, 8)} exit=${fmt(exitPrice, 8)} ` +
      `pnl=${Number(pnlUSDT).toFixed(6)} netSession=${open.realizedUSDT.toFixed(6)} ` +
      `target=${targetPx != null ? fmt(targetPx, 8) : "na"} remQty=${fmt(open.qtyOpen, 8)} ` +
      `cid=${clientId || "na"}`
    );

    if (!isFinal) return;

    // finalize session (count as 1 trade)
    const net = open.realizedUSDT;
    p.day.sessions += 1;
    p.total.sessions += 1;

    p.day.netUSDT += net;
    p.total.netUSDT += net;

    if (net > 0) { p.day.wins += 1; p.total.wins += 1; }
    else if (net < 0) { p.day.losses += 1; p.total.losses += 1; }
    else { p.day.be += 1; p.total.be += 1; }

    const durSec = Math.max(0, Math.floor((nowMs - open.entryAtMs) / 1000));

    log(
      `[TRADE] ${symbol} ENTRY@${isoJakarta(open.entryAtMs)} -> EXIT@${isoJakarta(nowMs)} ` +
      `side=${open.side} entry=${fmt(open.entryPrice, 8)} ` +
      `tp1=${open.tp1 != null ? fmt(open.tp1, 8) : "na"} ` +
      `tp2=${open.tp2 != null ? fmt(open.tp2, 8) : "na"} ` +
      `sl=${open.sl != null ? fmt(open.sl, 8) : "na"} ` +
      `net=${net.toFixed(6)} dur=${durSec}s ` +
      `DAY.net=${p.day.netUSDT.toFixed(6)} (W${p.day.wins}/L${p.day.losses}/BE${p.day.be}) ` +
      `TOTAL.net=${p.total.netUSDT.toFixed(6)}`
    );

    p.open = null;
  }

  function printTotals() {
    for (const [symbol, p] of perf.entries()) {
      log(
        `[TOTAL] ${symbol} sessions=${p.total.sessions} ` +
        `W=${p.total.wins} L=${p.total.losses} BE=${p.total.be} NET=${p.total.netUSDT.toFixed(6)}`
      );
    }
  }

  return { ensureDay, recordEntry, recordExit, printTotals };
}
