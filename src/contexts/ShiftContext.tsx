import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ShiftReading } from '../types';
import pmsAuthDb from '../lib/pmsAuthDb';

export type PaymentMethod = 'cash' | 'card' | 'room-charge';

export interface ShiftTransaction {
  id: string;
  method: PaymentMethod;
  amount: number;
  reference?: string; // e.g., BILL id
  createdAt: string; // ISO
  voided?: boolean;
  voidedAt?: string;
  voidReason?: string;
}

export interface Shift {
  id: string;
  startedAt: string;
  endedAt?: string;
  openedBy?: string; // userId
  userName?: string;
  stationId?: string;
  openingCash: number;
  closingCash?: number;
  status: 'open' | 'closed';
  transactions: ShiftTransaction[];
  voidedTransactions: ShiftTransaction[];
  zReadingId?: string;
}

interface ShiftContextType {
  activeShift: Shift | null;
  startShift: (openingCash: number, notes?: string, userId?: string, stationId?: string) => Promise<void>;
  endShift: (closingCash?: number) => Promise<{ success: boolean; zReading?: ShiftReading; error?: string }>;
  addTransaction: (method: PaymentMethod, amount: number, reference?: string) => ShiftTransaction | null;
  voidTransaction: (transactionId: string, reason: string) => boolean;
  getTotals: () => { cash: number; card: number; roomCharge: number; count: number; voidedCount: number; voidedAmount: number };
  getEndedShifts: () => Shift[];
  clearEndedShifts: () => void;
  generateXReading: () => ShiftReading | null;
  generateZReading: (closingCash?: number) => ShiftReading | null;
  getZReadings: () => ShiftReading[];
}

const ShiftContext = createContext<ShiftContextType | undefined>(undefined);

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Normalize a Shift object to ensure backward compatibility with older stored shapes
  const normalizeShift = (s: any): Shift => {
    const txs = Array.isArray(s?.transactions) ? s.transactions : [];
    const voided = Array.isArray(s?.voidedTransactions) ? s.voidedTransactions : [];
    return {
      id: String(s?.id || `SHIFT_${Date.now()}`),
      startedAt: String(s?.startedAt || new Date().toISOString()),
      endedAt: s?.endedAt ? String(s.endedAt) : undefined,
      openedBy: s?.openedBy ? String(s.openedBy) : undefined,
      openingCash: Number.isFinite(Number(s?.openingCash)) ? Number(s.openingCash) : 0,
      closingCash: Number.isFinite(Number(s?.closingCash)) ? Number(s.closingCash) : undefined,
      status: (s?.status === 'closed' ? 'closed' : 'open') as 'open' | 'closed',
      transactions: txs,
      voidedTransactions: voided,
      zReadingId: s?.zReadingId ? String(s.zReadingId) : undefined
    };
  };

  const [activeShift, setActiveShift] = useState<Shift | null>(() => {
    // Optionally restore from localStorage
    try {
      const raw = localStorage.getItem('corepms_activeShift');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const normalized = normalizeShift(parsed);
      // Write back to fix legacy shapes
      localStorage.setItem('corepms_activeShift', JSON.stringify(normalized));
      return normalized;
    } catch {
      return null;
    }
  });

  const [endedShifts, setEndedShifts] = useState<Shift[]>(() => {
    try {
      const raw = localStorage.getItem('corepms_endedShifts');
      if (!raw) return [];
      const arr = JSON.parse(raw);
      const normalized = Array.isArray(arr) ? arr.map(normalizeShift) : [];
      // Write back to fix legacy shapes
      localStorage.setItem('corepms_endedShifts', JSON.stringify(normalized));
      return normalized;
    } catch {
      return [];
    }
  });

  const [zReadings, setZReadings] = useState<ShiftReading[]>(() => {
    try {
      const raw = localStorage.getItem('corepms_zReadings');
      return raw ? JSON.parse(raw) as ShiftReading[] : [];
    } catch {
      return [];
    }
  });

  const persist = (shift: Shift | null) => {
    if (shift) localStorage.setItem('corepms_activeShift', JSON.stringify(shift));
    else localStorage.removeItem('corepms_activeShift');
  };

  const startShift = async (openingCash: number = 0, notes?: string, userId?: string, stationId?: string) => {
    try {
      const res = await pmsAuthDb.startShift(userId || 'unknown', stationId || 'unknown', openingCash);
      if (!res.ok) throw new Error(res.error || 'Failed to start shift in DB');

      const newShift: Shift = {
        id: res.id!,
        startedAt: new Date().toISOString(),
        openedBy: userId,
        openingCash,
        status: 'open',
        transactions: [],
        voidedTransactions: []
      };
      setActiveShift(newShift);
      persist(newShift);
    } catch (e: any) {
      console.error('Shift start error:', e);
      throw e;
    }
  };

  const endShift = async (closingCash?: number): Promise<{ success: boolean; zReading?: ShiftReading; error?: string }> => {
    if (!activeShift) {
      return { success: false, error: 'No active shift to end' };
    }

    try {
      // Sync to DB
      const dbRes = await pmsAuthDb.endShift(activeShift.id, closingCash || 0);
      if (!dbRes.ok) console.warn('Database endShift failed:', dbRes.error);

      // Import Z reading service functions
      const { generateZReading, printZReading, logZReadingAudit, storeZReading } = await import('../lib/zReadingService');
      
      const totals = getTotals();
      const ended: Shift = { 
        ...activeShift, 
        endedAt: new Date().toISOString(),
        closingCash,
        status: 'closed'
      };

      // Generate Z reading
      const zReading = generateZReading({
        shift: ended,
        totals,
        closingCash
      });

      // Update shift with Z reading ID
      ended.zReadingId = zReading.id;

      // Attempt to print Z reading
      const printResult = await printZReading(zReading, ended);
      
      // Log audit trail regardless of print success
      logZReadingAudit(zReading, ended, printResult);
      
      // Store Z reading
      storeZReading(zReading);
      setZReadings(prev => {
        const next = [zReading, ...prev];
        localStorage.setItem('corepms_zReadings', JSON.stringify(next));
        return next;
      });

      // Store ended shift
      setEndedShifts(prev => {
        const next = [...prev, ended];
        localStorage.setItem('corepms_endedShifts', JSON.stringify(next));
        return next;
      });

      // Clear active shift
      setActiveShift(null);
      persist(null);

      if (!printResult.success) {
        return { 
          success: true, 
          zReading, 
          error: `Shift closed successfully but printing failed: ${printResult.error}` 
        };
      }

      return { success: true, zReading };
    } catch (error) {
      console.error('Failed to end shift:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  };

  const addTransaction = (method: PaymentMethod, amount: number, reference?: string): ShiftTransaction | null => {
    if (!activeShift) {
      // Auto-start a shift if none exists for simplicity
      startShift(0, 'Auto-start', 'System', 'Unknown').catch(console.error);
    }
    const tx: ShiftTransaction = {
      id: `SFTX_${Date.now()}`,
      method,
      amount: Number(amount.toFixed(2)),
      reference,
      createdAt: new Date().toISOString()
    };
    setActiveShift(prev => {
      if (!prev) return null; // shouldn't happen
      const next = { ...prev, transactions: [...prev.transactions, tx] };
      persist(next);
      return next;
    });
    return tx;
  };

  const voidTransaction = (transactionId: string, reason: string): boolean => {
    if (!activeShift) return false;
    
    const transactionIndex = activeShift.transactions.findIndex(tx => tx.id === transactionId);
    if (transactionIndex === -1) return false;

    const transaction = activeShift.transactions[transactionIndex];
    const voidedTransaction: ShiftTransaction = {
      ...transaction,
      voided: true,
      voidedAt: new Date().toISOString(),
      voidReason: reason
    };

    setActiveShift(prev => {
      if (!prev) return null;
      const next = {
        ...prev,
        transactions: prev.transactions.filter(tx => tx.id !== transactionId),
        voidedTransactions: [...prev.voidedTransactions, voidedTransaction]
      };
      persist(next);
      return next;
    });

    return true;
  };

  const getTotals = (): { cash: number; card: number; roomCharge: number; count: number; voidedCount: number; voidedAmount: number } => {
    if (!activeShift) return { cash: 0, card: 0, roomCharge: 0, count: 0, voidedCount: 0, voidedAmount: 0 };
    const txs = Array.isArray(activeShift.transactions) ? activeShift.transactions : [];
    const voidedTxs = Array.isArray(activeShift.voidedTransactions) ? activeShift.voidedTransactions : [];

    const totals = txs.reduce((acc, t) => {
      if (t.method === 'cash') acc.cash += t.amount;
      else if (t.method === 'card') acc.card += t.amount;
      else if (t.method === 'room-charge') acc.roomCharge += t.amount;
      acc.count += 1;
      return acc;
    }, { cash: 0, card: 0, roomCharge: 0, count: 0, voidedCount: 0, voidedAmount: 0 });

    // Add voided transaction totals
    totals.voidedCount = voidedTxs.length;
    totals.voidedAmount = voidedTxs.reduce((sum, tx) => sum + tx.amount, 0);

    return totals;
  };

  const getEndedShifts = (): Shift[] => endedShifts;
  const clearEndedShifts = (): void => {
    setEndedShifts([]);
    localStorage.removeItem('corepms_endedShifts');
  };

  const generateXReading = (): ShiftReading | null => {
    if (!activeShift) return null;
    
    const totals = getTotals();
    const totalSales = totals.cash + totals.card + totals.roomCharge;
    
    return {
      id: `X_READING_${Date.now()}`,
      reading_number: Math.floor(Math.random() * 1000) + 1, // Simple counter
      reading_type: 'X',
      shift_id: activeShift.id,
      total_sales: totalSales,
      total_transactions: totals.count,
      bar_sales: totalSales * 0.4, // Mock split
      restaurant_sales: totalSales * 0.6, // Mock split
      cash_payments: totals.cash,
      card_payments: totals.card,
      room_charge_payments: totals.roomCharge,
      created_at: new Date().toISOString()
    };
  };

  const generateZReading = (closingCash?: number): ShiftReading | null => {
    if (!activeShift) return null;
    
    const totals = getTotals();
    const totalSales = totals.cash + totals.card + totals.roomCharge;
    const expectedCash = activeShift.openingCash + totals.cash;
    const cashDifference = closingCash !== undefined ? closingCash - expectedCash : 0;
    
    return {
      id: `Z_READING_${Date.now()}`,
      reading_number: zReadings.length + 1,
      reading_type: 'Z',
      shift_id: activeShift.id,
      total_sales: totalSales,
      total_transactions: totals.count,
      bar_sales: totalSales * 0.4, // Mock split
      restaurant_sales: totalSales * 0.6, // Mock split
      cash_payments: totals.cash,
      card_payments: totals.card,
      room_charge_payments: totals.roomCharge,
      created_at: new Date().toISOString(),
      report_data: {
        expectedCash,
        closingCash: closingCash || expectedCash,
        cashDifference
      }
    };
  };

  const getZReadings = (): ShiftReading[] => zReadings;

  const value: ShiftContextType = {
    activeShift,
    startShift,
    endShift,
    addTransaction,
    voidTransaction,
    getTotals,
    getEndedShifts,
    clearEndedShifts,
    generateXReading,
    generateZReading,
    getZReadings
  };

  return (
    <ShiftContext.Provider value={value}>
      {children}
    </ShiftContext.Provider>
  );
};

export const useShift = (): ShiftContextType => {
  const ctx = useContext(ShiftContext);
  if (!ctx) throw new Error('useShift must be used within ShiftProvider');
  return ctx;
};
