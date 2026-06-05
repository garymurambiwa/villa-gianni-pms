/**
 * PaginationBar – the single, shared pagination footer used by every long list
 * so the UI/UX is identical across the system.
 *
 *   Showing 1–25 of 312 accounts        Rows: [25 ▾]  ‹ Prev  Page 1 of 13  Next ›
 *
 * Pairs with src/hooks/usePagination.ts – spread the hook's return value in:
 *   const pg = usePagination(rows);
 *   <PaginationBar {...pg} itemLabel="accounts" />
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@/hooks/usePagination';

export interface PaginationBarProps {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  /** Page-size choices. Defaults to [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
  /** Plural noun for the count text, e.g. "accounts", "expenses". */
  itemLabel?: string;
  className?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  page,
  pageSize,
  totalPages,
  total,
  from,
  to,
  setPage,
  setPageSize,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel = 'items',
  className,
}) => {
  if (total === 0) return null;

  // Make sure the current size is always selectable even if it isn't a preset.
  const sizeOptions = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-gray-600 ${className || ''}`}
    >
      <div className="whitespace-nowrap">
        Showing <span className="font-medium text-gray-800">{from}–{to}</span> of{' '}
        <span className="font-medium text-gray-800">{total}</span> {itemLabel}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 whitespace-nowrap">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Prev</span>
          </Button>
          <span className="px-2 whitespace-nowrap">
            Page <span className="font-medium text-gray-800">{page}</span> of {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-2"
            disabled={page >= totalPages}
            onClick={() => setPage(Math.min(totalPages, page + 1))}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaginationBar;
