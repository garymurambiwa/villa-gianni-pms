import React from 'react';

type NavItem = { id: string; label: string };

interface HorizontalScrollNavProps {
  items: NavItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  ariaLabel?: string;
}

// A11Y-friendly horizontal scroll navigation with overflow arrows, touch support, and progress indicator
const HorizontalScrollNav: React.FC<HorizontalScrollNavProps> = ({ items, activeId, onSelect, ariaLabel = 'Horizontal navigation' }) => {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [focusIndex, setFocusIndex] = React.useState<number>(-1);

  const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));

  const updateState = React.useCallback(() => {
    const el = viewportRef.current; if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanPrev(scrollLeft > 0);
    setCanNext(scrollLeft + clientWidth < scrollWidth - 1);
    const max = Math.max(1, scrollWidth - clientWidth);
    setProgress(clamp(scrollLeft / max));
  }, []);

  React.useEffect(() => {
    const el = viewportRef.current; if (!el) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateState); };
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateState); };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    updateState();
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, [updateState]);

  const scrollByAmount = (dir: 'prev' | 'next') => {
    const el = viewportRef.current; if (!el) return;
    const delta = Math.max(160, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: dir === 'prev' ? -delta : delta, behavior: 'smooth' });
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollByAmount('next'); setFocusIndex(i => clamp(i + 1, -1, items.length - 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollByAmount('prev'); setFocusIndex(i => clamp(i - 1, -1, items.length - 1)); }
    else if ((e.key === 'Enter' || e.key === ' ') && focusIndex >= 0) { e.preventDefault(); const id = items[focusIndex]?.id; if (id) onSelect?.(id); }
  };

  React.useEffect(() => {
    if (focusIndex >= 0) {
      const el = viewportRef.current; if (!el) return;
      const btn = el.querySelectorAll<HTMLButtonElement>('[data-hsn-item]')[focusIndex];
      if (btn) { try { btn.focus(); } catch {} }
    }
  }, [focusIndex]);

  return (
    <div className="relative" role="region" aria-label={ariaLabel}>
      {/* Scroll viewport */}
      <div
        ref={viewportRef}
        className="overflow-x-auto whitespace-nowrap no-scrollbar pr-10 pl-10"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-roledescription="horizontal scroller"
        aria-live="polite"
        style={{ scrollBehavior: 'smooth', willChange: 'scroll-position' }}
      >
        {items.map((it, idx) => {
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              data-hsn-item
              role="tab"
              aria-selected={active}
              aria-label={it.label}
              className={`inline-flex items-center justify-center rounded border text-sm px-3 py-2 mr-2 ${active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => onSelect?.(it.id)}
              onFocus={() => setFocusIndex(idx)}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      {/* Edge fades as indicator */}
      {canPrev && <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent" aria-hidden="true" />}
      {canNext && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" aria-hidden="true" />}

      {/* Nav buttons */}
      <div className="absolute inset-y-0 left-1 flex items-center">
        {canPrev && (
          <button
            type="button"
            aria-label="Scroll left"
            onClick={() => scrollByAmount('prev')}
            className="inline-flex items-center justify-center bg-white border rounded-full shadow w-8 h-8 hover:bg-gray-100"
          >
            ‹
          </button>
        )}
      </div>
      <div className="absolute inset-y-0 right-1 flex items-center">
        {canNext && (
          <button
            type="button"
            aria-label="Scroll right"
            onClick={() => scrollByAmount('next')}
            className="inline-flex items-center justify-center bg-white border rounded-full shadow w-8 h-8 hover:bg-gray-100"
          >
            ›
          </button>
        )}
      </div>

      {/* Progress indicator */}
      <div className="mt-2 h-1 bg-gray-200 rounded">
        <div className="h-1 bg-blue-500 rounded" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
      </div>
    </div>
  );
};

export default HorizontalScrollNav;

