import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { getModelLabel, readPrinterConfig, writePrinterConfig, type DrawerModel, type DrawerConfig } from '@/lib/printerConfig';

type PrinterInfo = { name: string };

const Section: React.FC<{ title: string; children: React.ReactNode }>= ({ title, children }) => (
  <div className="bg-white shadow rounded-lg p-4">
    <h3 className="text-lg font-semibold mb-2">{title}</h3>
    {children}
  </div>
);

export const PrinterConfiguration: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const propertyId = user?.propertyId || 'DEFAULT';
  const [printers, setPrinters] = React.useState<PrinterInfo[]>([]);
  const [posCfg, setPosCfg] = React.useState<DrawerConfig | null>(null);
  const [foCfg, setFoCfg] = React.useState<DrawerConfig | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const loadPrinters = async () => {
    try {
      const list = (window as any).native?.getPrinters ? await (window as any).native.getPrinters() : [];
      const normalized: PrinterInfo[] = (Array.isArray(list) ? list : []).map((p: any) => ({ name: p?.name || p?.displayName || 'Unknown' }));
      setPrinters(normalized);
    } catch {
      setPrinters([]);
    }
  };

  const loadConfig = async () => {
    setLoading(true);
    const cfg = await readPrinterConfig(propertyId);
    setPosCfg(cfg.pos);
    setFoCfg(cfg.frontOffice);
    setLoading(false);
  };

  React.useEffect(() => { loadPrinters(); loadConfig(); }, []);

  const selectModels: { value: DrawerModel; label: string }[] = [
    { value: 'escpos_generic', label: getModelLabel('escpos_generic') },
    { value: 'epson_tm_t88', label: getModelLabel('epson_tm_t88') },
    { value: 'star_tsp100', label: getModelLabel('star_tsp100') },
    { value: 'custom', label: getModelLabel('custom') },
  ];

  const handleSave = async () => {
    if (!posCfg || !foCfg) return;
    setSaving(true);
    const res = await writePrinterConfig({ propertyId, pos: posCfg, frontOffice: foCfg });
    setSaving(false);
    if (res.ok) toast({ title: 'Saved', description: 'Printer configuration updated successfully.' });
    else toast({ title: 'Partial Save', description: res.error || 'Cloud save failed; local copy persisted.', variant: 'destructive' });
  };

  const testKick = async (cfg: DrawerConfig) => {
    try {
      const res = await (window as any).native?.kickDrawer?.(cfg);
      if (res?.ok) toast({ title: 'Success', description: 'Drawer kick command sent.' });
      else throw new Error(res?.error || 'Kick failed');
    } catch (err: any) {
      toast({ title: 'Kick Failed', description: String(err?.message || err), variant: 'destructive' });
    }
  };

  const renderDrawerForm = (cfg: DrawerConfig, setCfg: (c: DrawerConfig)=>void) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="font-medium">Enable Kick-to-Drawer</Label>
        <Switch checked={!!cfg.enabled} onCheckedChange={(v)=> setCfg({ ...cfg, enabled: v })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Printer</Label>
          <Select value={cfg.printerDeviceName || ''} onValueChange={(v)=> setCfg({ ...cfg, printerDeviceName: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select printer" /></SelectTrigger>
            <SelectContent>
              {printers.map((p)=> (<SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Model</Label>
          <Select value={cfg.model} onValueChange={(v)=> setCfg({ ...cfg, model: v as DrawerModel })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select model" /></SelectTrigger>
            <SelectContent>
              {selectModels.map(m => (<SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Network IP (optional)</Label>
          <Input value={cfg.ip || ''} onChange={(e)=> setCfg({ ...cfg, ip: e.target.value })} placeholder="e.g., 192.168.1.50" />
        </div>
        <div>
          <Label>Port</Label>
          <Input type="number" value={cfg.port || 9100} onChange={(e)=> setCfg({ ...cfg, port: Number(e.target.value||9100) })} />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Drawer</Label>
          <Select value={String(cfg.drawerNumber ?? 0)} onValueChange={(v)=> setCfg({ ...cfg, drawerNumber: Number(v) as 0|1 })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Drawer 1</SelectItem>
              <SelectItem value="1">Drawer 2</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pulse ON (ms)</Label>
          <Input type="number" value={cfg.pulseOnTimeMs || 50} onChange={(e)=> setCfg({ ...cfg, pulseOnTimeMs: Number(e.target.value||50) })} />
        </div>
        <div>
          <Label>Pulse OFF (ms)</Label>
          <Input type="number" value={cfg.pulseOffTimeMs || 50} onChange={(e)=> setCfg({ ...cfg, pulseOffTimeMs: Number(e.target.value||50) })} />
        </div>
      </div>
      {cfg.model === 'custom' && (
        <div>
          <Label>Custom Command (Hex)</Label>
          <Input value={cfg.customCommandHex || ''} onChange={(e)=> setCfg({ ...cfg, customCommandHex: e.target.value })} placeholder="e.g., 1B70003232" />
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={()=> testKick(cfg)}>Test Drawer Kick</Button>
      </div>
    </div>
  );

  if (loading || !posCfg || !foCfg) {
    return (
      <div className="p-8">
        <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-2">Printer Configuration</h2>
          <p className="text-sm text-gray-600">Loading configuration…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Printer Configuration</h2>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Configuration'}</Button>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-sm text-gray-600">Configure kick-to-drawer for POS and Front Office. Supports multiple models and network printers.</p>
        <Tabs defaultValue="pos">
          <TabsList>
            <TabsTrigger value="pos">POS Receipt Printing</TabsTrigger>
            <TabsTrigger value="frontoffice">Front Office Receipt Printing</TabsTrigger>
          </TabsList>
          <TabsContent value="pos" className="mt-4">
            <Section title="POS – Drawer Settings">
              {renderDrawerForm(posCfg, setPosCfg)}
            </Section>
          </TabsContent>
          <TabsContent value="frontoffice" className="mt-4">
            <Section title="Front Office – Drawer Settings">
              {renderDrawerForm(foCfg, setFoCfg)}
            </Section>
          </TabsContent>
        </Tabs>
        <div className="text-xs text-gray-600">Changes are stored securely (cloud when available) with local fallback. Existing printing workflows remain unaffected.</div>
      </div>
    </div>
  );
};

export default PrinterConfiguration;
