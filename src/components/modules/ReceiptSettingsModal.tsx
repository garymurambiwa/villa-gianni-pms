import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { readReceiptBranding, writeReceiptBranding, subscribeReceiptBranding, validateReceiptBranding } from '@/lib/printSettings';
import { useToast } from '@/hooks/use-toast';

type OutletType = 'default' | 'restaurant' | 'bar';

type ReceiptPrefs = {
  restaurant_name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo_url?: string;
  show_logo?: boolean;
  header_text?: string;
  footer_text?: string;
  paper_size?: '58mm' | '80mm';
  tax_rate?: number;
};

type OutletSettings = {
  default: ReceiptPrefs;
  restaurant: Partial<ReceiptPrefs> & { use_default?: boolean };
  bar: Partial<ReceiptPrefs> & { use_default?: boolean };
};

const OUTLET_STORAGE_KEY = 'corepms_outlet_receipt_settings';

const readOutletSettings = (): OutletSettings => {
  try {
    const raw = localStorage.getItem(OUTLET_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const defaultPrefs = readReceiptBranding();
  return {
    default: {
      restaurant_name: defaultPrefs.restaurant_name || '',
      address: defaultPrefs.address,
      phone: defaultPrefs.phone,
      email: defaultPrefs.email,
      website: defaultPrefs.website,
      logo_url: defaultPrefs.logo_url,
      show_logo: defaultPrefs.show_logo ?? true,
      header_text: defaultPrefs.header_text,
      footer_text: defaultPrefs.footer_text,
      paper_size: defaultPrefs.paper_size,
      tax_rate: defaultPrefs.tax_rate,
    },
    restaurant: { use_default: true },
    bar: { use_default: true },
  };
};

const writeOutletSettings = (settings: OutletSettings): void => {
  try {
    localStorage.setItem(OUTLET_STORAGE_KEY, JSON.stringify(settings));
    // Also sync default to global branding
    writeReceiptBranding(settings.default);
  } catch (e) {
    console.error('Failed to save outlet settings:', e);
    throw e;
  }
};

export const getOutletReceiptSettings = (outlet: OutletType): ReceiptPrefs => {
  const settings = readOutletSettings();
  if (outlet === 'default') return settings.default;
  const outletPrefs = settings[outlet];
  if (outletPrefs.use_default) return settings.default;
  return { ...settings.default, ...outletPrefs };
};

const isEmail = (s: string) => !s || /.+@.+\..+/.test(s);
const isURL = (s: string) => !s || /^https?:\/\//i.test(s);
const isPhone = (s: string) => !s || /^[+\d][\d\s()\-]{5,}$/.test(s);

interface Props { open: boolean; onClose: () => void; }

const ReceiptSettingsModal: React.FC<Props> = ({ open, onClose }) => {
  const { toast } = useToast();
  const [activeOutlet, setActiveOutlet] = React.useState<OutletType>('default');
  const [outletSettings, setOutletSettings] = React.useState<OutletSettings>(readOutletSettings());
  const [logoPreview, setLogoPreview] = React.useState<string | undefined>(undefined);
  const [logoSource, setLogoSource] = React.useState<'upload' | 'url'>('upload');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const currentPrefs = React.useMemo(() => {
    if (activeOutlet === 'default') return outletSettings.default;
    const outletData = outletSettings[activeOutlet];
    if (outletData.use_default) return outletSettings.default;
    return { ...outletSettings.default, ...outletData };
  }, [activeOutlet, outletSettings]);

  const useDefault = activeOutlet !== 'default' && (outletSettings[activeOutlet]?.use_default ?? true);

  React.useEffect(() => {
    if (open) {
      const settings = readOutletSettings();
      setOutletSettings(settings);
      setLogoPreview(settings.default.logo_url);
      setLogoSource(settings.default.logo_url?.startsWith('data:image/') ? 'upload' : 'url');
      setErrors({});
      setActiveOutlet('default');
    }
  }, [open]);

  React.useEffect(() => {
    const unsub = subscribeReceiptBranding((b) => {
      setOutletSettings(prev => ({
        ...prev,
        default: {
          ...prev.default,
          restaurant_name: b.restaurant_name || '',
          address: b.address,
          phone: b.phone,
          email: b.email,
          website: b.website,
          logo_url: b.logo_url,
          show_logo: b.show_logo,
          header_text: b.header_text,
          footer_text: b.footer_text,
          paper_size: b.paper_size,
          tax_rate: b.tax_rate,
        }
      }));
      setLogoPreview(b.logo_url);
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const updatePrefs = (patch: Partial<ReceiptPrefs>) => {
    setOutletSettings(prev => {
      if (activeOutlet === 'default') {
        return { ...prev, default: { ...prev.default, ...patch } };
      } else {
        return { ...prev, [activeOutlet]: { ...prev[activeOutlet], ...patch, use_default: false } };
      }
    });
  };

  const toggleUseDefault = (useDefaultVal: boolean) => {
    if (activeOutlet === 'default') return;
    setOutletSettings(prev => ({
      ...prev,
      [activeOutlet]: { ...prev[activeOutlet], use_default: useDefaultVal }
    }));
  };

  const handleLogoUpload = (file?: File) => {
    if (!file) return;
    if (!/(png|jpg|jpeg|svg)$/i.test(file.name.split('.').pop() || '')) {
      setErrors(prev => ({ ...prev, logo_url: 'Unsupported format. Use PNG, JPG, or SVG.' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setLogoPreview(url);
      updatePrefs({ logo_url: url, show_logo: true });
      setErrors(prev => ({ ...prev, logo_url: '' }));
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUrlChange = (url: string) => {
    setLogoPreview(url);
    updatePrefs({ logo_url: url, show_logo: true });
    setErrors(prev => ({ ...prev, logo_url: '' }));
  };

  const validate = (): boolean => {
    const prefs = activeOutlet === 'default' ? outletSettings.default : currentPrefs;
    const e: Record<string, string> = {};
    
    // Company name is always required
    if (!prefs.restaurant_name?.trim()) {
      e.restaurant_name = 'Company name is required.';
    }
    
    // Validate email format
    if (prefs.email && !isEmail(prefs.email)) {
      e.email = 'Invalid email format.';
    }
    
    // Validate website URL
    if (prefs.website && !isURL(prefs.website)) {
      e.website = 'URL must start with http:// or https://';
    }
    
    // Validate phone format
    if (prefs.phone && !isPhone(prefs.phone)) {
      e.phone = 'Invalid phone number format.';
    }
    
    // Validate tax rate
    if (prefs.tax_rate !== undefined) {
      const rate = Number(prefs.tax_rate);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        e.tax_rate = 'Tax rate must be between 0 and 100.';
      }
    }
    
    // Validate logo URL format if provided
    if (prefs.logo_url) {
      const logoUrl = String(prefs.logo_url).trim();
      // Allow http, https, data urls, or absolute paths starting with /
      if (logoUrl && !/^(https?:\/\/|data:image\/|\/)/i.test(logoUrl)) {
        e.logo_url = 'Logo must be a valid URL, absolute path (starting with /), or uploaded image.';
      }
    }
    
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    // Clear previous save errors
    setErrors(prev => ({ ...prev, save: '' }));
    
    if (!validate()) {
      toast({ title: 'Validation Error', description: 'Please fix the highlighted errors before saving.', variant: 'destructive' });
      return;
    }
    
    setSaving(true);
    try {
      // Prepare updated settings
      const updatedSettings = { ...outletSettings };
      
      // Update logo in default settings if changed
      if (activeOutlet === 'default' && logoPreview) {
        updatedSettings.default.logo_url = logoPreview;
      }
      
      // Ensure restaurant_name is set before saving
      if (!updatedSettings.default.restaurant_name?.trim()) {
        throw new Error('Company name is required');
      }
      
      writeOutletSettings(updatedSettings);
      toast({ title: 'Settings Saved', description: 'Receipt branding settings have been updated successfully.' });
      onClose();
    } catch (e: any) {
      console.error('Save failed:', e);
      const errorMsg = e?.message || 'Failed to save settings. Please try again.';
      setErrors(prev => ({ ...prev, save: errorMsg }));
      toast({ title: 'Save Failed', description: errorMsg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const renderPreview = (prefs: ReceiptPrefs) => (
    <div className="border rounded p-3 bg-white">
      {prefs.show_logo && (prefs.logo_url || logoPreview) && (
        <div className="text-center mb-2">
          <img src={prefs.logo_url || logoPreview} alt="Logo" className="inline-block max-h-16" />
        </div>
      )}
      <div className="text-center font-semibold">{prefs.restaurant_name || 'Company Name'}</div>
      {prefs.address && <div className="text-center text-sm text-gray-700">{prefs.address}</div>}
      {prefs.phone && <div className="text-center text-sm text-gray-700">Phone: {prefs.phone}</div>}
      {prefs.email && <div className="text-center text-sm text-gray-700">Email: {prefs.email}</div>}
      {prefs.website && <div className="text-center text-sm text-gray-700">Website: {prefs.website}</div>}
      {prefs.header_text && <div className="text-center text-sm text-gray-600 mt-1">{prefs.header_text}</div>}
      <hr className="my-2" />
      <div className="text-sm">Sample Receipt Content</div>
      <div className="text-xs text-gray-600">Items and totals would appear here...</div>
      <hr className="my-2" />
      {prefs.footer_text && <div className="text-center text-xs text-gray-600">{prefs.footer_text}</div>}
      <div className="text-center text-xs text-gray-400 mt-1">Powered By Coredigita</div>
    </div>
  );

  const renderFormFields = (prefs: ReceiptPrefs, disabled: boolean = false) => (
    <div className="space-y-3">
      <div>
        <Label>Company Name *</Label>
        <Input
          value={prefs.restaurant_name || ''}
          onChange={(e) => updatePrefs({ restaurant_name: e.target.value })}
          aria-invalid={!!errors.restaurant_name}
          disabled={disabled}
        />
        {errors.restaurant_name && <div className="text-xs text-red-600">{errors.restaurant_name}</div>}
      </div>
      <div>
        <Label>Address</Label>
        <Textarea
          value={prefs.address || ''}
          onChange={(e) => updatePrefs({ address: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Phone</Label>
          <Input
            value={prefs.phone || ''}
            onChange={(e) => updatePrefs({ phone: e.target.value })}
            aria-invalid={!!errors.phone}
            disabled={disabled}
          />
          {errors.phone && <div className="text-xs text-red-600">{errors.phone}</div>}
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={prefs.email || ''}
            onChange={(e) => updatePrefs({ email: e.target.value })}
            aria-invalid={!!errors.email}
            disabled={disabled}
          />
          {errors.email && <div className="text-xs text-red-600">{errors.email}</div>}
        </div>
      </div>
      <div>
        <Label>Website URL</Label>
        <Input
          value={prefs.website || ''}
          onChange={(e) => updatePrefs({ website: e.target.value })}
          aria-invalid={!!errors.website}
          placeholder="https://example.com"
          disabled={disabled}
        />
        {errors.website && <div className="text-xs text-red-600">{errors.website}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Header Text</Label>
          <Input
            value={prefs.header_text || ''}
            onChange={(e) => updatePrefs({ header_text: e.target.value })}
            placeholder="Welcome message"
            disabled={disabled}
          />
        </div>
        <div>
          <Label>Footer Text</Label>
          <Input
            value={prefs.footer_text || ''}
            onChange={(e) => updatePrefs({ footer_text: e.target.value })}
            placeholder="Thank you message"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Paper Size</Label>
          <select
            className="w-full px-3 py-2 border rounded-md"
            value={prefs.paper_size || '80mm'}
            onChange={(e) => updatePrefs({ paper_size: e.target.value as '58mm' | '80mm' })}
            disabled={disabled}
          >
            <option value="58mm">58mm (Thermal)</option>
            <option value="80mm">80mm (Thermal)</option>
          </select>
        </div>
        <div>
          <Label>Tax Rate (%)</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={prefs.tax_rate ?? 15}
            onChange={(e) => updatePrefs({ tax_rate: Number(e.target.value) })}
            aria-invalid={!!errors.tax_rate}
            disabled={disabled}
          />
          {errors.tax_rate && <div className="text-xs text-red-600">{errors.tax_rate}</div>}
        </div>
      </div>
      <div>
        <Label>Company Logo</Label>
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="logo-upload"
                name="logo-source"
                checked={logoSource === 'upload'}
                onChange={() => setLogoSource('upload')}
                disabled={disabled}
              />
              <Label htmlFor="logo-upload" className="cursor-pointer">Upload File</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="logo-url"
                name="logo-source"
                checked={logoSource === 'url'}
                onChange={() => setLogoSource('url')}
                disabled={disabled}
              />
              <Label htmlFor="logo-url" className="cursor-pointer">Enter URL</Label>
            </div>
          </div>

          {logoSource === 'upload' ? (
            <Input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={(e) => handleLogoUpload(e.target.files?.[0])}
              disabled={disabled}
            />
          ) : (
            <Input
              type="text"
              value={currentPrefs.logo_url || ''}
              onChange={(e) => handleLogoUrlChange(e.target.value)}
              placeholder="/logo.png or https://example.com/logo.png"
              disabled={disabled}
            />
          )}
          {errors.logo_url && <div className="text-xs text-red-600">{errors.logo_url}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="showLogo"
          checked={!!prefs.show_logo}
          onChange={(e) => updatePrefs({ show_logo: e.target.checked })}
          disabled={disabled}
        />
        <Label htmlFor="showLogo">Show logo on receipts</Label>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receipt Branding & Company Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeOutlet} onValueChange={(v) => setActiveOutlet(v as OutletType)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="default">Default (All)</TabsTrigger>
            <TabsTrigger value="restaurant">Restaurant</TabsTrigger>
            <TabsTrigger value="bar">Bar</TabsTrigger>
          </TabsList>

          <TabsContent value="default" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>{renderFormFields(outletSettings.default)}</div>
              <div className="space-y-2">
                <Label>Live Preview</Label>
                <div className="border rounded p-2 h-80 overflow-auto bg-gray-50">
                  {renderPreview(outletSettings.default)}
                </div>
                <div className="text-xs text-gray-600">
                  Default settings apply to all outlets unless overridden.
                </div>
              </div>
            </div>
          </TabsContent>

          {(['restaurant', 'bar'] as const).map((outlet) => (
            <TabsContent key={outlet} value={outlet} className="mt-4">
              <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`useDefault-${outlet}`}
                  checked={outletSettings[outlet]?.use_default ?? true}
                  onChange={(e) => toggleUseDefault(e.target.checked)}
                />
                <Label htmlFor={`useDefault-${outlet}`} className="cursor-pointer">
                  Use default settings for {outlet.charAt(0).toUpperCase() + outlet.slice(1)}
                </Label>
              </div>

              {outletSettings[outlet]?.use_default ? (
                <div className="text-center text-gray-500 py-8">
                  <p>Using default settings. Uncheck the box above to customize {outlet} receipts.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>{renderFormFields(currentPrefs)}</div>
                  <div className="space-y-2">
                    <Label>Live Preview - {outlet.charAt(0).toUpperCase() + outlet.slice(1)}</Label>
                    <div className="border rounded p-2 h-80 overflow-auto bg-gray-50">
                      {renderPreview(currentPrefs)}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {errors.save && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
            {errors.save}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptSettingsModal;
