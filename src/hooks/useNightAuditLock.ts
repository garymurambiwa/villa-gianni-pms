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

const API_BASE = 'http://localhost:3001';

export function useNightAuditLock() {
  const [state, setState] = useState<NightAuditLockState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Fetch current status immediately
    fetch(`${API_BASE}/api/night-audit/status`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setState(s => ({
            ...s,
            locked:       data.locked || false,
            step:         data.step   || null,
            progress:     data.progress || 0,
            businessDate: data.businessDate || null,
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
        setState({ locked: false, step: 'complete', progress: 100, businessDate: null, lastResult: d.last_result });
        // Brief pause so user sees 100% before clearing
        setTimeout(() => setState(INITIAL), 4000);
      } catch {}
    };

    const handleComplete = (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setState(s => ({ ...s, locked: false, step: 'complete', progress: 100, lastResult: d }));
        setTimeout(() => setState(INITIAL), 4000);
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
