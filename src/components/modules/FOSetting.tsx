import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canManageStaff, isAdmin, isManager } from '@/lib/permissions';

// Shared brand settings utilities (same as BrandHeader)
type BrandSettings = {
  name: string;
  font: string;
  color: string;
  sizePx: number;
  logoDataUrl?: string;
};
const K_BRAND = 'corepms_brand_settings';
const DEFAULT: BrandSettings = {
  name: 'COREPMS',
  font: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  color: '#60a5fa',
  sizePx: 24,
};
const readJSON = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const allowedFonts = [
  { label: 'Inter (Default)', value: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Montserrat', value: 'Montserrat, Arial, sans-serif' },
];
const isValidName = (name: string) => /^([A-Za-z0-9 \-_.]{2,32})$/.test(name);
const sanitizeSvg = async (file: File): Promise<string | null> => {
  const text = await file.text();
  const lowered = text.toLowerCase();
  if (lowered.includes('<script') || lowered.includes('onload=') || lowered.includes('javascript:')) return null;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
};
const fileToDataUrl = (file: File): Promise<string | null> => {
  return new Promise(async (resolve) => {
    const type = file.type;
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) return resolve(null);
    if (!['image/png','image/jpeg','image/jpg','image/svg+xml'].includes(type)) return resolve(null);
    if (type === 'image/svg+xml') {
      const svgData = await sanitizeSvg(file);
      return resolve(svgData);
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

/**
 * FO Setting module consolidates several administration/profile tools
 * into one unified interface while preserving original functionality.
 * Clicking a button navigates to its corresponding original module.
 */
const FOSetting: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role || '');

  const navigate = (module: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('module', module);
      url.searchParams.set('noRedirectToast', '1');
      window.history.pushState({}, '', url.toString());
    } catch {}
    const event = new CustomEvent('navigateToModule', { detail: { module } });
    window.dispatchEvent(event);
  };

  const items: Array<{ id: string; label: string; icon: string; module: string; visible: boolean; badge?: string }> = [
    { id: 'superadmin-settings', label: 'Super Admin Settings', icon: '🔐', module: 'superadmin-settings', visible: isAdmin(role) || role.toLowerCase() === 'supervisor', badge: 'Admin/Supervisor' },
    { id: 'admin-management', label: 'Admin Management', icon: '🛡️', module: 'admin-management', visible: isAdmin(role), badge: 'Admin' },
    { id: 'profile-admin', label: 'Profile Admin', icon: '🛡️', module: 'profile-admin', visible: canManageStaff(role), badge: 'Admin/Supervisor' },
    { id: 'profile', label: 'Profile & Settings', icon: '🧑', module: 'profile', visible: true },
    { id: 'tx-clearing', label: 'Transaction Clearing', icon: '🧹', module: 'tx-clearing', visible: isAdmin(role) || role.toLowerCase() === 'supervisor', badge: 'Admin/Supervisor' },
  ];

  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const [draft, setDraft] = React.useState<BrandSettings>(() => readJSON<BrandSettings>(K_BRAND, DEFAULT));
  const [previewUrl, setPreviewUrl] = React.useState<string | undefined>(draft.logoDataUrl);

  // ── Accommodation Tax setup ────────────────────────────────────────────────
  const [taxOpen, setTaxOpen] = React.useState(false);
  const [taxRate, setTaxRate] = React.useState<string>('15');
  const [taxInclusive, setTaxInclusive] = React.useState<boolean>(true);
  const [taxSaved, setTaxSaved] = React.useState<string>('');
  const canManageTax = ['admin', 'manager'].includes((role || '').toLowerCase());

  React.useEffect(() => {
    // Authoritative rate from system_configs.hotel_tax_rate; fall back to the
    // night-audit localStorage profile the posting actually uses today.
    fetch('/api/system/branding').then(r => r.json()).then(d => {
      const r = d?.branding?.hotel_tax_rate;
      if (r != null && !isNaN(Number(r))) setTaxRate(String(Number(r)));
    }).catch(() => {});
    try {
      const prof = JSON.parse(localStorage.getItem('corepms_tax_profile_default') || 'null');
      if (prof && prof.taxRate != null) { setTaxRate(String(Number(prof.taxRate) * 100)); if (prof.inclusive != null) setTaxInclusive(!!prof.inclusive); }
    } catch { /* ignore */ }
  }, []);

  const saveTax = async () => {
    const pct = Number(taxRate);
    if (isNaN(pct) || pct < 0 || pct > 100) { setTaxSaved('Enter a rate between 0 and 100.'); return; }
    // Persist to BOTH stores: system_configs (authoritative/branding) and the
    // localStorage profile the night audit reads — so the configured rate is
    // actually applied (previously night audit ignored config and posted 10%).
    try {
      await fetch('/api/db/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `INSERT INTO system_configs (key, value, updated_at) VALUES ('hotel_tax_rate', $1::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          params: [JSON.stringify(pct)],
        }),
      });
      await fetch('/api/db/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: `INSERT INTO system_configs (key, value, updated_at) VALUES ('accommodation_tax_inclusive', $1::jsonb, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          params: [JSON.stringify(taxInclusive)],
        }),
      });
    } catch { /* offline — localStorage still applies for this device */ }
    try { localStorage.setItem('corepms_tax_profile_default', JSON.stringify({ taxRate: pct / 100, inclusive: taxInclusive })); } catch { /* ignore */ }
    setTaxSaved(`Saved — accommodation tax is now ${pct}% (${taxInclusive ? 'tax-inclusive' : 'added on top'}).`);
    setTimeout(() => { setTaxOpen(false); setTaxSaved(''); }, 1400);
  };

  const apply = () => {
    setError('');
    if (!isValidName(draft.name)) { setError('Name must be 2–32 characters (letters, numbers, space, - _ .)'); return; }
    writeJSON(K_BRAND, draft);
    try { window.dispatchEvent(new Event('brand:updated')); } catch {}
    setOpen(false);
  };
  const reset = () => { setDraft(DEFAULT); setPreviewUrl(undefined); setError(''); };
  const onLogoChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    if (!url) { setError('Unsupported format or file too large (max 2MB), or SVG failed sanitization.'); return; }
    setPreviewUrl(url);
    setDraft({ ...draft, logoDataUrl: url });
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b shadow-sm px-4 sm:px-6 -mx-4 sm:-mx-6 py-3 mb-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-bold">FO Setting</h2>
          {(['admin','manager'].includes((role || '').toLowerCase())) && (
            <Button variant="outline" onClick={() => setOpen(true)} aria-label="Customize Branding" title="Customize Branding">
              Customize
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {items.filter(i => i.visible).map((i) => (
          <Button key={i.id} variant="outline" className="justify-start text-left h-auto py-3" onClick={() => navigate(i.module)}>
            <span className="text-xl mr-3">{i.icon}</span>
            <span className="font-medium flex-1">{i.label}</span>
            {i.badge && (
              <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-2 py-1 rounded">{i.badge}</span>
            )}
          </Button>
        ))}
        {canManageTax && (
          <Button variant="outline" className="justify-start text-left h-auto py-3" onClick={() => setTaxOpen(true)}>
            <span className="text-xl mr-3">🧾</span>
            <span className="font-medium flex-1">Tax Setup <span className="block text-[11px] text-gray-500 font-normal">Accommodation tax rate — currently {taxRate}%</span></span>
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-2 py-1 rounded">Admin/Manager</span>
          </Button>
        )}
      </div>

      {taxOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setTaxOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-xl shadow-xl p-6" role="dialog" aria-modal="true" aria-label="Tax Setup" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Accommodation Tax Setup</h3>
              <Button variant="outline" className="text-black" onClick={() => setTaxOpen(false)}>Close</Button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Applied by the night audit to room charges. Setting this fixes the prior mismatch where the configured rate was ignored and 10% was posted.</p>
            <label className="text-xs font-medium">Accommodation Tax Rate (%)</label>
            <Input type="number" step="0.1" min="0" max="100" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="mt-1" />
            <div className="mt-3 flex items-center gap-2">
              <input id="tax-inclusive" type="checkbox" checked={taxInclusive} onChange={e => setTaxInclusive(e.target.checked)} className="h-4 w-4" />
              <label htmlFor="tax-inclusive" className="text-sm">Tax is included in the room rate (inclusive)</label>
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {taxInclusive
                ? `A $100 room at ${taxRate || 0}% → base $${(100 / (1 + Number(taxRate || 0) / 100)).toFixed(2)} + tax $${(100 - 100 / (1 + Number(taxRate || 0) / 100)).toFixed(2)}.`
                : `A $100 room at ${taxRate || 0}% → base $100 + tax $${(100 * Number(taxRate || 0) / 100).toFixed(2)} = $${(100 * (1 + Number(taxRate || 0) / 100)).toFixed(2)}.`}
            </div>
            {taxSaved && <div className="mt-3 p-2 rounded bg-green-50 text-green-700 text-sm">{taxSaved}</div>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setTaxOpen(false)}>Cancel</Button>
              <Button onClick={saveTax} className="bg-blue-600 text-white hover:bg-blue-700">Save Tax Rate</Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-2xl rounded-xl shadow-xl p-6" role="dialog" aria-modal="true" aria-label="Brand Customization">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Brand Customization</h3>
              <Button variant="outline" className="text-black" onClick={()=> setOpen(false)} aria-label="Close">Close</Button>
            </div>
            {error && (<div className="p-2 mb-2 rounded bg-red-50 text-red-700 text-sm" role="alert">{error}</div>)}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm font-semibold mb-2">Logo Upload</div>
                <Input type="file" accept=".png,.jpg,.jpeg,.svg" onChange={onLogoChange} aria-label="Upload logo" />
                <div className="text-[10px] text-black mt-1">PNG, JPG, SVG · Max 2MB</div>
                {previewUrl && (
                  <div className="mt-2">
                    <div className="text-xs text-black mb-1">Preview:</div>
                    <img src={previewUrl} alt="Logo preview" className="max-h-16 object-contain border rounded p-1 bg-white" />
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm font-semibold mb-2">Name Customization</div>
                <label className="text-xs" htmlFor="brand-name">Name</label>
                <Input id="brand-name" value={draft.name} onChange={(e)=> setDraft({ ...draft, name: e.target.value })} placeholder="Enter brand name" />
                <div className="text-[10px] text-black">2–32 chars: letters, numbers, space, - _ .</div>
                <label className="text-xs mt-2" htmlFor="brand-font">Font</label>
                <select id="brand-font" className="border rounded px-2 py-2 w-full" value={draft.font} onChange={(e)=> setDraft({ ...draft, font: e.target.value })}>
                  {allowedFonts.map(f => (<option key={f.value} value={f.value}>{f.label}</option>))}
                </select>
                <label className="text-xs mt-2" htmlFor="brand-color">Text Color</label>
                <Input id="brand-color" type="color" value={draft.color} onChange={(e)=> setDraft({ ...draft, color: e.target.value })} />
                <label className="text-xs mt-2" htmlFor="brand-size">Size</label>
                <input id="brand-size" type="range" min={16} max={48} value={draft.sizePx} onChange={(e)=> setDraft({ ...draft, sizePx: Number(e.target.value) })} className="w-full" />
                <div className="text-[10px] text-black">{draft.sizePx}px</div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={reset}>Reset</Button>
              <Button onClick={apply} className="bg-blue-600 text-white hover:bg-blue-700">Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FOSetting;
