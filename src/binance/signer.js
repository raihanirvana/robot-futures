// src/binance/signer.js
import crypto from "crypto";

/**
 * Build a query string and signature.
 * - Sort keys to be deterministic (reduces weird edge failures)
 * - URLSearchParams handles percent-encoding
 */
export function signQuery(params, secret) {
  const sp = new URLSearchParams();

  const keys = Object.keys(params).sort();
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }

  const query = sp.toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return { query, signature };
}
