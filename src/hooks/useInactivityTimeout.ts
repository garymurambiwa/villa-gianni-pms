/**
 * useInactivityTimeout
 * ────────────────────
 * Fires onWarn  N seconds before the deadline (optional 60 s warning toast).
 * Fires onTimeout when the inactivity window expires.
 *
 * Fixes vs old implementation:
 *   1. Stable callback refs — no duplicate event-listener registration on re-renders.
 *   2. Throttled activity handler (max 1 reset/s) — prevents performance hit on
 *      rapid mouse moves.
 *   3. visibilitychange listener — if the tab is brought back to the foreground
 *      after the timeout has already elapsed, logout fires immediately.
 *   4. Warn timer — a secondary timer fires onWarn WARN_MS before the deadline.
 */

import { useEffect, useRef, useCallback } from 'react';

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'keypress',
  'touchstart',
  'click',
  'scroll',
  'wheel',
] as const;

export interface InactivityTimeoutOptions {
  /** Total inactivity window in ms before onTimeout fires. */
  timeoutMs: number;
  /** Called when the inactivity deadline is reached. */
  onTimeout: () => void;
  /** Called this many ms BEFORE onTimeout to show a warning. 0 = disabled. */
  warnBeforeMs?: number;
  /** Called when the warning fires. */
  onWarn?: (secondsLeft: number) => void;
  /** Set false to pause the timer (e.g. modal dialogs). */
  enabled?: boolean;
}

export function useInactivityTimeout({
  timeoutMs,
  onTimeout,
  warnBeforeMs = 0,
  onWarn,
  enabled = true,
}: InactivityTimeoutOptions) {
  const timeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResetRef  = useRef<number>(0); // throttle — last time we reset timers
  const deadlineRef   = useRef<number>(0); // absolute ms timestamp of the deadline

  // Stable callback refs so the useEffect deps don't change on every render
  const onTimeoutRef = useRef(onTimeout);
  const onWarnRef    = useRef(onWarn);
  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);
  useEffect(() => { onWarnRef.current    = onWarn;    }, [onWarn]);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (warnRef.current)    { clearTimeout(warnRef.current);    warnRef.current    = null; }
  }, []);

  const resetTimers = useCallback(() => {
    if (!enabled) return;

    // Throttle: at most one reset per second to avoid performance issues
    const now = Date.now();
    if (now - lastResetRef.current < 1000) return;
    lastResetRef.current = now;

    clearTimers();
    deadlineRef.current = now + timeoutMs;

    // Primary timeout
    timeoutRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMs);

    // Warning timer (fires WARN ms before deadline)
    if (warnBeforeMs > 0 && onWarnRef.current && timeoutMs > warnBeforeMs) {
      warnRef.current = setTimeout(() => {
        const secondsLeft = Math.round(warnBeforeMs / 1000);
        onWarnRef.current?.(secondsLeft);
      }, timeoutMs - warnBeforeMs);
    }
  }, [enabled, timeoutMs, warnBeforeMs, clearTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    // Start the initial timers
    // Bypass throttle on first mount
    lastResetRef.current = 0;
    resetTimers();

    // Activity listener
    const handleActivity = () => resetTimers();

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, handleActivity, { passive: true }));

    // visibilitychange: if tab comes back to foreground after the deadline elapsed, fire immediately
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() >= deadlineRef.current) {
          clearTimers();
          onTimeoutRef.current();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutMs, warnBeforeMs]);

  /** Manually reset the inactivity timer (e.g. when a form is submitted). */
  const resetManually = useCallback(() => {
    lastResetRef.current = 0; // bypass throttle
    resetTimers();
  }, [resetTimers]);

  return { resetManually };
}
