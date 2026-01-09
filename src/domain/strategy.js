// src/domain/strategy.js
export function updateTriggers(state, triggerMult) {
  const { upper, lower, width } = state.bb;
  state.bb.longTrigger  = lower - triggerMult * width;
  state.bb.shortTrigger = upper + triggerMult * width;
}

export function resetArmedOnReenterBand(state, mark, armedEnabled = true) {
  if (!armedEnabled) return;
  if (!state.bb) return;
  if (mark > state.bb.lower) state.armedLong = false;
  if (mark < state.bb.upper) state.armedShort = false;
}

export function crossedLongTrigger(state, mark) {
  if (state.prevMark == null) return false;
  return state.prevMark > state.bb.longTrigger && mark <= state.bb.longTrigger;
}

export function crossedShortTrigger(state, mark) {
  if (state.prevMark == null) return false;
  return state.prevMark < state.bb.shortTrigger && mark >= state.bb.shortTrigger;
}
