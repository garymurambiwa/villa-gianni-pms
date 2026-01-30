import React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from './command';
import { Button } from './button';
import { ChevronDown } from 'lucide-react';
import { ORIGIN_REGIONS } from '@/data/regions';

interface OriginRegionSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export const OriginRegionSelect: React.FC<OriginRegionSelectProps> = ({ value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [queryInput, setQueryInput] = React.useState('');
  const [activeLetter, setActiveLetter] = React.useState<string>('');
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const [activeDescendant, setActiveDescendant] = React.useState<string>('');
  const seqRef = React.useRef<{ text: string; ts: number; index: number }>({ text: '', ts: 0, index: 0 });
  const listboxId = 'origin-region-listbox';

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 150);
    return () => clearTimeout(t);
  }, [queryInput]);

  const filtered = ORIGIN_REGIONS
    .filter(r => r.toLowerCase().includes(query.toLowerCase()))
    .filter(r => activeLetter ? r.toLowerCase().startsWith(activeLetter.toLowerCase()) : true)
    .sort((a,b)=> a.localeCompare(b));
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

  React.useEffect(() => {
    if (open) {
      setTimeout(() => { try { listRef.current?.focus(); } catch {} }, 10);
    }
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      const currentIndex = (() => {
        if (!activeDescendant) return -1;
        const idPrefix = 'origin-';
        const idx = filtered.findIndex(r => `origin-${r.replace(/[^a-z0-9]+/gi,'-')}` === activeDescendant);
        return idx;
      })();
      if (e.key === 'ArrowDown') {
        const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, filtered.length - 1);
        const target = filtered[next];
        if (target) {
          const id = `origin-${target.replace(/[^a-z0-9]+/gi,'-')}`;
          setActiveDescendant(id);
          const el = itemRefs.current.get(id);
          if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} }
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        const prev = currentIndex < 0 ? filtered.length - 1 : Math.max(currentIndex - 1, 0);
        const target = filtered[prev];
        if (target) {
          const id = `origin-${target.replace(/[^a-z0-9]+/gi,'-')}`;
          setActiveDescendant(id);
          const el = itemRefs.current.get(id);
          if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} }
        }
        return;
      }
      if (e.key === 'Home') {
        const target = filtered[0];
        if (target) {
          const id = `origin-${target.replace(/[^a-z0-9]+/gi,'-')}`;
          setActiveDescendant(id);
          const el = itemRefs.current.get(id);
          if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} }
        }
        return;
      }
      if (e.key === 'End') {
        const target = filtered[filtered.length - 1];
        if (target) {
          const id = `origin-${target.replace(/[^a-z0-9]+/gi,'-')}`;
          setActiveDescendant(id);
          const el = itemRefs.current.get(id);
          if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} }
        }
        return;
      }
      if (e.key === 'Enter') {
        if (activeDescendant) {
          const match = filtered.find(r => `origin-${r.replace(/[^a-z0-9]+/gi,'-')}` === activeDescendant);
          if (match) { onChange(match); setOpen(false); }
        }
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    const k = e.key;
    if (!/^([a-zA-Z])$/.test(k)) return;
    e.preventDefault();
    const now = Date.now();
    const L = k.toUpperCase();
    let text = L;
    if (now - seqRef.current.ts < 600) {
      text = `${seqRef.current.text}${L}`;
    }
    const all = filtered;
    let matches = all.filter(r => r.toUpperCase().startsWith(text));
    if (matches.length === 0) {
      matches = all.filter(r => r.toUpperCase().startsWith(L));
      text = L;
    }
    if (matches.length === 0) return;
    let idx = 0;
    if (text === seqRef.current.text && now - seqRef.current.ts < 600) {
      idx = (seqRef.current.index + 1) % matches.length;
    }
    seqRef.current = { text, ts: now, index: idx };
    const target = matches[idx];
    const id = `origin-${target.replace(/[^a-z0-9]+/gi,'-')}`;
    setActiveDescendant(id);
    const el = itemRefs.current.get(id);
    if (el) {
      try { el.focus(); } catch {}
      try { el.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  };

  return (
    <div className="mb-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">Country/Region of Origin *</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="none"
            dir="ltr"
            data-state={open ? 'open' : 'closed'}
            className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 transition-colors w-full"
          >
            <span style={{ pointerEvents: 'none' }}>{value || 'Select origin region'}</span>
            <ChevronDown
              className="h-4 w-4 opacity-50 transition-transform duration-200 ease-in-out"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[26rem]">
          <Command>
            <CommandInput
              placeholder="Search regions..."
              value={queryInput}
              onValueChange={setQueryInput}
            />
            
            <CommandList
              role="listbox"
              aria-activedescendant={activeDescendant}
              id={listboxId}
              tabIndex={0}
              ref={listRef as any}
              onKeyDown={onKeyDown}
              className="outline-none"
            >
              <CommandEmpty>No region found.</CommandEmpty>
              {filtered.map((region) => {
                const id = `origin-${region.replace(/[^a-z0-9]+/gi,'-')}`;
                return (
                  <CommandItem
                    id={id}
                    key={region}
                    ref={(el: any) => { if (el) itemRefs.current.set(id, el as HTMLElement); else itemRefs.current.delete(id); }}
                    onSelect={() => {
                      onChange(region);
                      setOpen(false);
                    }}
                    aria-selected={activeDescendant === id}
                    className={`${activeLetter && region.toUpperCase().startsWith(activeLetter.toUpperCase()) ? 'bg-primary/10' : ''}`}
                  >
                    {region}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default OriginRegionSelect;
