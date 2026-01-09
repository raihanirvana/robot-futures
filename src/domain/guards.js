// src/domain/guards.js
export function canEnterNow(state, cfg, nowMs) {
  if (state.position.side !== "NONE") return false;
  if (state.pending) return false;

  if (!state.bb || !state.rules) return false;

  const g = cfg.guards || {};

  // ✅ cooldown check (optional)
  if (g.cooldownEnabled !== false) {
    if (nowMs < state.cooldownUntil) return false;
  }

  // ✅ killSwitch pause check (optional)
  if (g.killSwitchEnabled !== false) {
    if (nowMs < state.pausedUntil) return false;
  }

  // ✅ max trades/day (optional)
  if (g.maxTradesEnabled !== false) {
    if (state.tradesToday >= g.maxTradesPerDay) return false;
  }

  // ✅ min gap (optional)
  if (g.minGapEnabled !== false) {
    const minGapMs = g.minMinutesBetweenEntries * 60 * 1000;
    if (state.lastEntryAt && (nowMs - state.lastEntryAt) < minGapMs) return false;
  }

  return true;
}

export function onStopLoss(state, cfg, nowMs) {
  const g = cfg.guards || {};

  // ✅ cooldown set (optional)
  if (g.cooldownEnabled !== false) {
    state.cooldownUntil = nowMs + cfg.barMs * g.cooldownBarsAfterSL;
  }

  // ✅ killSwitch record+pause (optional)
  if (g.killSwitchEnabled !== false) {
    state.stopEvents.push(nowMs);

    const windowStart = nowMs - g.killSwitch.windowMs;
    state.stopEvents = state.stopEvents.filter(t => t >= windowStart);

    if (state.stopEvents.length >= g.killSwitch.maxStops) {
      state.pausedUntil = nowMs + g.killSwitch.pauseMs;
      state.stopEvents = [];
    }
  }
}
