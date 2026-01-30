import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { readPrintSettings, writePrintSettings, type PrintSettings } from '@/lib/printSettings';

interface Props {
  open: boolean;
  onClose: () => void;
}

const PrintCustomizationModal: React.FC<Props> = ({ open, onClose }) => {
  const [settings, setSettings] = React.useState<PrintSettings>(readPrintSettings());

  React.useEffect(() => { if (open) setSettings(readPrintSettings()); }, [open]);

  const update = (patch: Partial<PrintSettings>) => {
    setSettings(prev => ({ ...prev, ...patch, margins: { ...prev.margins, ...(patch.margins || {}) } }));
  };

  const save = () => { writePrintSettings(settings); onClose(); };

  const sampleHTML = `
    <div style="border:1px dashed #ddd; padding:12px; border-radius:8px">
      <h2 style="margin:0 0 8px 0">Print Preview</h2>
      <p>This is a preview of how your document will render with current settings.</p>
      <ul style="margin:8px 0 0 16px">
        <li>Paper: ${settings.paperSize}</li>
        <li>Orientation: ${settings.orientation}</li>
        <li>Margins (mm): top ${settings.margins.top}, right ${settings.margins.right}, bottom ${settings.margins.bottom}, left ${settings.margins.left}</li>
        <li>Quality: ${settings.quality}</li>
      </ul>
    </div>
  `;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Print Customization</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Paper Size</Label>
                <Select value={settings.paperSize} onValueChange={(v)=> update({ paperSize: v as any })}>
                  <SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="Letter">Letter</SelectItem>
                    <SelectItem value="Legal">Legal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Orientation</Label>
                <Select value={settings.orientation} onValueChange={(v)=> update({ orientation: v as any })}>
                  <SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Margins (mm)</Label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                <Input type="number" value={settings.margins.top} onChange={(e)=> update({ margins: { top: Number(e.target.value)||0 } as any })} placeholder="Top"/>
                <Input type="number" value={settings.margins.right} onChange={(e)=> update({ margins: { right: Number(e.target.value)||0 } as any })} placeholder="Right"/>
                <Input type="number" value={settings.margins.bottom} onChange={(e)=> update({ margins: { bottom: Number(e.target.value)||0 } as any })} placeholder="Bottom"/>
                <Input type="number" value={settings.margins.left} onChange={(e)=> update({ margins: { left: Number(e.target.value)||0 } as any })} placeholder="Left"/>
              </div>
            </div>
            <div>
              <Label>Header</Label>
              <Input value={settings.headerText} onChange={(e)=> update({ headerText: e.target.value })} placeholder="Optional header text"/>
            </div>
            <div>
              <Label>Footer</Label>
              <Input value={settings.footerText} onChange={(e)=> update({ footerText: e.target.value })} placeholder="Optional footer text"/>
            </div>
            <div>
              <Label>Print Quality</Label>
              <Select value={settings.quality} onValueChange={(v)=> update({ quality: v as any })}>
                <SelectTrigger><SelectValue placeholder="Select"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={save} className="flex-1">Save</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="border rounded p-2 h-64 overflow-auto bg-white">
              <div dangerouslySetInnerHTML={{ __html: sampleHTML }} />
            </div>
            <div className="text-xs text-gray-600">Saved preferences are applied to all printed documents and persist across sessions.</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PrintCustomizationModal;

