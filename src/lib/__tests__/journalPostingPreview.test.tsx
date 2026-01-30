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

describe('JournalPostingModal Category Preview', () => {
  beforeEach(() => {
    (gl.getAccounts as any).mockReturnValue([
      { id: '1000', name: 'Cash', category: 'Asset' },
      { id: '4000', name: 'Rooms Revenue', category: 'Revenue' },
    ]);
    (gl.isBalanced as any).mockReturnValue(true);
    (gl.appendLedger as any).mockImplementation(() => {});
  });

  it('aggregates debit/credit by account category', () => {
    render(<JournalPostingModal open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Account code line 1'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Debit line 1'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Credit line 1'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Add Line'));
    fireEvent.change(screen.getByLabelText('Account code line 2'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText('Debit line 2'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Credit line 2'), { target: { value: '25' } });

    expect(screen.getByText(/Asset/)).toBeInTheDocument();
    expect(screen.getByText(/Revenue/)).toBeInTheDocument();
    expect(screen.getByText(/Debit: \$25\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Credit: \$25\.00/)).toBeInTheDocument();
  });
});
