
type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

interface ErrorLogEntry {
  timestamp: string;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, any>;
}

const STORAGE_KEY = 'corepms_error_logs';

export const errorTracker = {
  log: (error: Error | string, severity: ErrorSeverity = 'error', context?: Record<string, any>) => {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      severity,
      message,
      stack,
      context
    };

    // Log to console
    console[severity === 'critical' ? 'error' : severity](`[${severity.toUpperCase()}] ${message}`, context || '', stack || '');

    // Persist to local storage (circular buffer of last 50 errors)
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const updated = [entry, ...existing].slice(0, 50);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      // Fallback if localStorage fails
      console.error('Failed to persist error log', e);
    }
  },

  getLogs: (): ErrorLogEntry[] => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  },

  clearLogs: () => {
    localStorage.removeItem(STORAGE_KEY);
  }
};
