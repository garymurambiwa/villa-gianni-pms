import expenseSvc from '@/lib/expenseService';
import vendors from '@/lib/vendors';
import gl from '@/lib/glAccounting';
import { describe, it, expect } from 'vitest';

export function runExpensePostingSpec() {
  const today = new Date().toISOString().slice(0,10);
  const vendor = vendors.listVendors()[0];
  const invoiceRef = `SPEC_${Date.now()}`;
  const acc = gl.getAccounts().find(a=> a.category==='Expense')?.id || '5400';
  const add = expenseSvc.addExpense({ date: today, vendorId: vendor?.id || 'V001', invoiceRef, paymentMethod: 'Cash', amount: 5, currency: 'USD', glAccountId: acc, costCenter: 'Administration', description: 'Spec Expense' });
  if (!add.ok || !add.expense) return { passed:false, step:'add', error:'addExpense failed' };
  if (add.expense.status === 'pending_approval') {
    const appr = expenseSvc.approveExpense(add.expense.id);
    if (!appr.ok) return { passed:false, step:'approve', error:'approveExpense failed' };
  }
  const post = expenseSvc.postExpenseToGL(add.expense.id);
  if (!post.ok) return { passed:false, step:'post', error:post.error || 'postExpenseToGL failed' };
  const entryId = `GL_EXP_${add.expense.id}`;
  const entry = gl.getLedger().find(e => e.id === entryId);
  if (!entry) return { passed:false, step:'ledger', error:'Entry not appended to ledger' };
  const balanced = gl.isBalanced(entry.lines);
  return { passed: balanced, step:'balanced', entryId: entry.id };
}

export default { runExpensePostingSpec };

// Vitest suite wrapper for the spec function
describe('Expense Posting', () => {
  it('posts approved expense to GL and balances', () => {
    const res = runExpensePostingSpec();
    expect(res.passed).toBe(true);
  });
});
