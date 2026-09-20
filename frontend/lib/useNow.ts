"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 1000;

// A single shared 1s clock, module-level so every component calling
// useNow() re-renders on the same tick and shares one setInterval, instead
// of each component running its own timer
// (specs/live-telemetry-view/plan.md, "Architecture" — lib/useNow.ts).
//
// This is the entire "time passing" half of R5/R6: a device that simply
// goes quiet still flips to "stale" in the UI (see lib/freshness.ts) with no
// data write and no server work — just this clock ticking past
// lastSeenAt + expectedIntervalMs.
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function tick() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    intervalId = setInterval(tick, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

// Always computed live (never cached between ticks) so a component's first
// render — before any tick has fired — still reflects the actual current
// time, not whatever Date.now() happened to be when this module loaded.
function getSnapshot() {
  return Date.now();
}

/** The current time (ms epoch), re-rendering every subscriber once a second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
