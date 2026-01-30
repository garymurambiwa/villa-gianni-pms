import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import JournalPostingModal from '@/components/modules/JournalPostingModal';
import gl from '@/lib/glAccounting';

// Migrate mocking to Vitest
vi.mock('@/lib/glAccounting', () => ({
  default: {
    getAccounts: vi.fn(),
    isBalanced: vi.fn(),
    appendLedger: vi.fn(),
  }
}));
// Mock Auth context to satisfy useAuth in component
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test User', role: 'admin' } })
}));

describe('JournalPostingModal', () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (gl.getAccounts as any).mockReturnValue([{ id: '1000', name: 'Cash', category: 'Asset' }]);
    (gl.isBalanced as any).mockImplementation((lines) => {
      const debit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      return Math.abs(debit - credit) < 0.005 && debit > 0 && credit > 0;
    });
    (gl.appendLedger as any).mockImplementation(() => {});
    onOpenChange.mockReset();
  });

  it('posts a balanced journal successfully', () => {
    render(<JournalPostingModal open onOpenChange={onOpenChange} />);
    const acct = screen.getByLabelText('Account code line 1');
    const desc = screen.getByLabelText('Description line 1');
    const debit = screen.getByLabelText('Debit line 1');
    const credit = screen.getByLabelText('Credit line 1');
    fireEvent.change(acct, { target: { value: '1000' } });
    fireEvent.change(desc, { target: { value: 'Cash Receipts' } });
    fireEvent.change(debit, { target: { value: '50' } });
    fireEvent.change(credit, { target: { value: '0' } });
    // add balancing line
    fireEvent.click(screen.getByText('Add Line'));
    const acct2 = screen.getByLabelText('Account code line 2');
    const desc2 = screen.getByLabelText('Description line 2');
    const debit2 = screen.getByLabelText('Debit line 2');
    const credit2 = screen.getByLabelText('Credit line 2');
    fireEvent.change(acct2, { target: { value: '1000' } });
    fireEvent.change(desc2, { target: { value: 'Cash Clearing' } });
    fireEvent.change(debit2, { target: { value: '0' } });
    fireEvent.change(credit2, { target: { value: '50' } });

    fireEvent.click(screen.getByText('Post Journal'));
    expect(gl.appendLedger).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks unbalanced entries', () => {
    render(<JournalPostingModal open onOpenChange={onOpenChange} />);
    const acct = screen.getByLabelText('Account code line 1');
    const debit = screen.getByLabelText('Debit line 1');
    fireEvent.change(acct, { target: { value: '1000' } });
    fireEvent.change(debit, { target: { value: '10' } });
    const postBtn = screen.getByText('Post Journal');
    expect(postBtn).toBeDisabled();
    expect(gl.appendLedger).not.toHaveBeenCalled();
  });

  it('blocks invalid account codes', () => {
    (gl.getAccounts as any).mockReturnValue([{ id: '2000', name: 'AR', category: 'Asset' }]);
    render(<JournalPostingModal open onOpenChange={onOpenChange} />);
    const acct = screen.getByLabelText('Account code line 1');
    const debit = screen.getByLabelText('Debit line 1');
    const credit = screen.getByLabelText('Credit line 1');
    fireEvent.change(acct, { target: { value: '9999' } });
    fireEvent.change(debit, { target: { value: '10' } });
    fireEvent.change(credit, { target: { value: '10' } });
    fireEvent.click(screen.getByText('Post Journal'));
    expect(gl.appendLedger).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Invalid accounts');
  });
});
