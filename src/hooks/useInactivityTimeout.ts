import { useEffect, useRef } from 'react';

export const useInactivityTimeout = (timeoutMs: number, onTimeout: () => void, enabled: boolean = true) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (enabled) {
      timerRef.current = setTimeout(onTimeout, timeoutMs);
    }
  };

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    
    const handleActivity = () => {
      resetTimer();
    };

    events.forEach(event => window.addEventListener(event, handleActivity));
    
    // Initial start
    resetTimer();

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, timeoutMs, onTimeout]);

  return resetTimer;
};
