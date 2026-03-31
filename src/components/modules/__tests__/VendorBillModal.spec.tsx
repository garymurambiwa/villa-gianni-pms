/**
 * VendorBillModal.spec.tsx
 *
 * Tests for BillDetailModal void/delete eligibility rules.
 * Covers the business logic: which statuses allow void, which allow delete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BillDetailModal } from '@/components/modules/BillDetailModal';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Build a minimal InvoiceGroup for testing */
function makeGroup(overrides: Partial<{
  status: string;
  void_status: string;
  voided_reason: string;
  voided_at: string;
}> = {}) {
  const { status = 'pending', void_status = 'ACTIVE', voided_reason, voided_at } = overrides;
  return {
    referenceNumber: 'INV-TEST-001',
    vendorName: 'Test Vendor',
    department: 'Administration',
    totalAmount: 1000,
    netAmount: 1000,
    date: '2026-03-19',
    status,
    lines: [
      {
        id: 'EXP001',
        vendor_id: 'V001',
        vendor_name: 'Test Vendor',
        description: 'Office Supplies',
        quantity: 2,
        unit_cost: 500,
        total_cost: 1000,
        tax_amount: 150,
        tax_rate: 15,
        tax_inclusive: false,
        expense_date: '2026-03-19',
        reference_number: 'INV-TEST-001',
        category: 'Supplies',
        department: 'Administration',
        status,
        void_status,
        voided_reason,
        voided_at,
        is_credit_note: false,
        created_at: '2026-03-19T00:00:00',
      },
    ],
    creditNotes: [],
  };
}

const noop = vi.fn();

/* -------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* -------------------------------------------------------------------------- */

describe('BillDetailModal — Void button eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Void button for a pending ACTIVE invoice', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.getByRole('button', { name: /void invoice/i })).toBeTruthy();
  });

  it('shows Void button for an approved ACTIVE invoice', () => {
    const group = makeGroup({ status: 'approved', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.getByRole('button', { name: /void invoice/i })).toBeTruthy();
  });

  it('does NOT show Void button for a paid invoice', () => {
    const group = makeGroup({ status: 'paid', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.queryByRole('button', { name: /void invoice/i })).toBeNull();
  });

  it('does NOT show Void button when already VOIDED', () => {
    const group = makeGroup({ status: 'voided', void_status: 'VOIDED', voided_reason: 'Duplicate' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.queryByRole('button', { name: /void invoice/i })).toBeNull();
  });

  it('shows reason textarea after clicking Void Invoice', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    fireEvent.click(screen.getByRole('button', { name: /void invoice/i }));
    expect(screen.getByPlaceholderText(/duplicate invoice/i)).toBeTruthy();
  });

  it('Confirm Void button is disabled when reason is empty', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    fireEvent.click(screen.getByRole('button', { name: /void invoice/i }));
    const confirmBtn = screen.getByRole('button', { name: /confirm void/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Confirm Void button becomes enabled after entering a reason', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    fireEvent.click(screen.getByRole('button', { name: /void invoice/i }));
    const textarea = screen.getByPlaceholderText(/duplicate invoice/i);
    fireEvent.change(textarea, { target: { value: 'Duplicate invoice received' } });
    const confirmBtn = screen.getByRole('button', { name: /confirm void/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows voided banner with reason when invoice is already voided', () => {
    const group = makeGroup({ status: 'voided', void_status: 'VOIDED', voided_reason: 'Duplicate entry' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.getByText(/duplicate entry/i)).toBeTruthy();
  });
});

describe('BillDetailModal — Delete button eligibility', () => {
  it('shows Delete button for a pending ACTIVE invoice', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
  });

  it('does NOT show Delete button for a paid invoice', () => {
    const group = makeGroup({ status: 'paid', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('does NOT show Delete button for an approved invoice', () => {
    const group = makeGroup({ status: 'approved', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('does NOT show Delete button for a voided invoice', () => {
    const group = makeGroup({ status: 'voided', void_status: 'VOIDED' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('shows DELETE confirmation input after clicking Delete', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.getByPlaceholderText(/type delete to confirm/i)).toBeTruthy();
  });

  it('Permanently Delete button is disabled until DELETE is typed', () => {
    const group = makeGroup({ status: 'pending', void_status: 'ACTIVE' });
    render(
      <BillDetailModal group={group} open={true} onClose={noop} onVoidExpense={noop} onDeleteExpense={noop} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    const confirmBtn = screen.getByRole('button', { name: /permanently delete/i });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
