// src/domain/sizing.js

function decimalsFromSize(size) {
  const s0 = String(size).trim().toLowerCase();

  // support "1e-8"
  if (s0.includes("e-")) {
    const m = s0.match(/e-(\d+)/);
    if (m) return Number(m[1]) || 0;
  }

  if (!s0.includes(".")) return 0;

  // ✅ strip trailing zeros so "0.10" => 1 decimal, not 2
  const frac = s0.split(".")[1].replace(/0+$/, "");
  return frac.length;
}

export function roundDownToStep(qty, stepSize) {
  const q = Number(qty);
  const step = Number(stepSize);

  if (!Number.isFinite(q)) return 0;
  if (!Number.isFinite(step) || step <= 0) return q;

  const decimals = decimalsFromSize(stepSize);
  const scale = 10 ** Math.min(decimals, 12);

  const qInt = Math.floor(q * scale + 1e-9);
  const stepInt = Math.floor(step * scale + 1e-9);

  if (stepInt <= 0) return q;

  const roundedInt = Math.floor(qInt / stepInt) * stepInt;
  return roundedInt / scale;
}

/**
 * Convert qty number -> safe string based on stepSize decimals
 * ✅ trims trailing zeros
 */
export function formatQtyByStep(qty, stepSize) {
  const q = Number(qty);
  if (!Number.isFinite(q)) return "0";

  const d = decimalsFromSize(stepSize);
  let out = q.toFixed(Math.min(d, 12));
  if (out.includes(".")) out = out.replace(/\.?0+$/, "");
  return out;
}

/**
 * Convert price -> safe string based on tickSize decimals
 * ✅ trims trailing zeros
 */
export function formatPriceByTick(price, tickSize) {
  const p = Number(price);
  if (!Number.isFinite(p)) return "0";

  const d = decimalsFromSize(tickSize);
  let out = p.toFixed(Math.min(d, 12));
  if (out.includes(".")) out = out.replace(/\.?0+$/, "");
  return out;
}

/**
 * Calculate order qty from desired notional (USDT).
 * - floor to step
 * - enforce minQty
 * - clamp maxQty
 * - ✅ enforce minNotional if provided by rules (best-effort)
 */
export function calcQtyFromNotional(notionalUSDT, markPrice, rules) {
  const notional = Number(notionalUSDT);
  const mark = Number(markPrice);

  if (!Number.isFinite(notional) || notional <= 0) return 0;
  if (!Number.isFinite(mark) || mark <= 0) return 0;
  if (!rules) return 0;

  const stepSize = Number(rules.stepSize);
  const minQty = Number(rules.minQty);
  const maxQty = Number(rules.maxQty ?? Infinity);
  const minNotional = rules.minNotional != null ? Number(rules.minNotional) : null;

  if (!Number.isFinite(stepSize) || stepSize <= 0) return 0;
  if (!Number.isFinite(minQty) || minQty < 0) return 0;

  const qtyRaw = notional / mark;
  let qty = roundDownToStep(qtyRaw, stepSize);

  if (Number.isFinite(maxQty) && maxQty > 0 && qty > maxQty) {
    qty = roundDownToStep(maxQty, stepSize);
  }

  if (!Number.isFinite(qty) || qty < minQty) return 0;

  // ✅ minNotional best-effort
  if (minNotional != null && Number.isFinite(minNotional) && minNotional > 0) {
    if (qty * mark < minNotional) return 0;
  }

  return qty;
}
