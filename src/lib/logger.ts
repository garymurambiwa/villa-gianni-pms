// Lightweight logger with level control; safe for both dev and production
import { Config } from '@/config'

type Level = 'silent' | 'error' | 'warn' | 'info' | 'debug'

const levels: Record<Level, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

function shouldLog(level: Level) {
  const current = (Config.logLevel || 'info') as Level
  return levels[level] <= levels[current]
}

export interface AuthLogEntry {
  ts: string;
  event: string;
  username?: string;
  userId?: string;
  errorCode?: string;
  error?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  provider?: 'supabase' | 'db' | 'local';
  [key: string]: any;
}

export const logger = {
  debug: (...args: any[]) => { if (shouldLog('debug')) console.debug('[corepms]', ...args) },
  info:  (...args: any[]) => { if (shouldLog('info'))  console.info('[corepms]', ...args) },
  warn:  (...args: any[]) => { if (shouldLog('warn'))  console.warn('[corepms]', ...args) },
  error: (...args: any[]) => { if (shouldLog('error')) console.error('[corepms]', ...args) },
  
  // Enhanced authentication logging with security-focused data
  logAuth: (event: string, payload?: Record<string, any>) => {
    if (!shouldLog('info')) return;
    try {
      const entry: AuthLogEntry = { 
        ts: new Date().toISOString(), 
        event, 
        ...(payload||{}) 
      };
      
      // Sanitize sensitive data - ensure no passwords or tokens are logged
      if (entry.password) delete entry.password;
      if (entry.token) delete entry.token;
      if (entry.refreshToken) delete entry.refreshToken;
      
      // Add client metadata for security analysis
      if (typeof window !== 'undefined') {
        entry.userAgent = window.navigator.userAgent.substring(0, 200); // Limit length
        entry.ipAddress = 'renderer'; // Will be enhanced in Electron main process
      }
      
      console.info('[corepms][auth]', entry);
    } catch (e) {
      // Avoid throwing from logging
      console.error('[corepms][logger] Failed to log auth event:', e);
    }
  },
  
  // Security event logging with additional context
  logSecurity: (event: string, payload?: Record<string, any>) => {
    if (!shouldLog('warn')) return;
    try {
      const entry = { 
        ts: new Date().toISOString(), 
        event, 
        severity: 'security',
        ...(payload||{}) 
      };
      
      // Sanitize sensitive data
      if (entry.password) delete entry.password;
      if (entry.token) delete entry.token;
      if (entry.secret) delete entry.secret;
      
      console.warn('[corepms][security]', entry);
    } catch (e) {
      console.error('[corepms][logger] Failed to log security event:', e);
    }
  }
}
