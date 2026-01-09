export function bollinger(closes, period, stdDevMult) {
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((acc, x) => acc + (x - mean) ** 2, 0) / period;
  const stdev = Math.sqrt(variance);

  const upper = mean + stdDevMult * stdev;
  const lower = mean - stdDevMult * stdev;
  const width = upper - lower;

  return { upper, middle: mean, lower, width };
}
