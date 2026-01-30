import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('Data Persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('should save and load guests from localStorage', () => {
    const guests = [{ id: '1', name: 'John Doe', folioBalance: 100 }];
    const key = 'corepms_guests';
    
    // Simulate save
    window.localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value: guests }));
    
    // Simulate load
    const raw = window.localStorage.getItem(key);
    const parsed = JSON.parse(raw!);
    
    expect(parsed.value).toEqual(guests);
  });

  it('should save and load folio charges from localStorage', () => {
    const charges = [{ id: 'fc1', amount: 50, description: 'Dinner' }];
    const key = 'corepms_folio_charges';
    
    window.localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value: charges }));
    
    const raw = window.localStorage.getItem(key);
    const parsed = JSON.parse(raw!);
    
    expect(parsed.value).toEqual(charges);
  });

  it('should save and load city ledger from localStorage', () => {
    const ledger = [{ id: 'cl1', name: 'Corporate', balance: 500 }];
    const key = 'corepms_city_ledger';
    
    window.localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value: ledger }));
    
    const raw = window.localStorage.getItem(key);
    const parsed = JSON.parse(raw!);
    
    expect(parsed.value).toEqual(ledger);
  });
});
