import React, { useEffect, useMemo, useState } from 'react';
import { Country, fetchCountries, codeToFlag, DEFAULT_COUNTRIES } from '@/lib/countries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface NationalitySelectProps {
  value?: string; // ISO code
  onChange: (code: string, country?: Country) => void;
  label?: string;
  required?: boolean;
}

export const NationalitySelect: React.FC<NationalitySelectProps> = ({ value, onChange, label = 'Nationality', required }) => {
  const [countries, setCountries] = useState<Country[]>(DEFAULT_COUNTRIES.map(c => ({ ...c, flag: codeToFlag(c.code) })));
  const [loading, setLoading] = useState<boolean>(true);
  const [activeLetter, setActiveLetter] = useState<string>('');
  const [open, setOpen] = useState<boolean>(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const [activeDescendant, setActiveDescendant] = useState<string>('');
  const seqRef = React.useRef<{ text: string; ts: number; index: number }>({ text: '', ts: 0, index: 0 });
  useEffect(() => {
    let mounted = true;
    (async () => {
      const list = await fetchCountries();
      if (mounted) { setCountries(list); setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const options = useMemo(() => {
    const sorted = [...countries].sort((a, b) => a.name.localeCompare(b.name));
    if (!activeLetter) return sorted;
    const L = activeLetter.toUpperCase();
    return sorted.filter(c => (c.name || '').toUpperCase().startsWith(L));
  }, [countries, activeLetter]);

  const current = options.find(c => c.code === (value || '').toUpperCase());
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required ? ' *' : ''}</label>}
      
      <Select value={value || ''} onValueChange={(code) => {
        const country = options.find(c => c.code === code);
        onChange(code, country);
      }} open={open} onOpenChange={setOpen}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loading ? 'Loading countries…' : 'Select nationality'} />
        </SelectTrigger>
        <SelectContent ref={contentRef} onKeyDownCapture={(e) => {
          const k = e.key;
          if (!open) return;
          if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End' || k === 'Enter' || k === 'Escape') {
            e.preventDefault();
            const currentIndex = (() => {
              if (!activeDescendant) return -1;
              const code = activeDescendant.replace(/^nat-/, '');
              return options.findIndex(c => c.code === code);
            })();
            if (k === 'ArrowDown') {
              const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, options.length - 1);
              const target = options[next];
              if (target) {
                const id = `nat-${target.code}`;
                setActiveDescendant(id);
                const el = itemRefs.current.get(id);
                if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} try { contentRef.current?.setAttribute('aria-activedescendant', id); } catch {} }
              }
              return;
            }
            if (k === 'ArrowUp') {
              const prev = currentIndex < 0 ? options.length - 1 : Math.max(currentIndex - 1, 0);
              const target = options[prev];
              if (target) {
                const id = `nat-${target.code}`;
                setActiveDescendant(id);
                const el = itemRefs.current.get(id);
                if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} try { contentRef.current?.setAttribute('aria-activedescendant', id); } catch {} }
              }
              return;
            }
            if (k === 'Home') {
              const target = options[0];
              if (target) {
                const id = `nat-${target.code}`;
                setActiveDescendant(id);
                const el = itemRefs.current.get(id);
                if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} try { contentRef.current?.setAttribute('aria-activedescendant', id); } catch {} }
              }
              return;
            }
            if (k === 'End') {
              const target = options[options.length - 1];
              if (target) {
                const id = `nat-${target.code}`;
                setActiveDescendant(id);
                const el = itemRefs.current.get(id);
                if (el) { try { el.focus(); } catch {} try { el.scrollIntoView({ block: 'nearest' }); } catch {} try { contentRef.current?.setAttribute('aria-activedescendant', id); } catch {} }
              }
              return;
            }
            if (k === 'Enter') {
              if (activeDescendant) {
                const code = activeDescendant.replace(/^nat-/, '');
                const target = countries.find(c => c.code === code) || options.find(c => c.code === code);
                if (target) { onChange(target.code, target); setOpen(false); }
              }
              return;
            }
            if (k === 'Escape') { setOpen(false); return; }
          }
          if (!/^([a-zA-Z])$/.test(k)) return;
          e.preventDefault();
          const now = Date.now();
          const L = k.toUpperCase();
          let text = L;
          if (now - seqRef.current.ts < 600) {
            text = `${seqRef.current.text}${L}`;
          }
          const all = [...countries].sort((a,b)=> a.name.localeCompare(b.name));
          let matches = all.filter(c => (c.name || '').toUpperCase().startsWith(text));
          if (matches.length === 0) {
            matches = all.filter(c => (c.name || '').toUpperCase().startsWith(L));
            text = L;
          }
          if (matches.length === 0) return;
          let idx = 0;
          if (text === seqRef.current.text && now - seqRef.current.ts < 600) {
            idx = (seqRef.current.index + 1) % matches.length;
          }
          seqRef.current = { text, ts: now, index: idx };
          const target = matches[idx];
          const id = `nat-${target.code}`;
          setActiveDescendant(id);
          const el = itemRefs.current.get(id);
          if (el) {
            try { el.focus(); } catch {}
            try { el.scrollIntoView({ block: 'nearest' }); } catch {}
            try { contentRef.current?.setAttribute('aria-activedescendant', id); } catch {}
          }
        }}>
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500" role="status">No nationalities for {activeLetter}</div>
          )}
          {options.map(c => (
            <SelectItem
              id={`nat-${c.code}`}
              key={c.code}
              value={c.code}
              aria-label={`${c.name} (${c.code})`}
              ref={(el: any) => { if (el) itemRefs.current.set(`nat-${c.code}`, el as HTMLElement); else itemRefs.current.delete(`nat-${c.code}`); }}
              className={`${activeLetter && c.name.toUpperCase().startsWith(activeLetter.toUpperCase()) ? 'bg-primary/10' : ''}`}
            >
              <span className="mr-2" aria-hidden="true">{c.flag}</span>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current && (
        <p className="text-xs text-gray-500 mt-1">Selected: {current.flag} {current.name}</p>
      )}
    </div>
  );
};

export default NationalitySelect;
