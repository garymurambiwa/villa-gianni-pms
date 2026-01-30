import gl from '@/lib/glAccounting';
import expenseSvc from '@/lib/expenseService';
import vendors from '@/lib/vendors';

export interface MappingValidationResult {
  ok: boolean;
  missing?: string[];
  balanced?: boolean;
  error?: string;
  entryId?: string;
}

// Minimal Night Audit bundle for validation
const stubBundle = {
  roomRevenue: 100,
  fbRevenue: 50,
};

export const validateNightAuditMappings = (businessDate: string): MappingValidationResult => {
  const mappingStatus = gl.validateMappingsComplete();
  if (!mappingStatus.ok) {
    return { ok: false, missing: mappingStatus.missing, balanced: false, error: 'Missing required GL mappings' };
  }
  const res = gl.postDailyJournalFromNightAudit(businessDate, stubBundle);
  if (!res.ok) {
    return { ok: false, missing: [], balanced: false, error: res.error };
  }
  const balanced = gl.isBalanced(res.entry!.lines);
  return { ok: balanced, balanced, entryId: res.entry?.id };
};

export interface ExpenseSmokeResult {
  ok: boolean;
  error?: string;
  expenseId?: string;
  entryId?: string;
}

// Posts a small expense end-to-end and ensures it reaches the ledger and balances
export const runExpensePostingSmokeTest = (): ExpenseSmokeResult => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const vendor = vendors.listVendors()[0];
    const invoiceRef = `SMOKE_${Date.now()}`;
    // Choose an Expense account; fall back to 5400 Administration Expense
    const accounts = gl.getAccounts();
    const expenseAcc = accounts.find(a => a.category === 'Expense')?.id || '5400';
    const res = expenseSvc.addExpense({
      date: today,
      vendorId: vendor?.id || 'V001',
      invoiceRef,
      paymentMethod: 'Cash',
      amount: 10,
      currency: 'USD',
      glAccountId: expenseAcc,
      costCenter: 'Administration',
      description: 'Smoke Test Expense'
    });
    if (!res.ok || !res.expense) return { ok:false, error:'Failed to add smoke expense' };
    const id = res.expense.id;
    // Approve if required
    if (res.expense.status === 'pending_approval') {
      const ok = expenseSvc.approveExpense(id);
      if (!ok.ok) return { ok:false, error:'Failed to approve smoke expense', expenseId:id };
    }
    const post = expenseSvc.postExpenseToGL(id);
    if (!post.ok) return { ok:false, error:post.error || 'Failed to post to GL', expenseId:id };
    const balanced = gl.isBalanced(gl.getLedger().find(e=> e.id === post.entry?.id)?.lines || []);
    return { ok: balanced, expenseId:id, entryId: post.entry?.id };
  } catch (err:any) {
    return { ok:false, error:String(err) };
  }
};

export const runSmokeTests = (businessDate: string): { nightAudit: MappingValidationResult; expense: ExpenseSmokeResult } => {
  const nightAudit = validateNightAuditMappings(businessDate);
  const expense = runExpensePostingSmokeTest();
  return { nightAudit, expense };
};

export default { validateNightAuditMappings, runExpensePostingSmokeTest, runSmokeTests };
