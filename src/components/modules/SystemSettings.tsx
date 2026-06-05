import React, { useState, useEffect } from 'react';
import { useSettings, AppSettings } from '@/hooks/useSettings';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowLeft, Building2, Palette, Globe, Receipt, Database, Download, CalendarClock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/lib/db';
import { writeReceiptBranding, invalidateReceiptBrandingCache } from '@/lib/printSettings';

// ─── System Dates panel ──────────────────────────────────────────────────────
// Read-only view of the dates the system is running on, with drift detection
// and a one-click "sync to today" fix. Built because the POS business_date has
// twice been corrupted to a future value (e.g. 2026-06-02) by manual audit runs,
// silently breaking the Night Audit catch-up. This surfaces it immediately.
const SystemDatesCard: React.FC = () => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [fixing, setFixing] = useState(false);
    const [businessDate, setBusinessDate] = useState<string | null>(null);
    const [lastAudit, setLastAudit] = useState<string | null>(null);
    const [serverNow, setServerNow] = useState<string | null>(null);

    const browserToday = new Date().toISOString().slice(0, 10);

    const load = React.useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/night-audit/status').then(r => r.json());
            if (res?.ok) {
                setBusinessDate(res.businessDate || null);
                setLastAudit(res.lastRun?.business_date_str || res.lastRun?.business_date?.slice?.(0, 10) || null);
            }
            // Server "now" from a lightweight DB call (authoritative clock)
            const t = await fetch('/api/db/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: 'SELECT CURRENT_DATE::text AS d' }),
            }).then(r => r.json());
            if (t?.ok && t.rows?.length) setServerNow(t.rows[0].d);
        } catch { /* non-fatal */ }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    // Drift = business date is ahead of the server's real date (the corruption case)
    const reference = serverNow || browserToday;
    const drift = businessDate && businessDate > reference;

    const syncToToday = async () => {
        if (!serverNow) { toast({ title: 'Cannot determine server date', variant: 'destructive' }); return; }
        setFixing(true);
        try {
            await fetch('/api/db/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: 'UPDATE system_configs SET value=$1::jsonb WHERE key=$2',
                    params: [JSON.stringify({ date: serverNow, reset_at: new Date().toISOString(), reset_reason: 'manual sync from Settings' }), 'business_date'],
                }),
            }).then(r => r.json());
            toast({ title: 'Business date synced', description: `Set to ${serverNow}.` });
            load();
        } catch (e: any) {
            toast({ title: 'Sync failed', description: e?.message, variant: 'destructive' });
        }
        setFixing(false);
    };

    const Row = ({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) => (
        <div className="flex items-center justify-between py-2 border-b last:border-0">
            <span className="text-sm text-gray-600">{label}</span>
            <span className={`text-sm font-medium ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
        </div>
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5" /> System Dates</CardTitle>
                <CardDescription>The dates the system is operating on. The business date drives folio posting, reports, and the night audit.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading dates…</div>
                ) : (
                    <>
                        <Row label="System Business Date" value={businessDate} />
                        <Row label="Last Night Audit" value={lastAudit} />
                        <Row label="Server Date (live)" value={serverNow} />
                        <Row label="This Device's Date" value={browserToday} />

                        {drift ? (
                            <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-amber-800">Business date is ahead of the real date</p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        It's set to <span className="font-mono">{businessDate}</span> but today is <span className="font-mono">{reference}</span>.
                                        This usually happens after a manual night-audit run and can break automatic audits. Sync it back to today.
                                    </p>
                                    <Button size="sm" className="mt-2 bg-amber-600 hover:bg-amber-700 text-white" disabled={fixing} onClick={syncToToday}>
                                        {fixing ? 'Syncing…' : `Sync business date to ${reference}`}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
                                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                                <p className="text-sm text-green-800">Dates are in sync. The night audit will roll over normally.</p>
                            </div>
                        )}

                        <div className="mt-3 flex justify-end">
                            <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

// ─── Options ───────────────────────────────────────────────────────────────

const THEME_PRESETS = [
    { id: 'light', name: 'Default Light', primary: '#2563eb', sidebar: '#111827', bg: '#f3f4f6' },
    { id: 'dark', name: 'Default Dark', primary: '#3b82f6', sidebar: '#0a0f1a', bg: '#0f172a' },
    { id: 'ocean', name: 'Ocean Blue', primary: '#0ea5e9', sidebar: '#0c1929', bg: '#f0f9ff' },
    { id: 'forest', name: 'Forest Green', primary: '#16a34a', sidebar: '#0d1f14', bg: '#f0fdf4' },
    { id: 'royal', name: 'Royal Purple', primary: '#9333ea', sidebar: '#130d22', bg: '#faf5ff' },
    { id: 'sunset', name: 'Warm Sunset', primary: '#f97316', sidebar: '#1c1208', bg: '#fff7ed' },
    { id: 'slate', name: 'Executive Slate', primary: '#475569', sidebar: '#0f172a', bg: '#f8fafc' },
    { id: 'bronze', name: 'Bronze Warmth 🟤', primary: '#BB7338', sidebar: '#1C1410', bg: '#FDF7F0' },
];


const CURRENCIES = [
    { code: 'USD', label: 'US Dollar ($)' },
    { code: 'EUR', label: 'Euro (€)' },
    { code: 'GBP', label: 'British Pound (£)' },
    { code: 'ZWL', label: 'Zimbabwean Dollar (ZWL)' },
    { code: 'ZAR', label: 'South African Rand (R)' },
    { code: 'KES', label: 'Kenyan Shilling (KSh)' },
    { code: 'NGN', label: 'Nigerian Naira (₦)' },
    { code: 'GHS', label: 'Ghanaian Cedi (₵)' },
    { code: 'TZS', label: 'Tanzanian Shilling (TSh)' },
    { code: 'UGX', label: 'Ugandan Shilling (UGX)' },
];

const TIMEZONES = [
    { value: 'Africa/Harare', label: 'Harare (CAT, UTC+2)' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST, UTC+2)' },
    { value: 'Africa/Nairobi', label: 'Nairobi (EAT, UTC+3)' },
    { value: 'Africa/Lagos', label: 'Lagos (WAT, UTC+1)' },
    { value: 'Africa/Accra', label: 'Accra (GMT, UTC+0)' },
    { value: 'Africa/Cairo', label: 'Cairo (EET, UTC+2)' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris/Amsterdam (CET, UTC+1)' },
    { value: 'America/New_York', label: 'New York (EST/EDT)' },
    { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST, UTC+4)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)' },
];

const DATE_FORMATS = [
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/01/2026)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (01/31/2026)' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-01-31)' },
    { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY (31-01-2026)' },
    { value: 'DD MMM YYYY', label: 'DD MMM YYYY (31 Jan 2026)' },
];

// ─── Component ─────────────────────────────────────────────────────────────

const SystemSettings = () => {
    const { settings, updateSettings, isLoading } = useSettings();
    const { toast } = useToast();
    const navigate = useNavigate();

    const [form, setForm] = useState<Omit<AppSettings, 'themeColors'> & { themeColors?: any }>({
        ...settings,
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        if (!isLoading) {
            setForm({ ...settings });
        }
    }, [isLoading, settings]);

    const set = (key: keyof AppSettings, value: any) =>
        setForm(prev => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Derive theme colors from preset
            const preset = THEME_PRESETS.find(p => p.id === form.themePreset);
            const patch: Partial<AppSettings> = {
                hotelName: form.hotelName,
                hotelTagline: form.hotelTagline,
                logoUrl: form.logoUrl,
                backgroundImageUrl: form.backgroundImageUrl,
                themePreset: form.themePreset,
                themeColors: preset ? { primary: preset.primary, background: preset.bg } : form.themeColors,
                address: form.address,
                phone: form.phone,
                email: form.email,
                website: form.website,
                currency: form.currency,
                timezone: form.timezone,
                dateFormat: form.dateFormat,
                receiptFooter: form.receiptFooter,
            };
            const ok = await updateSettings(patch);

            // Persist branding to DB so each property deployment shows correct name/logo
            const brandingOps = [
              { key: 'hotel_name', val: form.hotelName },
              { key: 'hotel_address', val: form.address },
              { key: 'hotel_phone', val: form.phone },
              { key: 'hotel_email', val: form.email },
              { key: 'hotel_website', val: form.website },
              { key: 'hotel_logo_url', val: form.logoUrl },
              { key: 'hotel_receipt_footer', val: form.receiptFooter },
            ].filter(o => o.val !== undefined && o.val !== null).map(o => ({
              sql: `INSERT INTO system_configs (key, value) VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
              params: [o.key, JSON.stringify(o.val)]
            }));
            if (brandingOps.length > 0) {
              await db.transaction(brandingOps);
              // Update receipt branding cache so Z-readings pick up new name immediately
              invalidateReceiptBrandingCache();
              if (form.hotelName) {
                writeReceiptBranding({
                  restaurant_name: form.hotelName,
                  address: form.address,
                  phone: form.phone,
                  email: form.email,
                  website: form.website,
                  logo_url: form.logoUrl,
                  footer_text: form.receiptFooter,
                });
              }
            }

            if (ok) {
                toast({ title: 'Settings saved', description: 'All settings have been updated successfully.' });
            } else {
                toast({ title: 'Partial save', description: 'Some settings could not be saved.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            // Trigger the backend export
            const response = await fetch('/api/system/db-export');
            if (!response.ok) throw new Error('Export failed');

            // Download the blob
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `corepms_backup_${new Date().toISOString().split('T')[0]}.sql`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast({ title: 'Export Successful', description: 'Database backup has been downloaded.' });
        } catch (error: any) {
            toast({ title: 'Export Failed', description: error.message, variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="p-6 max-w-4xl mx-auto space-y-6 pb-24">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h2 className="text-2xl font-bold">System Settings</h2>
                        <p className="text-sm text-gray-500">Configure your property's identity, appearance, and regional preferences.</p>
                    </div>
                </div>

                {/* ── System Dates (diagnostic) ── */}
                <SystemDatesCard />

                {/* ── 1. Hotel Identity ── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Hotel Identity</CardTitle>
                        <CardDescription>Basic information shown on the login screen, receipts, and reports.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="hotelName">Hotel / Company Name</Label>
                            <Input id="hotelName" value={form.hotelName} onChange={e => set('hotelName', e.target.value)} placeholder="e.g. Villa Gianni" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hotelTagline">Tagline / Subtitle <span className="text-gray-400 text-xs">(shown under name on login)</span></Label>
                            <Input id="hotelTagline" value={form.hotelTagline || ''} onChange={e => set('hotelTagline', e.target.value)} placeholder="e.g. Boutique Hotel & Spa" />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="logoUrl">Logo Image URL</Label>
                            <Input id="logoUrl" value={form.logoUrl} onChange={e => set('logoUrl', e.target.value)} placeholder="/logo.png or https://…" />
                            {form.logoUrl && (
                                <div className="mt-2 p-3 border rounded-md bg-gray-50 inline-block">
                                    <img src={form.logoUrl} alt="Logo preview" className="max-h-14 object-contain"
                                        onError={e => (e.currentTarget.style.display = 'none')}
                                        onLoad={e => (e.currentTarget.style.display = 'block')} />
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* ── 2. Contact & Location ── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5" /> Contact & Location</CardTitle>
                        <CardDescription>Appears on receipts, invoices, and email footers.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="address">Physical Address</Label>
                            <Input id="address" value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Hotel Street, City, Country" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone Number</Label>
                            <Input id="phone" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="+263 77 123 4567" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address</Label>
                            <Input id="email" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="info@myhotel.com" />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                            <Label htmlFor="website">Website URL</Label>
                            <Input id="website" value={form.website || ''} onChange={e => set('website', e.target.value)} placeholder="https://www.myhotel.com" />
                        </div>
                    </CardContent>
                </Card>

                {/* ── 3. Regional Settings ── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">🌍 Regional Settings</CardTitle>
                        <CardDescription>Currency, timezone, and date display format used throughout the system.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Currency</Label>
                            <Select value={form.currency || 'USD'} onValueChange={val => set('currency', val)}>
                                <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Timezone</Label>
                            <Select value={form.timezone || 'Africa/Harare'} onValueChange={val => set('timezone', val)}>
                                <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {TIMEZONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Date Format</Label>
                            <Select value={form.dateFormat || 'DD/MM/YYYY'} onValueChange={val => set('dateFormat', val)}>
                                <SelectTrigger id="dateFormat"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DATE_FORMATS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>

                {/* ── 4. Theme & Appearance ── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Palette className="w-5 h-5" /> Theme & Appearance</CardTitle>
                        <CardDescription>Color theme and background for the application.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-3">
                            <Label>Color Preset</Label>
                            <RadioGroup
                                value={form.themePreset || 'light'}
                                onValueChange={val => set('themePreset', val)}
                                className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3"
                            >
                                {THEME_PRESETS.map(preset => (
                                    <div key={preset.id}
                                        className={`flex flex-col gap-2 border-2 rounded-xl p-3 cursor-pointer transition-all ${form.themePreset === preset.id ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent hover:border-gray-200 hover:shadow'}`}
                                        style={form.themePreset === preset.id ? { borderColor: preset.primary } : {}}
                                        onClick={() => set('themePreset', preset.id)}
                                    >
                                        {/* Mini theme preview */}
                                        <div className="w-full h-12 rounded-lg overflow-hidden flex shadow-sm border border-gray-100">
                                            {/* Sidebar strip */}
                                            <div className="w-5 h-full flex-shrink-0" style={{ backgroundColor: preset.sidebar }} />
                                            {/* Main area */}
                                            <div className="flex-1 flex items-center gap-1 px-2" style={{ backgroundColor: preset.bg }}>
                                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: preset.primary }} />
                                                <div className="h-1.5 rounded-full flex-1" style={{ backgroundColor: preset.primary, opacity: 0.2 }} />
                                            </div>
                                        </div>
                                        {/* Label row */}
                                        <div className="flex items-center gap-2">
                                            <RadioGroupItem value={preset.id} id={`preset-${preset.id}`} />
                                            <Label htmlFor={`preset-${preset.id}`} className="cursor-pointer text-sm font-medium leading-tight">{preset.name}</Label>
                                        </div>
                                    </div>
                                ))}
                            </RadioGroup>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="bgUrl">Custom Background Image URL <span className="text-gray-400 text-xs">(overrides preset background)</span></Label>
                            <Input id="bgUrl" value={form.backgroundImageUrl || ''} onChange={e => set('backgroundImageUrl', e.target.value)}
                                placeholder="https://example.com/bg.jpg — leave empty for colour background" />
                        </div>
                    </CardContent>
                </Card>

                {/* ── 5. Receipt / Document Settings ── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Receipt className="w-5 h-5" /> Receipt & Document Settings</CardTitle>
                        <CardDescription>Text printed on POS receipts and invoices.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="receiptFooter">Receipt Footer Message</Label>
                            <Textarea id="receiptFooter" rows={3} value={form.receiptFooter || ''} onChange={e => set('receiptFooter', e.target.value)}
                                placeholder="e.g. Thank you for staying with us! We hope to see you again." />
                            <p className="text-xs text-gray-500">Displayed at the bottom of every POS receipt and folio invoice.</p>
                        </div>
                    </CardContent>
                </Card>

                {/* ── 6. Maintenance & Backup ── */}
                <Card className="border-orange-100 bg-orange-50/30">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-orange-800">
                            <Database className="w-5 h-5" /> Maintenance & Backup
                        </CardTitle>
                        <CardDescription>Keep your data safe by performing regular exports.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-white border rounded-lg shadow-sm">
                            <div className="space-y-1">
                                <h4 className="font-medium text-gray-900">Database Export (.sql)</h4>
                                <p className="text-sm text-gray-500">Downloads a full SQL dump of your database tables and data.</p>
                            </div>
                            <Button 
                                variant="outline" 
                                onClick={handleExport} 
                                disabled={isExporting}
                                className="border-orange-200 hover:bg-orange-100 text-orange-700 font-semibold"
                            >
                                {isExporting ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting...</>
                                ) : (
                                    <><Download className="mr-2 h-4 w-4" /> Export & Download</>
                                )}
                            </Button>
                        </div>
                        <p className="text-xs text-orange-600/70 italic px-1">
                            Note: This process may take a few seconds depending on the size of your database.
                        </p>
                    </CardContent>
                </Card>

            </div>

            {/* ── Sticky Save Bar ── */}
            <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur-sm shadow-lg">
                <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    <p className="text-sm text-gray-500">Changes are not saved until you click Save.</p>
                    <Button onClick={handleSave} disabled={isSaving} size="lg" className="min-w-[180px]">
                        {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : '💾 Save All Settings'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default SystemSettings;
