import { env } from '@/lib/env';

/**
 * Get the base API URL for the current environment
 * - Production: relative URL (same origin)
 * - Development: VITE_API_URL or localhost:3001
 */
export const getApiBaseUrl = (): string => {
  // In production, use relative URL (same origin)
  if (import.meta.env.PROD) {
    return '';
  }
  
  // For Vercel and Render deployments, use the same origin
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('vercel.app') || hostname.includes('onrender.com')) {
      return '';
    }
  }
  
  // Development fallback
  return import.meta.env.VITE_API_URL || 'http://localhost:3001';
};

/**
 * Fetch wrapper that handles API URL resolution and error handling
 */
export const fetchApi = async <T>(
  endpoint: string, 
  options: RequestInit = {}
): Promise<T> => {
  const baseUrl = getApiBaseUrl();
  const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;
  
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  
  // Handle non-200 responses
  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch (e) {
      // If we can't parse JSON, use the status text
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  
  return response.json();
};

export default { getApiBaseUrl, fetchApi };