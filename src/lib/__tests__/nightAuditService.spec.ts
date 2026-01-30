import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performAutoReconciliation, NightAuditContext } from '../nightAuditService';
import * as dbSync from '../dbSync';
import gl from '../glAccounting';

// Mock dependencies
vi.mock('../dbSync', () => ({
  recordReconciliationLog: vi.fn().mockResolvedValue({ id: 'log_123' }),
  recordVarianceJournalEntry: vi.fn().mockResolvedValue({ success: true }),
  readJSON: vi.fn(),
  writeJSON: vi.fn()
}));

vi.mock('../glAccounting', () => ({
  default: {
    appendLedger: vi.fn(),
    postDailyJournalFromNightAudit: vi.fn()
  }
}));

// Mock localStorage
const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    clear: () => { store = {}; }
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('Night Audit Service - Auto Reconciliation', () => {
  const mockCtx: NightAuditContext = {
    rooms: [],
    guests: [],
    folioCharges: [],
    userId: 'test-user'
  };

  const mockReconciliation = {
    date: '2025-01-01',
    folioTotal: 100,
    shiftTotal: 100,
    postingsTodayTotal: 100,
    varianceFolioVsShift: 0,
    varianceFolioVsPostings: 0,
    totalVariance: 0,
    hasVariance: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should auto-reconcile within tolerance', async () => {
    const recon = { ...mockReconciliation, varianceFolioVsShift: 2, totalVariance: 2, hasVariance: true };
    const options = { autoReconcileTolerance: 5 }; // Tolerance 5 > Variance 2
    
    const result = await performAutoReconciliation(mockCtx, recon, 'user', options);
    
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(true);
    expect(dbSync.recordReconciliationLog).toHaveBeenCalledWith(expect.objectContaining({
      is_forced: true,
      force_reason: 'Automatic reconciliation within tolerance'
    }));
  });

  it('should fail if variance exceeds tolerance', async () => {
    const recon = { ...mockReconciliation, varianceFolioVsShift: 10, totalVariance: 10, hasVariance: true };
    const options = { autoReconcileTolerance: 5 }; // Tolerance 5 < Variance 10
    
    const result = await performAutoReconciliation(mockCtx, recon, 'user', options);
    
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('exceeds tolerance');
    expect(dbSync.recordReconciliationLog).not.toHaveBeenCalled();
  });

  it('should auto-reconcile if exceeds tolerance BUT forceReconciliation is true', async () => {
    const recon = { ...mockReconciliation, varianceFolioVsShift: 10, totalVariance: 10, hasVariance: true };
    const options = { autoReconcileTolerance: 5, forceReconciliation: true };
    
    const result = await performAutoReconciliation(mockCtx, recon, 'user', options);
    
    expect(result.ok).toBe(true);
    expect(dbSync.recordReconciliationLog).toHaveBeenCalledWith(expect.objectContaining({
      force_reason: 'Manual override (exceeded tolerance)'
    }));
  });
});
