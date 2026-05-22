import React, { useState, useEffect, useRef, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './VirtualKeyboard.css';

// Inputs that should NOT trigger the keyboard
const SKIP_TYPES = new Set(['file', 'checkbox', 'radio', 'submit', 'button', 'image', 'range', 'color']);
// CSS class to opt-out of keyboard on a specific input
const OPT_OUT_CLASS = 'no-vkb';

const MARGIN = 12;           // gap between input and keyboard

export const VirtualKeyboard: React.FC = () => {
  const [show, setShow]               = useState(false);
  const [layoutName, setLayoutName]   = useState('default');
  const [input, setInput]             = useState('');
  const [position, setPosition]       = useState({ x: 0, bottom: 0 });
  const [isDragging, setIsDragging]   = useState(false);
  const [isResizing, setIsResizing]   = useState(false);
  const [dragStart, setDragStart]     = useState({ x: 0, y: 0 });
  const [manualPos, setManualPos]     = useState<{ x: number; y: number } | null>(null);
  const [size, setSize]               = useState<{ width: number; height: number }>(() => {
    try {
      const raw = localStorage.getItem('corepms_vkb_size');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
      }
    } catch {}
    return { width: 760, height: 280 };
  });

  const activeInputRef  = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const keyboardRef     = useRef<any>(null);
  const wrapperRef      = useRef<HTMLDivElement>(null);

  // ── Position keyboard above or below the focused input, never covering it ──
  const positionNearInput = useCallback((el: HTMLElement) => {
    if (manualPos) return; // user dragged it — respect that
    const rect   = el.getBoundingClientRect();
    const vw     = window.innerWidth;
    const vh     = window.innerHeight;
    const kbW    = Math.min(size.width, vw - 16);
    const kbH    = size.height;

    let x = Math.max(8, Math.min(rect.left, vw - kbW - 8));

    // Prefer above the input; if not enough room, show below
    const spaceAbove = rect.top - MARGIN;
    const spaceBelow = vh - rect.bottom - MARGIN;

    let y: number;
    if (spaceAbove >= kbH) {
      y = rect.top - kbH - MARGIN;
    } else if (spaceBelow >= kbH) {
      y = rect.bottom + MARGIN;
    } else {
      // Not enough room either side — position at bottom, scroll input into view
      y = Math.max(8, vh - kbH - 8);
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    }

    setPosition({ x, bottom: y });
  }, [manualPos, size.width, size.height]);

  // ── Resize support ────────────────────────────────────────────────────────
  const onResizeMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setSize(prev => {
        const next = {
          width: Math.max(320, Math.min(window.innerWidth - 16, prev.width + dx)),
          height: Math.max(160, Math.min(window.innerHeight - 16, prev.height + dy)),
        };
        try { localStorage.setItem('corepms_vkb_size', JSON.stringify(next)); } catch {}
        return next;
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, dragStart]);

  // ── Focus listener — track active input but do NOT auto-show ─────────────
  // Keyboard only appears when user manually clicks the toggle button.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLInputElement;
      if (!target) return;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
      if (SKIP_TYPES.has((target.type || '').toLowerCase())) return;
      if (target.classList.contains(OPT_OUT_CLASS)) return;
      if (target.readOnly || target.disabled) return;

      // Track which input is active so keyboard types into it when shown
      activeInputRef.current = target;
      const val = target.value || '';
      setInput(val);
      if (keyboardRef.current) keyboardRef.current.setInput(val);
      // Reposition keyboard near the newly focused input (only if already visible)
      if (show) positionNearInput(target);
    };

    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [show, positionNearInput]);

  // ── Keyboard → input sync ─────────────────────────────────────────────────
  const onChange = useCallback((val: string) => {
    setInput(val);
    const el = activeInputRef.current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (setter) setter.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, []);

  const onKeyPress = useCallback((button: string) => {
    if (button === '{shift}' || button === '{lock}') {
      setLayoutName(n => n === 'default' ? 'shift' : 'default');
    }
    if (button === '{enter}') {
      activeInputRef.current?.blur();
      setShow(false);
    }
    if (button === '{close}') {
      setShow(false);
    }
  }, []);

  // ── Drag support ──────────────────────────────────────────────────────────
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    e.preventDefault();
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setManualPos(prev => {
        const base = prev ?? { x: position.x, y: position.bottom };
        return { x: base.x + dx, y: base.y + dy };
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, dragStart, position]);

  const kbStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex:   99999,
    left:     manualPos?.x ?? position.x,
    top:      manualPos?.y ?? position.bottom,
    width:    Math.min(size.width, window.innerWidth - 16),
    height:   size.height,
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
    borderRadius: 10,
    overflow: 'hidden',
    background: '#1e293b',
    userSelect: 'none',
  };

  return (
    <>
      {/* Toggle button — bottom-left, subtle */}
      <button
        className="fixed bottom-4 left-4 z-[9990] bg-slate-800 text-white p-2.5 rounded-full shadow-lg hover:bg-slate-700 transition-all active:scale-95 opacity-70 hover:opacity-100"
        onClick={() => {
          setShow(v => !v);
          setManualPos(null); // reset dragged position
        }}
        title="Toggle Virtual Keyboard (Alt+K)"
        aria-label="Toggle virtual keyboard"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" />
        </svg>
      </button>

      {show && (
        <div ref={wrapperRef} style={kbStyle} onMouseDown={e => e.preventDefault()}>
          {/* Drag handle header */}
          <div
            style={{ background: '#0f172a', padding: '6px 12px', cursor: 'move', display: 'flex',
                     alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #334155' }}
            onMouseDown={onHeaderMouseDown}
          >
            <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em' }}>
              ⌨ VIRTUAL KEYBOARD
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setManualPos(null); if (activeInputRef.current) positionNearInput(activeInputRef.current); }}
                style={{ fontSize: 10, color: '#64748b', background: '#1e293b', border: 'none',
                         cursor: 'pointer', padding: '2px 6px', borderRadius: 3 }}
                title="Reset position">⟲
              </button>
              <button
                onClick={() => setShow(false)}
                style={{ fontSize: 11, color: '#ef4444', background: '#1e293b', border: 'none',
                         cursor: 'pointer', padding: '2px 8px', borderRadius: 3, fontWeight: 700 }}>✕
              </button>
            </div>
          </div>

          <div style={{ padding: '6px 8px 8px', height: 'calc(100% - 36px)', overflow: 'hidden' }}>
            <Keyboard
              keyboardRef={r => (keyboardRef.current = r)}
              layoutName={layoutName}
              onChange={onChange}
              onKeyPress={onKeyPress}
              inputName="default"
              display={{
                '{bksp}':  '⌫',
                '{enter}': '↵ Done',
                '{shift}': '⇧',
                '{space}': 'Space',
                '{lock}':  '⇪',
                '{tab}':   '⇥',
                '{close}': '✕ Close',
              }}
              layout={{
                default: [
                  '1 2 3 4 5 6 7 8 9 0 - = {bksp}',
                  '{tab} q w e r t y u i o p [ ] \\',
                  '{lock} a s d f g h j k l ; \' {enter}',
                  '{shift} z x c v b n m , . / {shift}',
                  '@ {space} .com {close}',
                ],
                shift: [
                  '! @ # $ % ^ & * ( ) _ + {bksp}',
                  '{tab} Q W E R T Y U I O P { } |',
                  '{lock} A S D F G H J K L : " {enter}',
                  '{shift} Z X C V B N M < > ? {shift}',
                  '@ {space} .com {close}',
                ],
              }}
              theme="hg-theme-default hg-layout-default myVKB"
              buttonTheme={[
                { class: 'hg-red',  buttons: '{close}' },
                { class: 'hg-blue', buttons: '{enter}' },
                { class: 'hg-dark', buttons: '{bksp} {shift} {lock} {tab} {space}' },
              ]}
            />
          </div>

          {/* Resize handle — bottom-right corner */}
          <div
            onMouseDown={onResizeMouseDown}
            style={{
              position: 'absolute', right: 0, bottom: 0, width: 18, height: 18,
              cursor: 'nwse-resize', background: 'transparent',
              borderRight: '3px solid #475569', borderBottom: '3px solid #475569',
              borderBottomRightRadius: 8,
            }}
            title="Drag to resize"
          />
        </div>
      )}

      <style>{`
        .myVKB { background: #1e293b; border-radius: 0; }
        .myVKB .hg-button { background: #334155; color: #e2e8f0; border: 1px solid #475569;
                            border-radius: 5px; font-size: 13px; height: 38px; }
        .myVKB .hg-button:hover { background: #475569; }
        .myVKB .hg-button:active { background: #64748b; }
        .myVKB .hg-button.hg-red  { background: #7f1d1d; color: #fca5a5; }
        .myVKB .hg-button.hg-blue { background: #1e3a5f; color: #93c5fd; min-width: 80px; }
        .myVKB .hg-button.hg-dark { background: #1e293b; color: #94a3b8; }
        .myVKB .hg-row { gap: 4px; margin-bottom: 4px; }
      `}</style>
    </>
  );
};

export default VirtualKeyboard;
