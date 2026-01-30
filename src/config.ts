// Centralized configuration for COREPMS
// Local LAN-only operation - no cloud services

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const env = import.meta.env as Record<string, any>;
const win = typeof window !== 'undefined' ? (window as any) : {};

export const Config = {
  // Local authentication only
  useLocalAuth: true,
  logLevel: (env.VITE_LOG_LEVEL || 'info') as LogLevel,
  apiBaseUrl: (env.VITE_API_BASE_URL || '/api').toString(),
  mode: (env.MODE || env.VITE_MODE || (import.meta as any).env?.MODE || 'development').toString(),
  // Database is configured via environment variables or Electron settings
  databaseUrl: (env.DATABASE_URL || '').toString(),
};

export const isProduction = Config.mode === 'production';
export const isDevelopment = Config.mode === 'development';
