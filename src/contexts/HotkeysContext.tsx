import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export type Hotkey =
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12'
  | 'Shift+I';

type HotkeyHandler = () => void;

interface HotkeyConfig {
  tooltip: string;
  eventName?: string;
  handler?: HotkeyHandler;
}

interface HotkeysContextType {
  activeModule: string;
  setActiveModule: (m: string) => void;
  register: (key: Hotkey, config: HotkeyConfig, module?: string) => void;
  unregister: (key: Hotkey, module?: string) => void;
  getTooltip: (key: Hotkey) => string | undefined;
}

const HotkeysContext = createContext<HotkeysContextType | undefined>(undefined);

const DEFAULT_TOOLTIPS: Record<Hotkey, string> = {
  F1: 'Create new menu item',
  F2: 'Save current record',
  F3: 'Add new supplier',
  F4: 'Custom action 4',
  F5: 'Custom action 5',
  F6: 'Custom action 6',
  F7: 'Custom action 7',
  F8: 'Custom action 8',
  F9: 'Custom action 9',
  F10: 'Custom action 10',
  F11: 'Custom action 11',
  F12: 'Custom action 12',
  'Shift+I': 'Open Inventory Items Viewer'
};

function normalizeKey(e: KeyboardEvent): Hotkey | undefined {
  if (e.shiftKey && e.key.toUpperCase() === 'I') return 'Shift+I';
  const k = e.key.toUpperCase();
  if ((['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'] as const).includes(k as any)) return k as Hotkey;
  return undefined;
}

export const HotkeysProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();
  const [activeModule, setActiveModule] = useState<string>('dashboard');
  const registryRef = useRef<Map<string, Map<Hotkey, HotkeyConfig>>>(new Map());
  const globalRegistryRef = useRef<Map<Hotkey, HotkeyConfig>>(new Map());

  const loadGlobal = React.useCallback(() => {
    try {
      const raw = localStorage.getItem('corepms_hotkeys_global');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<Hotkey, { tooltip: string; eventName?: string }>;
        globalRegistryRef.current.clear();
        (Object.keys(DEFAULT_TOOLTIPS) as Hotkey[]).forEach(k => {
          globalRegistryRef.current.set(k, { tooltip: DEFAULT_TOOLTIPS[k] });
        });
        Object.entries(parsed).forEach(([key, val]) => {
          globalRegistryRef.current.set(key as Hotkey, { tooltip: val.tooltip, eventName: val.eventName });
        });
      } else {
        globalRegistryRef.current.clear();
        (Object.keys(DEFAULT_TOOLTIPS) as Hotkey[]).forEach(k => {
          globalRegistryRef.current.set(k, { tooltip: DEFAULT_TOOLTIPS[k] });
        });
      }
    } catch {}
  }, []);

  useEffect(() => { loadGlobal(); }, [loadGlobal]);

  useEffect(() => {
    const onUpdate = () => loadGlobal();
    window.addEventListener('hotkeys:update', onUpdate);
    return () => window.removeEventListener('hotkeys:update', onUpdate);
  }, [loadGlobal]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hk = normalizeKey(e);
      if (!hk) return;
      // prevent default so function keys don't open browser help menu
      e.preventDefault();
      let fired = false;
      const moduleReg = registryRef.current.get(activeModule);
      const cfg = moduleReg?.get(hk) || globalRegistryRef.current.get(hk);
      if (cfg && cfg.handler) {
        try {
          cfg.handler();
          fired = true;
        } catch (err) {
          console.error('Hotkey handler error', err);
        }
      }
      // Dispatch generic and named events to allow modules to hook into shortcuts
      try {
        const generic = new CustomEvent('hotkey', { detail: { key: hk, module: activeModule } });
        window.dispatchEvent(generic);
        if (cfg?.eventName) {
          const named = new CustomEvent(cfg.eventName, { detail: { key: hk, module: activeModule } });
          window.dispatchEvent(named);
        }
      } catch {}
      const tip = cfg?.tooltip || DEFAULT_TOOLTIPS[hk];
      toast({ title: `Shortcut: ${hk}`, description: tip || 'Shortcut', duration: fired ? 1400 : 1200 });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeModule, toast]);

  const register = (key: Hotkey, config: HotkeyConfig, module?: string) => {
    const bucket = module ? (registryRef.current.get(module) || new Map()) : globalRegistryRef.current;
    if (module && !registryRef.current.has(module)) registryRef.current.set(module, bucket as any);
    bucket.set(key, config);
  };

  const unregister = (key: Hotkey, module?: string) => {
    const bucket = module ? registryRef.current.get(module) : globalRegistryRef.current;
    bucket?.delete(key);
  };

  const getTooltip = (key: Hotkey) => {
    const moduleReg = registryRef.current.get(activeModule);
    return moduleReg?.get(key)?.tooltip || globalRegistryRef.current.get(key)?.tooltip || DEFAULT_TOOLTIPS[key];
  };

  const value = useMemo(() => ({ activeModule, setActiveModule, register, unregister, getTooltip }), [activeModule]);
  return <HotkeysContext.Provider value={value}>{children}</HotkeysContext.Provider>;
};

export const useHotkeys = () => {
  const ctx = useContext(HotkeysContext);
  if (!ctx) throw new Error('useHotkeys must be used within HotkeysProvider');
  return ctx;
};
