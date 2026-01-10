// src/domain/series.js
export function createCloseSeries(maxLen = 500) {
  const buf = [];

  function pushClosed(close) {
    const v = Number(close);
    if (!Number.isFinite(v)) return;

    buf.push(v);
    while (buf.length > maxLen) buf.shift();
  }

  function lastN(n) {
    if (!n || buf.length < n) return null;
    return buf.slice(buf.length - n);
  }

  function size() { return buf.length; }
  function clear() { buf.length = 0; }

  return { pushClosed, lastN, size, clear };
}
