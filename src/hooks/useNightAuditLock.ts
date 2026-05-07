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

    // Subscribe to SSE — only on Render/local where persistent connections work.
    // Vercel serverless functions cannot hold SSE connections; skip and rely on polling.
    const host = window.location.host;
    const isVercel = host.includes('vercel.app') || host.includes('.vercel.app');

    if (isVercel) {
      // On Vercel: poll status every 15 seconds instead of SSE
      const pollInterval = setInterval(() => {
        fetch(`${API_BASE}/api/night-audit/status`)
          .then(r => r.json())
          .then(data => {
            if (data.ok) setState(s => ({
              ...s,
              locked: data.locked || false,
              step: data.step || null,
              progress: data.progress || 0,
              businessDate: data.businessDate || s.businessDate,
            }));
          })
          .catch(() => {});
      }, 15000);
      return () => clearInterval(pollInterval);
    }

    // Non-Vercel: use SSE for real-time updates
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
        const runDate = d.last_result?.businessDate || d.last_result?.business_date || d.business_date;
        if (runDate) localStorage.setItem('corepms_na_ack', String(runDate));
        setState(INITIAL);
      } catch {}
    };

    const handleComplete = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        const runDate = d.businessDate || d.business_date;
        if (runDate) localStorage.setItem('corepms_na_ack', String(runDate));
        setState(INITIAL);
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


  return state;
}
