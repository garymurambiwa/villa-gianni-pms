import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useHotkeys, Hotkey } from '@/contexts/HotkeysContext';

const editableKeys: Hotkey[] = ['F4','F5','F6','F7','F8','F9','F10','F11','F12'];

const HotkeysSettings: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void }>=({ open, onOpenChange }) => {
  const hk = useHotkeys();
  const [rows, setRows] = React.useState<{ key: Hotkey; tooltip: string; eventName: string }[]>([]);

  React.useEffect(() => {
    if (!open) return;
    const next = editableKeys.map((k) => ({ key: k, tooltip: hk.getTooltip(k) || '', eventName: '' }));
    setRows(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    try {
      const persisted: Record<string, { tooltip: string; eventName?: string }> = {};
      rows.forEach(r => {
        persisted[r.key] = { tooltip: r.tooltip || '', eventName: r.eventName || undefined };
      });
      localStorage.setItem('corepms_hotkeys_global', JSON.stringify(persisted));
      window.dispatchEvent(new CustomEvent('hotkeys:update'));
      onOpenChange(false);
    } catch (err) {
      alert('Failed to save hotkeys');
      console.error(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Hotkey Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((r, idx) => (
            <div key={r.key} className="grid grid-cols-3 gap-2 items-center">
              <div className="text-sm font-semibold">{r.key}</div>
              <Input placeholder="Tooltip" value={r.tooltip} onChange={(e)=>{
                const v = e.target.value; setRows(prev => prev.map((x,i)=> i===idx?{...x, tooltip: v}:x));
              }} />
              <Input placeholder="Event name (optional)" value={r.eventName} onChange={(e)=>{
                const v = e.target.value; setRows(prev => prev.map((x,i)=> i===idx?{...x, eventName: v}:x));
              }} />
            </div>
          ))}
          <div className="text-xs text-gray-600">Assign tooltips and optional event names to function keys. Modules can listen for the named event to perform actions.</div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
          <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HotkeysSettings;
