export function roundDownToStep(qty, stepSize) {
  const q = Number(qty);
  const step = Number(stepSize);

  if (!Number.isFinite(q)) return 0;
  if (!Number.isFinite(step) || step <= 0) return q;

  const stepStr = String(stepSize);
  const decimals = stepStr.includes(".") ? stepStr.split(".")[1].length : 0;
  const scale = 10 ** Math.min(decimals, 12);

  const qInt = Math.floor(q * scale + 1e-9);
  const stepInt = Math.floor(step * scale + 1e-9);

  if (stepInt <= 0) return q;

  const roundedInt = Math.floor(qInt / stepInt) * stepInt;
  return roundedInt / scale;
}

/**
 * Calculate order qty from desired notional (USDT).
 * If qty < minQty -> return 0 (skip trade). We DO NOT round up silently.
 * ✅ NEW: clamp to maxQty when provided.
 */
export function calcQtyFromNotional(notionalUSDT, markPrice, rules) {
  const notional = Number(notionalUSDT);
  const mark = Number(markPrice);

  if (!Number.isFinite(notional) || notional <= 0) return 0;
  if (!Number.isFinite(mark) || mark <= 0) return 0;
  if (!rules) return 0;

  const stepSize = Number(rules.stepSize);
  const minQty = Number(rules.minQty);
  const maxQty = Number(rules.maxQty ?? Infinity); // ✅ NEW

  if (!Number.isFinite(stepSize) || stepSize <= 0) return 0;
  if (!Number.isFinite(minQty) || minQty < 0) return 0;

  const qtyRaw = notional / mark;
  let qty = roundDownToStep(qtyRaw, stepSize);

  // ✅ clamp to maxQty if provided
  if (Number.isFinite(maxQty) && maxQty > 0 && qty > maxQty) {
    qty = roundDownToStep(maxQty, stepSize);
  }

  if (!Number.isFinite(qty) || qty < minQty) return 0;
  return qty;
}
