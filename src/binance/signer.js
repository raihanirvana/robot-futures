// src/binance/signer.js
import crypto from "crypto";

/**
 * Build a query string and signature.
 * Uses URLSearchParams which performs percent-encoding.
 */
export function signQuery(params, secret) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }
  const query = sp.toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  return { query, signature };
}
