import { env } from '@/lib/env';

export const API_URL = () => {
  // In production, use relative URL (same origin)
  // In development, use the VITE_API_URL or fallback to localhost:3001
  if (import.meta.env.PROD) {
    return '';
  }
  
  // For Vercel and Render deployments, use the same origin
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (hostname.includes('vercel.app') || hostname.includes('onrender.com')) {
    return '';
  }
  
  // Development fallback
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

export const fetchApi = async (endpoint: string, options: RequestInit = {}, timeoutMs = 20000) => {
  const baseUrl = API_URL();
  const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: controller.signal,
    ...options,
  }).finally(() => clearTimeout(timer));
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || `API request failed with status ${response.status}`
    );
  }
  
  return response.json();
};