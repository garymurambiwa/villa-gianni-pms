import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ReportItem = { key: string; name: string };

interface ReportsDropdownProps {
  id?: string;
  reports: ReportItem[];
  selectedKey?: string;
  onChange?: (key: string) => void;
  persistKey?: string; // localStorage key to persist selection
}

/**
 * Accessible dropdown for selecting reports with optional search when the list is long.
 * - Alphabetical ordering
 * - Single selection, shows current selection
 * - Keyboard navigation (Up/Down/Enter/Escape)
 * - ARIA roles and attributes
 * - Optional persistence via localStorage
 */
export const ReportsDropdown: React.FC<ReportsDropdownProps> = ({ id = 'reportsDropdown', reports, selectedKey, onChange, persistKey = 'corepms_selected_report' }) => {
  const sorted = React.useMemo(() => reports.slice().sort((a, b) => a.name.localeCompare(b.name)), [reports]);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [hoverIndex, setHoverIndex] = React.useState<number>(-1);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listId = `${id}-listbox`;
  const [value, setValue] = React.useState<string>(() => {
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('report');
      if (fromUrl) return fromUrl;
      const persisted = localStorage.getItem(persistKey);
      if (persisted) return persisted;
      return selectedKey || (sorted[0]?.key || '');
    } catch { return selectedKey || (sorted[0]?.key || ''); }
  });

  React.useEffect(() => {
    try { localStorage.setItem(persistKey, value); } catch {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('report', value);
      window.history.replaceState({}, '', url.toString());
    } catch {}
    onChange?.(value);
  }, [value]);

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter(r => r.name.toLowerCase().includes(term));
  }, [sorted, search]);

  const selectedLabel = React.useMemo(() => sorted.find(r => r.key === value)?.name || 'Select report', [sorted, value]);

  const onKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); setOpen(true); setHoverIndex(0);
      return;
    }
    if (open) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIndex(i => Math.min((i < 0 ? 0 : i) + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIndex(i => Math.max((i < 0 ? 0 : i) - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); const item = filtered[Math.max(hoverIndex, 0)]; if (item) { setValue(item.key); setOpen(false); } }
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <label htmlFor={id} className="sr-only">Select Report</label>
      <Button
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        role="combobox"
        onKeyDown={onKeyDown}
        onClick={() => setOpen(o => !o)}
        className="bg-red-600 text-white hover:bg-red-700"
      >
        {selectedLabel}
      </Button>

      {open && (
        <div className="absolute z-50 mt-2 w-64 bg-white border rounded-md shadow-lg" role="dialog" aria-modal="false">
          {sorted.length > 20 && (
            <div className="p-2 border-b">
              <label className="sr-only" htmlFor={`${id}-search`}>Search reports</label>
              <Input id={`${id}-search`} placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label="Available reports" className="max-h-64 overflow-auto">
            {filtered.map((r, idx) => {
              const selected = r.key === value;
              const hovered = idx === hoverIndex;
              return (
                <li
                  key={r.key}
                  role="option"
                  aria-selected={selected}
                  className={`px-3 py-2 text-sm cursor-pointer ${selected ? 'bg-blue-50 text-blue-700 font-semibold' : ''} ${hovered ? 'bg-gray-100' : ''}`}
                  onMouseEnter={() => setHoverIndex(idx)}
                  onClick={() => { setValue(r.key); setOpen(false); }}
                >
                  {r.name}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-600" aria-disabled="true">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ReportsDropdown;
