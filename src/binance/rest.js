// src/binance/rest.js
import axios from "axios";
import { signQuery } from "./signer.js";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const BASE = USE_TESTNET ? "https://testnet.binancefuture.com" : "https://fapi.binance.com";
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

if (!API_KEY || !API_SECRET) {
  // ✅ fail-fast: jangan jalan kalau env belum benar
  throw new Error("Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars.");
}

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: { "X-MBX-APIKEY": API_KEY }
});

function ts() {
  return Date.now();
}

async function signed(method, path, params = {}) {
  const fullParams = { ...params, timestamp: ts(), recvWindow: params.recvWindow ?? 5000 };
  const { query, signature } = signQuery(fullParams, API_SECRET);
  const url = `${path}?${query}&signature=${signature}`;

  if (method === "GET") return (await http.get(url)).data;
  if (method === "POST") return (await http.post(url)).data;
  if (method === "PUT") return (await http.put(url)).data;
  if (method === "DELETE") return (await http.delete(url)).data;

  throw new Error(`Unsupported method ${method}`);
}

function pickFilter(symbolInfo, type) {
  return symbolInfo?.filters?.find((f) => f.filterType === type) ?? null;
}

export const BinanceRest = {
  baseUrl() {
    return BASE;
  },

  async exchangeInfo(symbol) {
    const data = (await http.get(`/fapi/v1/exchangeInfo?symbol=${symbol}`)).data;
    const s = data.symbols?.[0];
    if (!s) throw new Error(`Symbol not found in exchangeInfo: ${symbol}`);

    // qty step
    const lot = pickFilter(s, "LOT_SIZE");
    const mlot = pickFilter(s, "MARKET_LOT_SIZE");
    const price = pickFilter(s, "PRICE_FILTER");

    // ✅ minNotional (kalau ada)
    // Binance futures exchangeInfo kadang punya MIN_NOTIONAL, kadang tidak tergantung market.
    const minNotionalF = pickFilter(s, "MIN_NOTIONAL");
    const notional = minNotionalF?.notional ?? minNotionalF?.minNotional ?? null;

    return {
      stepSize: lot?.stepSize ?? (mlot?.stepSize ?? "1"),
      minQty: lot?.minQty ?? (mlot?.minQty ?? "0"),
      maxQty: lot?.maxQty ?? (mlot?.maxQty ?? null),

      tickSize: price?.tickSize ?? "0.00000001",

      // optional constraint
      minNotional: notional != null ? String(notional) : null
    };
  },

  async setMarginTypeIsolated(symbol) {
    return signed("POST", "/fapi/v1/marginType", { symbol, marginType: "ISOLATED" });
  },

  async setLeverage(symbol, leverage) {
    return signed("POST", "/fapi/v1/leverage", { symbol, leverage });
  },

  async placeOrder(params) {
    return signed("POST", "/fapi/v1/order", params);
  },

  async getOrder(params) {
    return signed("GET", "/fapi/v1/order", params);
  },

  async getOrderByClientId(symbol, origClientOrderId, recvWindow = 5000) {
    return signed("GET", "/fapi/v1/order", { symbol, origClientOrderId, recvWindow });
  },

  async cancelOrder(params) {
    return signed("DELETE", "/fapi/v1/order", params);
  },

  async openOrders(symbol, recvWindow = 5000) {
    return signed("GET", "/fapi/v1/openOrders", { symbol, recvWindow });
  },

  async positionRisk(symbol, recvWindow = 5000) {
    return signed("GET", "/fapi/v2/positionRisk", { symbol, recvWindow });
  },

  async startListenKey() {
    return (await http.post("/fapi/v1/listenKey")).data;
  },

  async keepAliveListenKey(listenKey) {
    return (await http.put(`/fapi/v1/listenKey?listenKey=${listenKey}`)).data;
  }
};
