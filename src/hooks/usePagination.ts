/**
 * usePagination – the single, shared client-side pagination hook used by every
 * long list so the behaviour is identical across the system.
 *
 * Feed it the already-filtered/sorted array; it returns the current page's
 * slice plus everything <PaginationBar/> needs to render. Page auto-clamps when
 * the source list shrinks (e.g. a filter is applied), so you never end up
 * stranded on an empty page.
 *
 *   const pg = usePagination(filteredRows);
 *   pg.pageItems.map(...)            // render only the current page
 *   <PaginationBar {...pg} itemLabel="accounts" />
 */
import { useEffect, useMemo, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export interface PaginationState<T> {
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  totalPages: number;
  total: number;
  pageItems: T[];
  /** 1-based index of the first item shown (0 when the list is empty). */
  from: number;
  /** 1-based index of the last item shown. */
  to: number;
}

export function usePagination<T>(items: T[], initialPageSize: number = 25): PaginationState<T> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Effective page can never exceed the current page count. Using a derived
  // value (instead of waiting for the effect below) avoids a one-frame flash of
  // an empty page right after the list shrinks.
  const safePage = Math.min(page, totalPages);

  // Keep state in sync with the clamped value (e.g. filters cut the list down).
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const setPageSize = (n: number) => {
    setPageSizeRaw(n);
    setPage(1);
  };

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return {
    page: safePage,
    pageSize,
    setPage,
    setPageSize,
    totalPages,
    total,
    pageItems,
    from,
    to,
  };
}

export default usePagination;
