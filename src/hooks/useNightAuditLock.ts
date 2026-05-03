import { useEffect, useRef, useState } from 'react';

export interface NightAuditLockState {
  locked:       boolean;
  step:         string | null;
  progress:     number;
  businessDate: string | null;
  lastResult:   unknown;
}

const INITIAL: NightAuditLockState = {
  locked:       false,
  step:         null,
  progress:     0,
  businessDate: null,
  lastResult:   null,
};

const API_BASE = '';

export function useNightAuditLock() {
  const [state, setState] = useState<NightAuditLockState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);

  // Helper to check if a specific audit has already been acknowledged
  const isAcknowledged = (date: string | null) => {
    if (!date) return false;
    return localStorage.getItem('corepms_na_ack') === date;
  };

  useEffect(() => {
    // Fetch current status immediately
    fetch(`${API_BASE}/api/night-audit/status`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          const runDate = data.lastRun?.business_date;
          const isComplete = data.step === 'complete' && !data.locked;
          
          // If already acknowledged, don't trigger the 'complete' overlay
          if (isComplete && isAcknowledged(runDate)) {
            setState(INITIAL);
            return;
          }

          setState(s => ({
            ...s,
            locked:       data.locked || false,
            step:         data.step   || null,
            progress:     data.progress || 0,
            businessDate: data.businessDate || null,
            lastResult:   data.lastRun || null,
          }));
        }
      })
      .catch(() => {});

    // Subscribe to SSE
    const es = new EventSource(`${API_BASE}/api/night-audit/events`);
    esRef.current = es;

    const handleLock = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setState(s => ({ ...s, locked: d.locked || false, step: d.step || s.step, progress: d.progress || s.progress, businessDate: d.business_date || s.businessDate }));
      } catch {}
    };

    const handleStep = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setState(s => ({ ...s, step: d.step, progress: d.progress || s.progress }));
      } catch {}
    };

    const handleUnlock = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        const runDate = d.last_result?.business_date || d.business_date;
        if (isAcknowledged(runDate)) {
           setState(INITIAL);
           return;
        }
        setState({ locked: false, step: 'complete', progress: 100, businessDate: null, lastResult: d.last_result });
      } catch {}
    };

    const handleComplete = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        const runDate = d.business_date;
        if (isAcknowledged(runDate)) {
           setState(INITIAL);
           return;
        }
        setState(s => ({ ...s, locked: false, step: 'complete', progress: 100, lastResult: d }));
      } catch {}
    };

    es.addEventListener('night_audit_lock',     handleLock);
    es.addEventListener('night_audit_step',     handleStep);
    es.addEventListener('night_audit_unlock',   handleUnlock);
    es.addEventListener('night_audit_complete', handleComplete);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // Centralized cleanup: if we are in 'complete' state and unlocked, clear it after 4s
  useEffect(() => {
    if (state.step === 'complete' && !state.locked) {
      const timer = setTimeout(() => {
        // Mark this specific audit run as acknowledged before clearing
        const result = state.lastResult as any;
        const runDate = result?.business_date || result?.businessDate;
        if (runDate) {
          localStorage.setItem('corepms_na_ack', String(runDate));
        }
        setState(INITIAL);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [state.step, state.locked, state.lastResult]);

  return state;
}
