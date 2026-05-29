/**
 * TransactionFilterBar – the single, shared filter row used by every
 * transaction-list module so the UI/UX is identical across the system.
 *
 * Controls (any can be hidden per module via `show`):
 *   Search · From date · To date · Category · Department · Status · Print
 *
 * Pairs with src/lib/transactionFilters.ts (filterRows + printTransactionList).
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TransactionFilterValue } from '@/lib/transactionFilters';
import { isFilterActive, EMPTY_TRANSACTION_FILTER } from '@/lib/transactionFilters';

export interface FilterOption {
  value: string;
  label: string;
}

export interface TransactionFilterBarProps {
  value: TransactionFilterValue;
  onChange: (next: TransactionFilterValue) => void;
  /** Which controls to render. Omitted keys default to true. */
  show?: {
    search?: boolean;
    date?: boolean;
    category?: boolean;
    department?: boolean;
    status?: boolean;
  };
  categories?: (string | FilterOption)[];
  departments?: (string | FilterOption)[];
  statuses?: (string | FilterOption)[];
  searchPlaceholder?: string;
  /** Prints the currently-filtered list. */
  onPrint?: () => void;
  printLabel?: string;
  /** e.g. a "+ New …" button rendered on the left. */
  leftActions?: React.ReactNode;
  /** e.g. Export CSV rendered on the right next to Print. */
  rightActions?: React.ReactNode;
  /** Shows "N shown" next to the controls. */
  resultCount?: number;
  className?: string;
}

const norm = (o: string | FilterOption): FilterOption =>
  typeof o === 'string' ? { value: o, label: o } : o;

export const TransactionFilterBar: React.FC<TransactionFilterBarProps> = ({
  value,
  onChange,
  show,
  categories,
  departments,
  statuses,
  searchPlaceholder = 'Search…',
  onPrint,
  printLabel = 'Print',
  leftActions,
  rightActions,
  resultCount,
  className,
}) => {
  const s = { search: true, date: true, category: true, department: true, status: true, ...(show || {}) };
  const set = (patch: Partial<TransactionFilterValue>) => onChange({ ...value, ...patch });
  const active = isFilterActive(value);

  const catOpts = (categories || []).map(norm);
  const deptOpts = (departments || []).map(norm);
  const statusOpts = (statuses || []).map(norm);

  return (
    <div className={`flex flex-wrap items-end gap-3 ${className || ''}`}>
      {leftActions && <div className="flex items-end gap-2">{leftActions}</div>}

      {s.search && (
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs text-gray-500 mb-1 block">Search</Label>
          <Input
            value={value.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={searchPlaceholder}
          />
        </div>
      )}

      {s.date && (
        <>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">From</Label>
            <Input
              type="date"
              value={value.from}
              onChange={(e) => set({ from: e.target.value })}
              className="w-[150px]"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1 block">To</Label>
            <Input
              type="date"
              value={value.to}
              onChange={(e) => set({ to: e.target.value })}
              className="w-[150px]"
            />
          </div>
        </>
      )}

      {s.category && catOpts.length > 0 && (
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Category</Label>
          <Select value={value.category || 'all'} onValueChange={(v) => set({ category: v })}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="All Categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {catOpts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {s.department && deptOpts.length > 0 && (
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Department</Label>
          <Select value={value.department || 'all'} onValueChange={(v) => set({ department: v })}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {deptOpts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {s.status && statusOpts.length > 0 && (
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Status</Label>
          <Select value={value.status || 'all'} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statusOpts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-end gap-2 ml-auto">
        {active && (
          <Button
            type="button"
            variant="ghost"
            className="text-xs text-gray-500 h-9"
            onClick={() => onChange({ ...EMPTY_TRANSACTION_FILTER })}
          >
            Clear
          </Button>
        )}
        {typeof resultCount === 'number' && (
          <span className="text-xs text-gray-400 pb-2 whitespace-nowrap">{resultCount} shown</span>
        )}
        {onPrint && (
          <Button type="button" variant="outline" onClick={onPrint} className="whitespace-nowrap">
            {printLabel}
          </Button>
        )}
        {rightActions}
      </div>
    </div>
  );
};

export default TransactionFilterBar;
