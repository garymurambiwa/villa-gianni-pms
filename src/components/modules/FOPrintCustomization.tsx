import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { listTemplates, saveTemplate, deleteTemplate, getTemplateForType, setTemplateForType, renderTemplateHTML, type TemplateDesign, type TemplateType } from '@/lib/foTemplates';

interface Props { open: boolean; onClose: () => void; }

const FOPrintCustomization: React.FC<Props> = ({ open, onClose }) => {
  const [templates, setTemplates] = React.useState<TemplateDesign[]>(listTemplates());
  const [editing, setEditing] = React.useState<TemplateDesign | null>(null);
  const [assignReceipt, setAssignReceipt] = React.useState<string>(getTemplateForType('receipt').id);
  const [assignBill, setAssignBill] = React.useState<string>(getTemplateForType('bill').id);
  const [assignStatement, setAssignStatement] = React.useState<string>(getTemplateForType('statement').id);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);

  React.useEffect(() => { if (open) { setTemplates(listTemplates()); setEditing(null); } }, [open]);

  const startNew = (type: TemplateType, designId: string) => {
    const baseName = designId === 'classic-receipt' ? 'Classic' : designId === 'compact-bill' ? 'Compact' : 'Detailed';
    setEditing({ id: `${designId}-${Date.now()}`, name: `${baseName} (Custom)`, type, headerHTML: '<div class="center bold">{{company_name}}</div>', footerHTML: '<div class="center text-xs">Footer</div>', showFields: { date: true, transactionId: true, items: true, totals: true, tax: true }, branding: { useGlobalBranding: true } });
  };

  const saveCurrent = () => { if (!editing) return; const saved = saveTemplate(editing); setTemplates(listTemplates()); setEditing(saved); };
  const removeTemplate = (id: string) => { deleteTemplate(id); setTemplates(listTemplates()); };

  const assignTemplates = () => { setTemplateForType('receipt', assignReceipt); setTemplateForType('bill', assignBill); setTemplateForType('statement', assignStatement); onClose(); };

  const previewHTML = () => {
    const tpl = editing || getTemplateForType('receipt');
    const now = new Date();
    return renderTemplateHTML(tpl, {
      date: now.toLocaleString(),
      transactionId: 'PREVIEW-00001',
      items: [{ description: 'Room Charge', amount: 120 }, { description: 'Tax', amount: 12 }],
      subtotal: 120,
      tax: 12,
      total: 132,
    });
  };

  const handleLogoUpload = (file?: File) => {
    if (!file || !editing) return;
    setLogoFile(file);
    const reader = new FileReader(); reader.onload = () => { setEditing({ ...editing, branding: { ...editing.branding, useGlobalBranding: false, logo_url: String(reader.result||'') } }); }; reader.readAsDataURL(file);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Front Office Print Customization</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Start from design</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <Button variant="outline" onClick={() => startNew('receipt', 'classic-receipt')}>Classic Receipt</Button>
                <Button variant="outline" onClick={() => startNew('bill', 'compact-bill')}>Compact Bill</Button>
                <Button variant="outline" onClick={() => startNew('statement', 'detailed-statement')}>Detailed Statement</Button>
              </div>
            </div>
            {editing && (
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input value={editing.name} onChange={(e)=> setEditing({ ...editing, name: e.target.value })} />
                <Label>Header Content (supports {'{{company_name}}'})</Label>
                <Textarea value={editing.headerHTML} onChange={(e)=> setEditing({ ...editing, headerHTML: e.target.value })} />
                <Label>Footer Content</Label>
                <Textarea value={editing.footerHTML} onChange={(e)=> setEditing({ ...editing, footerHTML: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2"><input type="checkbox" checked={editing.showFields.date} onChange={(e)=> setEditing({ ...editing, showFields: { ...editing.showFields, date: e.target.checked } })} /><Label>Date</Label></div>
                  <div className="flex items-center gap-2"><input type="checkbox" checked={editing.showFields.transactionId} onChange={(e)=> setEditing({ ...editing, showFields: { ...editing.showFields, transactionId: e.target.checked } })} /><Label>Transaction ID</Label></div>
                  <div className="flex items-center gap-2"><input type="checkbox" checked={editing.showFields.items} onChange={(e)=> setEditing({ ...editing, showFields: { ...editing.showFields, items: e.target.checked } })} /><Label>Items</Label></div>
                  <div className="flex items-center gap-2"><input type="checkbox" checked={editing.showFields.totals} onChange={(e)=> setEditing({ ...editing, showFields: { ...editing.showFields, totals: e.target.checked } })} /><Label>Totals</Label></div>
                  <div className="flex items-center gap-2"><input type="checkbox" checked={editing.showFields.tax} onChange={(e)=> setEditing({ ...editing, showFields: { ...editing.showFields, tax: e.target.checked } })} /><Label>Tax</Label></div>
                </div>
                <div>
                  <Label>Branding Logo (override)</Label>
                  <Input type="file" accept="image/*" onChange={(e)=> handleLogoUpload(e.target.files?.[0])} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveCurrent}>Save Template</Button>
                  <Button variant="destructive" onClick={()=> editing && removeTemplate(editing.id)}>Delete</Button>
                </div>
              </div>
            )}
            <div>
              <Label>Assign templates per type</Label>
              <div className="grid grid-cols-1 gap-2 mt-1">
                <div className="flex items-center gap-2">
                  <span className="w-24 text-sm">Receipt</span>
                  <Select value={assignReceipt} onValueChange={(v)=> setAssignReceipt(v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select"/></SelectTrigger>
                    <SelectContent>
                      {templates.filter(t=>t.type==='receipt').map(t=> (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-sm">Bill</span>
                  <Select value={assignBill} onValueChange={(v)=> setAssignBill(v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select"/></SelectTrigger>
                    <SelectContent>
                      {templates.filter(t=>t.type==='bill').map(t=> (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-sm">Statement</span>
                  <Select value={assignStatement} onValueChange={(v)=> setAssignStatement(v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select"/></SelectTrigger>
                    <SelectContent>
                      {templates.filter(t=>t.type==='statement').map(t=> (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" onClick={assignTemplates}>Apply Assignments</Button>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Live Preview</Label>
            <div className="border rounded p-2 h-80 overflow-auto bg-white" dangerouslySetInnerHTML={{ __html: previewHTML() }} />
            <div className="text-xs text-gray-600">Preview updates as you edit. Templates persist across sessions.</div>
          </div>
        </div>
        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FOPrintCustomization;
