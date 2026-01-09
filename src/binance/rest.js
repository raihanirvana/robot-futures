import axios from "axios";
import { signQuery } from "./signer.js";

const USE_TESTNET = (process.env.BINANCE_USE_TESTNET || "").toLowerCase() === "true";
const BASE = USE_TESTNET ? "https://testnet.binancefuture.com" : "https://fapi.binance.com";
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

if (!API_KEY || !API_SECRET) {
  console.error("Missing BINANCE_API_KEY / BINANCE_API_SECRET env vars.");
}

const http = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: { "X-MBX-APIKEY": API_KEY }
});

function ts() { return Date.now(); }

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

export const BinanceRest = {
  baseUrl() { return BASE; },

  async exchangeInfo(symbol) {
    const data = (await http.get(`/fapi/v1/exchangeInfo?symbol=${symbol}`)).data;
    const s = data.symbols?.[0];
    if (!s) throw new Error(`Symbol not found in exchangeInfo: ${symbol}`);

    // Prefer MARKET_LOT_SIZE for market orders, fallback to LOT_SIZE
    const mlot = s.filters.find(f => f.filterType === "MARKET_LOT_SIZE");
    const lot  = s.filters.find(f => f.filterType === "LOT_SIZE");
    const price = s.filters.find(f => f.filterType === "PRICE_FILTER");
    const lotRef = mlot || lot;

    return {
      stepSize: lotRef?.stepSize ?? "1",
      minQty: lotRef?.minQty ?? "0",
      maxQty: lotRef?.maxQty ?? null,              // ✅ NEW
      tickSize: price?.tickSize ?? "0.00000001"
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
