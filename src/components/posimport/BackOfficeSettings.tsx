import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { createAuditEntry } from '@/lib/posIntegration';

interface BackOfficeSettingsProps {
  open: boolean;
  onClose: () => void;
  currentUser: { id: string; fullName?: string; role?: string } | null;
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border rounded-lg p-4 mb-4">
    <h4 className="text-sm font-semibold mb-2">{title}</h4>
    <div className="space-y-3 text-sm">{children}</div>
  </div>
);

const BackOfficeSettings: React.FC<BackOfficeSettingsProps> = ({ open, onClose, currentUser }) => {
  const isManager = !!currentUser && ['admin', 'manager'].includes(String(currentUser.role || '').toLowerCase());

  const log = (action: string, details?: Record<string, any>) => {
    try {
      const entry = createAuditEntry(action, 'ADMIN', currentUser?.id || 'unknown', 'server-1', details);
      const raw = localStorage.getItem('corepms_pos_audit');
      const list = raw ? JSON.parse(raw) : [];
      const next = [entry, ...list].slice(0, 200);
      localStorage.setItem('corepms_pos_audit', JSON.stringify(next));
    } catch {}
  };

  React.useEffect(() => {
    if (open) {
      log('OPEN_SETTINGS');
    }
    return () => {
      if (open) log('CLOSE_SETTINGS');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!isManager) {
    return (
      <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Access Denied</DialogTitle>
          </DialogHeader>
          <p className="text-sm">You do not have permission to access Back Office settings.</p>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Back Office Settings</DialogTitle>
        </DialogHeader>

        {/* POS user rights management */}
        <Section title="POS User Rights Management">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="User Full Name" />
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => log('USER_CREATE')}>Create</Button>
            <Button variant="secondary" onClick={() => log('USER_MODIFY')}>Modify</Button>
            <Button variant="outline" onClick={() => log('USER_ASSIGN_PERMS')}>Assign Permissions</Button>
          </div>
        </Section>

        {/* Stock management controls */}
        <Section title="Stock Management Controls">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Item SKU" />
            <Input placeholder="Adjustment (+/-)" type="number" />
            <Textarea placeholder="Reason / Notes" />
          </div>
          <Button className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => log('STOCK_ADJUST')}>Apply Adjustment</Button>
        </Section>

        {/* POS reporting tools */}
        <Section title="POS Reporting Tools">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Report Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="performance">Performance</SelectItem>
                <SelectItem value="inventory">Inventory</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="secondary" onClick={() => log('REPORT_GENERATE')}>Generate Report</Button>
        </Section>

        {/* Purchasing system configuration */}
        <Section title="Purchasing System Configuration">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder="Vendor Name" />
            <Input placeholder="Order Terms" />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => log('VENDOR_CREATE')}>Add Vendor</Button>
            <Button variant="outline" onClick={() => log('PURCHASE_CONFIG_UPDATE')}>Save Settings</Button>
          </div>
        </Section>

        {/* Stock level monitoring */}
        <Section title="Stock Level Monitoring">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Item SKU" />
            <Input placeholder="New Level" type="number" />
            <Input placeholder="Threshold" type="number" />
          </div>
          <div className="flex gap-2">
            <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => log('STOCK_SET_LEVEL')}>Set Level</Button>
            <Button variant="outline" onClick={() => log('STOCK_REALTIME_ADJUST')}>Real-time Adjust</Button>
          </div>
        </Section>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BackOfficeSettings;
