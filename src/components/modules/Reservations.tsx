import React, { useEffect, useRef, useState } from 'react';
import { useData } from '../../context/DataContext';
import { OriginRegionSelect } from '../ui/OriginRegionSelect';
import { isValidIdDocumentNumber, isValidIdForNationality, detectNationalityFromId } from '@/lib/validators';
import { decryptSensitive } from '@/lib/crypto';
import { NationalitySelect } from '../ui/NationalitySelect';
import { getRegionForCountry } from '@/lib/regionMapping';
import { formatCurrency, calculateTaxBreakdown } from '@/lib/posIntegration';
import taxSvc from '@/lib/taxService';
import { readReceiptBranding } from '@/lib/printSettings';
import { applySettingsToHTML } from '@/lib/printSettings';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import GuestLookupModal from '@/components/ui/GuestLookupModal';
import ratePlanService from '@/lib/ratePlanService';
import { getResPackageLabel, computeTotalRate, sanitizePackageCode, getResPackageLabelAsync, computeTotalRateAsync, PackageOption } from '@/lib/packageUtils';
import { useDynamicPackageOptions } from '@/hooks/useDynamicPackageOptions';
import { RoomGridModal } from './RoomGridModal';
import { RoomGrid } from './RoomGrid';
import { addDays, format } from 'date-fns';

// Dynamic package options will be loaded from Breakfast module via the custom hook

export const Reservations: React.FC = () => {
  const { reservations, rooms, reservationsLastSyncAt, createReservation, updateReservation, dataError } = useData();
  const { toast } = useToast();
  const { packageOptions, loading: loadingPackages, error: packageError } = useDynamicPackageOptions();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [showNewForm, setShowNewForm] = useState(false);
  const [roomGridOpen, setRoomGridOpen] = useState(false);
  const [editingReservationId, setEditingReservationId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    roomId: '',
    guestName: '',
    email: '',
    phone: '',
    idDocumentNumber: '',
    idDocumentType: 'Passport',
    nationalityCode: '',
    nationalityName: '',
    checkIn: '',
    checkOut: '',
    originRegion: '',
    roomType: '',
    roomPreference: 'Non-smoking',
    bookingName: '',
    bookingType: 'Individual',
    companyName: '',
    bookingSource: '',
    partnerCode: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmTerm: '',
    utmContent: '',
    paymentMethod: 'Credit Card',
    settleAtCheckout: true,
    rate: 0,
    packageCode: 'RO',
    taxInclusive: true,
    adults: 2,
    children: 0,
    // Payment verification fields
    paymentInfoSource: '',
    paymentVerified: false,
    paymentInstructions: '',
    termsAccepted: false,
    signatureDataUrl: ''
  });
  const [formError, setFormError] = useState('');
  const [idDocError, setIdDocError] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const [lastAutosaveToastAt, setLastAutosaveToastAt] = useState<number>(0);
  const [lookupOpen, setLookupOpen] = useState<boolean>(false);
  const [bookingSourceDialogOpen, setBookingSourceDialogOpen] = useState(false);
  const [bookingSourceDialogType, setBookingSourceDialogType] = useState<string>('');
  const [bookingSourceDialogValues, setBookingSourceDialogValues] = useState<Record<string, string>>({});
  const [bookingSourceDialogErrors, setBookingSourceDialogErrors] = useState<Record<string, string>>({});
  const bookingNameRef = useRef<HTMLInputElement | null>(null);
  const roomTypeRef = useRef<HTMLSelectElement | null>(null);
  const [roomTypeOptions, setRoomTypeOptions] = useState<string[]>([]);
  const [roomTypeError, setRoomTypeError] = useState<string | null>(null);
  const [rateSuggestion, setRateSuggestion] = useState<{ base: number; regionAdjPct: number; seasonAdjPct: number; total: number } | null>(null);
  const [outOfSyncRoomType, setOutOfSyncRoomType] = useState<boolean>(false);

  // Reservation status filter & universal search
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'checked-in' | 'checked-out' | 'cancelled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const displayReservations = React.useMemo(() => {
    let list = reservations || [];
    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((r: any) => {
        const s = String(r.status || 'confirmed').toLowerCase();
        return s === statusFilter;
      });
    }
    // Universal text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r: any) =>
        (r.guestName || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.phone || '').toLowerCase().includes(q) ||
        (r.bookingSource || '').toLowerCase().includes(q) ||
        (r.id || '').toLowerCase().includes(q) ||
        (r.roomType || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [reservations, statusFilter, searchQuery]);

  useEffect(() => {
    try {
      const cfg = ratePlanService.getConfig();
      const configOptions = Object.keys(cfg.baseRates || {});
      const dbRoomTypes = rooms ? Array.from(new Set(rooms.map((r: any) => r.type).filter(Boolean))) : [] as string[];
      const mergedOptions = Array.from(new Set([...configOptions, ...dbRoomTypes])).sort() as string[];

      setRoomTypeOptions(mergedOptions);
      setRoomTypeError(mergedOptions.length ? null : 'No room types configured. Please add them in Rate Management.');

      // If a default rate is meaningful, prefill from base rate
      if (!formData.roomType && mergedOptions.length > 0) {
        const nextType = mergedOptions[0] as string;
        const baseRate = prevRateFromConfig(nextType, cfg);
        setFormData(prev => ({ ...prev, roomType: nextType, rate: prev.rate || baseRate }));
      }
    } catch {
      setRoomTypeOptions([]);
      setRoomTypeError('Failed to load room types. Please retry.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  const prevRateFromConfig = (roomType?: string, cfg?: any): number => {
    try {
      const config = cfg || ratePlanService.getConfig();
      const rt = roomType || '';
      const v = Number((config.baseRates || {})[rt] || 0);
      return isNaN(v) ? 0 : v;
    } catch {
      return 0;
    }
  };

  const bookingSourceFieldDefs: Record<string, { id: string; label: string; type: 'text' | 'email' | 'combobox'; required?: boolean; options?: { value: string; label: string }[] }[]> = {
    website: [
      { id: 'utmSource', label: 'UTM Source', type: 'text', required: true },
      { id: 'utmMedium', label: 'UTM Medium', type: 'text', required: true },
      { id: 'utmCampaign', label: 'UTM Campaign', type: 'text' }
    ],
    ota: [
      {
        id: 'otaProvider', label: 'OTA Provider', type: 'combobox', required: true, options: [
          { value: 'Booking.com', label: 'Booking.com' },
          { value: 'Expedia', label: 'Expedia' },
          { value: 'Airbnb', label: 'Airbnb' },
          { value: 'Agoda', label: 'Agoda' }
        ]
      },
      { id: 'reservationId', label: 'OTA Reservation ID', type: 'text', required: true }
    ],
    agent: [
      {
        id: 'agencyName', label: 'Agency Name', type: 'combobox', required: true, options: [
          { value: 'Global Travel Co', label: 'Global Travel Co' },
          { value: 'Premier Agents Ltd', label: 'Premier Agents Ltd' },
          { value: 'Sunset Tours', label: 'Sunset Tours' }
        ]
      },
      { id: 'partnerCode', label: 'Partner Code', type: 'text', required: true },
      { id: 'contactEmail', label: 'Contact Email', type: 'email' }
    ],
    referral: [
      { id: 'referrerName', label: 'Referrer Name', type: 'text', required: true },
      { id: 'referrerContact', label: 'Referrer Contact', type: 'text' }
    ]
  };

  const openBookingSourceDialog = (type: string) => {
    setBookingSourceDialogType(type);
    setBookingSourceDialogErrors({});
    setBookingSourceDialogValues({});
    setTimeout(() => setBookingSourceDialogOpen(true), 300);
  };

  const validateBookingSourceDialog = (): boolean => {
    const defs = bookingSourceFieldDefs[bookingSourceDialogType] || [];
    const nextErrors: Record<string, string> = {};
    defs.forEach(def => {
      const val = (bookingSourceDialogValues[def.id] || '').trim();
      if (def.required && !val) nextErrors[def.id] = 'This field is required';
      if (def.type === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) nextErrors[def.id] = 'Enter a valid email';
    });
    setBookingSourceDialogErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const applyBookingSourceDialog = () => {
    if (!validateBookingSourceDialog()) return;
    const defs = bookingSourceFieldDefs[bookingSourceDialogType] || [];
    const payload: Record<string, string> = {};
    defs.forEach(def => { payload[def.id] = bookingSourceDialogValues[def.id] || ''; });
    setFormData(prev => ({
      ...prev,
      utmSource: payload.utmSource || prev.utmSource,
      utmMedium: payload.utmMedium || prev.utmMedium,
      utmCampaign: payload.utmCampaign || prev.utmCampaign,
      partnerCode: payload.partnerCode || prev.partnerCode,
      paymentInfoSource: payload.otaProvider ? `Third-party OTA (${payload.otaProvider})` : prev.paymentInfoSource
    }));
    setBookingSourceDialogOpen(false);
  };

  // Cleanup signature-related state and verify removal of Guest Confirmation DOM
  useEffect(() => {
    setFormData(prev => ({ ...prev, signatureDataUrl: '', termsAccepted: false }));
    try {
      const selector = '.p-4.bg-blue-50.border.border-blue-200.rounded-lg.mt-3';
      const target = document.querySelector(selector);
      if (target && target.parentElement) {
        target.parentElement.removeChild(target);
      }
      const exists = !!document.querySelector(selector);
      console.info('Guest Confirmation element removed:', !exists);
    } catch (err) {
      console.warn('Guest Confirmation removal check error:', err);
    }
  }, []);

  // Auto-update region when editing and nationality is set but region is missing or incorrect
  useEffect(() => {
    if (editingReservationId && formData.nationalityCode && !formData.originRegion) {
      // If editing a reservation and nationality is set but no region, auto-set it
      const region = getRegionForCountry(formData.nationalityCode);
      if (region && region !== formData.originRegion) {
        setFormData(prev => ({ ...prev, originRegion: region }));
      }
    }
  }, [editingReservationId, formData.nationalityCode]);

  // Build print-ready HTML for a reservation
  const buildReservationPrintHTML = async (data: any) => {
    const ci = new Date(data.checkIn);
    const co = new Date(data.checkOut);
    const nights = (!isNaN(ci.getTime()) && !isNaN(co.getTime())) ? Math.max(0, Math.ceil((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24))) : 0;
    const totalBase = Number(data.rate || 0) * (nights || 1);
    const calc = await taxSvc.calculateTaxesForAmount(Number(totalBase), 'accommodation');
    const tb = { subtotal: calc.subtotal, tax: calc.taxTotal, total: calc.total };
    const brand = readReceiptBranding();
    const contactHTML = `
      ${brand.address ? `<div>${brand.address}</div>` : ''}
      ${brand.phone ? `<div>Phone: ${brand.phone}</div>` : ''}
      ${brand.email ? `<div>Email: ${brand.email}</div>` : ''}
    `;
    const showConfidential = !!(data.partnerCode || String(data.bookingSource).toLowerCase() === 'agent');
    const htmlBody = `
      <!-- ReceiptBrandingApplied -->
      <style>
        .doc { font-family: system-ui, Arial, sans-serif; color: #111; }
        .doc h1 { font-size: 20px; margin: 8px 0 4px; }
        .doc h2 { font-size: 16px; margin: 12px 0 6px; color: #333; }
        .doc .header { text-align: center; margin-bottom: 8px; }
        .doc .contact { text-align: center; font-size: 12px; color: #444; margin-top: 4px; }
        .doc .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .doc .section { border: 1px solid #e5e7eb; padding: 10px; border-radius: 6px; margin-bottom: 10px; }
        .doc .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #eee; }
        .doc .row:last-child { border-bottom: none; }
        .doc .label { color: #555; }
        .doc .value { font-weight: 600; color: #111; }
        .doc .signature { margin-top: 16px; }
        .doc .signature .line { margin: 8px 0; }
        .doc .signature .line .placeholder { display: inline-block; min-width: 240px; border-bottom: 1px solid #111; }
        .doc .notes { font-size: 13px; color: #333; white-space: pre-wrap; }
        .doc .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 60px; color: rgba(100,100,100,0.13); z-index: 0; pointer-events: none; }
        @media print {
          .doc .screen-only { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
      ${showConfidential ? '<div class="watermark">Confidential</div>' : ''}
      <div class="doc">
        <div class="header">
          <h1>Reservation Details</h1>
          <div class="contact">${contactHTML}</div>
        </div>
        <div class="section">
          <h2>Guest</h2>
          <div class="row"><span class="label">Guest Name(s)</span><span class="value">${data.guestName || '-'}</span></div>
          <div class="row"><span class="label">Booking Name</span><span class="value">${data.bookingName || data.guestName || '-'}</span></div>
          <div class="row"><span class="label">Nationality</span><span class="value">${data.nationalityName || data.nationalityCode || '-'}</span></div>
          <div class="row"><span class="label">ID Type</span><span class="value">${data.idDocumentType || '-'}</span></div>
        </div>
        <div class="grid">
          <div class="section">
            <h2>Stay</h2>
            <div class="row"><span class="label">Check-In</span><span class="value">${data.checkIn || '-'}</span></div>
            <div class="row"><span class="label">Check-Out</span><span class="value">${data.checkOut || '-'}</span></div>
            <div class="row"><span class="label">Nights</span><span class="value">${nights || '-'}</span></div>
            <div class="row"><span class="label">Adults</span><span class="value">${data.adults ?? '-'}</span></div>
            <div class="row"><span class="label">Children</span><span class="value">${data.children ?? '-'}</span></div>
          </div>
          <div class="section">
            <h2>Room / Service</h2>
            <div class="row"><span class="label">Room Type</span><span class="value">${data.roomType || '-'}</span></div>
            <div class="row"><span class="label">Preference</span><span class="value">${data.roomPreference || '-'}</span></div>
            <div class="row"><span class="label">Source</span><span class="value">${data.bookingSource || '-'}</span></div>
            <div class="row"><span class="label">Partner Code</span><span class="value">${data.partnerCode || '-'}</span></div>
          </div>
        </div>
        <div class="section">
          <h2>Pricing</h2>
          <div class="row"><span class="label">Nightly Rate</span><span class="value">${formatCurrency(Number(data.rate || 0))}</span></div>
          <div class="row"><span class="label">Subtotal</span><span class="value">${formatCurrency(tb.subtotal)}</span></div>
          <div class="row"><span class="label">Tax</span><span class="value">${formatCurrency(tb.tax)}</span></div>
          <div class="row"><span class="label">Total</span><span class="value">${formatCurrency(tb.total)}</span></div>
        </div>
        <div class="section">
          <h2>Special Requests / Notes</h2>
          <div class="notes">${(data.paymentInstructions || data.notes || '') || 'None'}</div>
        </div>
        <div class="section signature">
          <h2>Client Signature</h2>
          <div class="line">Printed Name: <span class="placeholder">&nbsp;</span></div>
          <div class="line">Signature: <span class="placeholder">&nbsp;</span></div>
          <div class="line">Date: <span class="placeholder">&nbsp;</span></div>
        </div>
      </div>
    `;
    return htmlBody;
  };

  const handlePrintCurrentForm = async () => {
    const html = await buildReservationPrintHTML(formData);
    const doc = applySettingsToHTML('Reservation Details', html);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(doc);
    w.document.close();
    try { w.focus(); } catch { }
    try { w.print(); } catch { }
  };

  // Autosave draft in localStorage
  useEffect(() => {
    try {
      const key = 'reservation_draft_v1';
      const saved = localStorage.getItem(key);
      if (!editingReservationId && saved) {
        const parsed = JSON.parse(saved);
        setFormData(prev => ({ ...prev, ...parsed }));
      }
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      const key = 'reservation_draft_v1';
      if (!editingReservationId) {
        localStorage.setItem(key, JSON.stringify(formData));
        // Throttle autosave toast to at most once per minute
        const now = Date.now();
        if (now - lastAutosaveToastAt > 60_000) {
          toast({ title: 'Draft autosaved', description: 'Your reservation form is saved locally.' });
          setLastAutosaveToastAt(now);
        }
      }
    } catch { }
  }, [formData, editingReservationId, lastAutosaveToastAt, toast]);

  useEffect(() => {
    const applySync = () => {
      try {
        const cfg = ratePlanService.getConfig();
        const configOptions = Object.keys(cfg.baseRates || {});

        // Merge with room types found in actual rooms database to ensure availability
        const dbRoomTypes = rooms ? Array.from(new Set(rooms.map((r: any) => r.type).filter(Boolean))) : [];
        const mergedOptions = Array.from(new Set([...configOptions, ...dbRoomTypes])).sort();

        setRoomTypeOptions(mergedOptions);
        setOutOfSyncRoomType(!!(formData.roomType && !mergedOptions.includes(formData.roomType)));

        if (mergedOptions.length === 0) {
          setRoomTypeError('No room types configured. Please add them in Rate Management.');
        } else {
          setRoomTypeError(null);
        }
      } catch (err) {
        console.error('Failed to sync room types:', err);
        // Fallback to basic if crash, but keep existing if available
        if (roomTypeOptions.length === 0) {
          setRoomTypeOptions(['Standard King', 'Standard Twin', 'Deluxe Queen', 'Suite']);
        }
      }
    };
    applySync();
    const unsub = ratePlanService.subscribeRateConfig(() => applySync());
    const interval = setInterval(applySync, 15 * 60 * 1000);
    return () => { try { unsub(); } catch { }; clearInterval(interval); };
  }, [formData.roomType, rooms]);

  useEffect(() => {
    if (roomTypeOptions.length === 0) return;
    if (!formData.roomType || outOfSyncRoomType) {
      const nextType = roomTypeOptions[0];
      const baseRate = prevRateFromConfig(nextType);
      setFormData(prev => ({ ...prev, roomType: nextType, rate: prev.rate || baseRate }));
    }
  }, [roomTypeOptions, outOfSyncRoomType]);

  useEffect(() => {
    if (!formData.roomType || !formData.originRegion || !formData.checkIn) { setRateSuggestion(null); return; }
    const breakdown = ratePlanService.computeRateBreakdown({ roomType: formData.roomType, originRegion: formData.originRegion, date: formData.checkIn });
    setRateSuggestion(breakdown);
    try { ratePlanService.logRateAudit({ type: 'calc', roomType: formData.roomType, originRegion: formData.originRegion, date: formData.checkIn, suggested: breakdown.total, base: breakdown.base, regionAdjPct: breakdown.regionAdjPct, seasonAdjPct: breakdown.seasonAdjPct }); } catch { }
    const bounds = ratePlanService.getRateBounds(formData.roomType);
    const val = Number(formData.rate || 0);
    if (val > 0 && (val < bounds.min || val > bounds.max)) {
      setFieldErrors(prev => ({ ...prev, rate: `Rate outside thresholds (${bounds.min}-${bounds.max})` }));
    } else {
      setFieldErrors(prev => ({ ...prev, rate: '' }));
    }
  }, [formData.roomType, formData.originRegion, formData.checkIn, formData.rate]);

  useEffect(() => {
    const editId = sessionStorage.getItem('reservationEditId');
    if (editId) {
      const res = reservations.find(r => r.id === editId);
      if (res) {
        setEditingReservationId(res.id);
        setFormData({
          roomId: (res as any).room_id || (res as any).roomId || '',
          guestName: res.guestName,
          email: res.email || '',
          phone: res.phone || '',
          idDocumentNumber: (res as any).idDocumentNumberEncrypted ? decryptSensitive((res as any).idDocumentNumberEncrypted) : '',
          idDocumentType: res.idDocumentType || 'Passport',
          nationalityCode: res.nationalityCode || '',
          nationalityName: res.nationalityName || '',
          checkIn: (() => { const d = new Date(res.checkIn); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); })(),
          checkOut: (() => { const d = new Date(res.checkOut); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); })(),
          originRegion: (res as any).originRegion || '',
          roomType: res.roomType,
          roomPreference: res.roomPreference || 'Non-smoking',
          bookingName: res.bookingName || '',
          bookingType: res.bookingType || 'Individual',
          companyName: res.companyName || '',
          bookingSource: res.bookingSource || '',
          partnerCode: res.partnerCode || '',
          utmSource: res.utmSource || '',
          utmMedium: res.utmMedium || '',
          utmCampaign: res.utmCampaign || '',
          utmTerm: res.utmTerm || '',
          utmContent: res.utmContent || '',
          paymentMethod: res.paymentMethod || 'Credit Card',
          settleAtCheckout: res.settleAtCheckout !== false,
          rate: res.rate,
          packageCode: (res as any).packageCode || (res as any).package_code || 'RO',
          taxInclusive: !!(res as any).taxInclusive,
          adults: res.adults,
          children: res.children || 0,
          paymentInfoSource: res.paymentInfoSource || '',
          paymentVerified: !!res.paymentVerified,
          paymentInstructions: '',
          termsAccepted: !!res.termsAccepted,
          signatureDataUrl: ''
        });
        setShowNewForm(true);
      }
      sessionStorage.removeItem('reservationEditId');
    }
    // Capture UTM params if present
    try {
      const params = new URLSearchParams(window.location.search);
      const utmUpdate: any = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(k => {
        const val = params.get(k);
        if (val) utmUpdate[camelCase(k)] = val;
      });
      if (Object.keys(utmUpdate).length) setFormData(prev => ({ ...prev, ...utmUpdate, bookingSource: prev.bookingSource || 'website' }));
    } catch { }
  }, [reservations]);

  function camelCase(input: string) {
    return input.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/^utm/, 'utm');
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : name === 'rate' || name === 'adults' || name === 'children'
          ? (value === '' ? 0 : parseInt(value))
          : value
    }));

    // Clear field error on change
    if (fieldErrors[name]) {
      setFieldErrors(prev => ({ ...prev, [name]: '' }));
    }

    // Validate on blur for required fields
    if (type !== 'checkbox') {
      const error = validateField(name, value);
      if (error) {
        setFieldErrors(prev => ({ ...prev, [name]: error }));
      } else {
        setFieldErrors(prev => ({ ...prev, [name]: '' }));
      }
    }

    if (name === 'idDocumentNumber') {
      const trimmed = String(value).trim();
      const okBase = isValidIdDocumentNumber(trimmed);
      const okCountry = isValidIdForNationality(trimmed, formData.nationalityCode, formData.idDocumentType as any);
      if (!okBase || !okCountry) {
        setIdDocError('Invalid ID/Passport for selected nationality/type.');
      } else setIdDocError('');
      // Try detect nationality from ID if not selected
      if (!formData.nationalityCode) {
        const detected = detectNationalityFromId(trimmed, formData.idDocumentType as any);
        if (detected) setFormData(prev => ({ ...prev, nationalityCode: detected }));
      }
    }
  };

  const validateField = (name: string, value: string): string => {
    switch (name) {
      case 'guestName':
        return !value.trim() ? 'Guest name is required' : '';
      case 'checkIn':
        return !value ? 'Check-in date is required' : '';
      case 'checkOut':
        return !value ? 'Check-out date is required' : '';
      case 'originRegion':
        return !value ? 'Origin region is required' : '';
      case 'roomType':
        return !value ? 'Room type is required' : '';
      case 'adults':
        const adultsNum = parseInt(value) || 0;
        return adultsNum < 1 ? 'At least 1 adult is required' : '';
      case 'rate':
        const rateNum = parseFloat(value) || 0;
        return rateNum <= 0 ? 'Rate must be greater than 0' : '';
      default:
        return '';
    }
  };

  // Signature pad drawing handlers
  const getCanvasContext = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    return ctx;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    const ctx = getCanvasContext();
    if (!ctx) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const ctx = getCanvasContext();
    if (!ctx) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const onPointerUp = () => {
    isDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    setFormData(prev => ({ ...prev, signatureDataUrl: data }));
  };
  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFormData(prev => ({ ...prev, signatureDataUrl: '' }));
  };

  const isFormValid = (): boolean => {
    // Check required fields with null safety
    if (!(formData.guestName || '').trim()) return false;
    if (!formData.checkIn) return false;
    if (!formData.checkOut) return false;
    if (!formData.roomId) return false; // Add this
    if (!formData.originRegion) return false;
    if (!formData.roomType) return false;
    if ((formData.adults || 0) < 1) return false;
    if ((formData.rate || 0) <= 0) return false;
    // Check field errors
    if (Object.values(fieldErrors).some(e => e)) return false;
    if (idDocError) return false;
    // Check business rules
    if (!isValidIdDocumentNumber(formData.idDocumentNumber || '') || !isValidIdForNationality(formData.idDocumentNumber || '', formData.nationalityCode || '', formData.idDocumentType as any)) return false;
    if (formData.bookingType === 'Group' && !formData.companyName) return false;
    if (!formData.paymentInfoSource) return false;
    if (formData.paymentMethod !== 'Cash' && !formData.paymentVerified) return false;
    if (formData.signatureDataUrl && !formData.termsAccepted) return false;
    return true;
  };

  const nights = (() => {
    const ci = new Date(formData.checkIn);
    const co = new Date(formData.checkOut);
    if (isNaN(ci.getTime()) || isNaN(co.getTime())) return 0;
    const ms = co.getTime() - ci.getTime();
    return ms > 0 ? Math.ceil(ms / (1000 * 60 * 60 * 24)) : 0;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Run full validation
    const errors: Record<string, string> = {};
    if (!(formData.guestName || '').trim()) errors.guestName = 'Guest name is required';
    if (!formData.checkIn) errors.checkIn = 'Check-in date is required';
    if (!formData.checkOut) errors.checkOut = 'Check-out date is required';
    if (!formData.roomId) errors.roomId = 'Room assignment is required'; // Add this
    if (!formData.roomType) errors.roomType = 'Room type is required';
    if ((formData.adults || 0) < 1) errors.adults = 'At least 1 adult is required';
    if ((formData.rate || 0) <= 0) errors.rate = 'Rate must be greater than 0';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please correct the highlighted fields');
      return;
    }

    // Validate ID/Passport with nationality rules (only if ID number is provided)
    if (formData.idDocumentNumber && formData.idDocumentNumber.trim()) {
      if (!isValidIdDocumentNumber(formData.idDocumentNumber) || !isValidIdForNationality(formData.idDocumentNumber, formData.nationalityCode || '', formData.idDocumentType as any)) {
        setFormError('Please provide a valid ID/Passport Number for the selected nationality/type');
        return;
      }
    }

    // Validate booking type and company name
    if (formData.bookingType === 'Group' && !formData.companyName) {
      setFormError('Company name is required for group bookings');
      return;
    }

    // Require payment details verification
    if (!formData.paymentInfoSource) {
      setFormError('Please select the source of payment information');
      return;
    }
    if (formData.paymentMethod !== 'Cash' && !formData.paymentVerified) {
      setFormError('Please confirm your payment details before submission');
      return;
    }

    // Confirm terms if capturing signature
    if (formData.signatureDataUrl && !formData.termsAccepted) {
      setFormError('Please accept the terms and conditions to proceed');
      return;
    }

    const reservationData = {
      guestName: formData.guestName,
      email: formData.email,
      phone: formData.phone,
      idDocumentNumber: formData.idDocumentNumber,
      idDocumentType: formData.idDocumentType as any,
      nationalityCode: formData.nationalityCode,
      nationalityName: formData.nationalityName,
      originRegion: formData.originRegion,
      roomType: formData.roomType,
      roomPreference: formData.roomPreference,
      checkIn: formData.checkIn,
      checkOut: formData.checkOut,
      bookingName: formData.bookingName || formData.guestName,
      bookingType: formData.bookingType,
      companyName: formData.companyName,
      bookingSource: formData.bookingSource,
      partnerCode: formData.partnerCode,
      utmSource: formData.utmSource,
      utmMedium: formData.utmMedium,
      utmCampaign: formData.utmCampaign,
      utmTerm: formData.utmTerm,
      utmContent: formData.utmContent,
      paymentMethod: formData.paymentMethod,
      settleAtCheckout: formData.settleAtCheckout,
      rate: formData.rate,
      adults: formData.adults,
      children: formData.children,
      status: 'confirmed',
      paymentInfoSource: String(formData.paymentInfoSource || '').trim(),
      paymentVerified: formData.paymentVerified,
      termsAccepted: formData.termsAccepted,
      confirmedAt: formData.termsAccepted ? new Date().toISOString() : undefined,
      paymentInstructions: formData.paymentInstructions,
      signatureDataUrl: formData.signatureDataUrl,
      packageCode: formData.packageCode,
      taxInclusive: formData.taxInclusive
    };

    // Auto-normalize cash payment verification if source provided
    if (reservationData.paymentMethod === 'Cash' && String(reservationData.paymentInfoSource || '').trim()) {
      reservationData.paymentVerified = true;
    }

    if (editingReservationId) {
      // Update existing reservation
      const result = await updateReservation(editingReservationId, reservationData);
      if (result.success) {
        toast({ title: 'Reservation updated successfully!', description: reservationData.bookingName || reservationData.guestName });
        alert('Reservation updated successfully!');
      } else {
        setFormError(result.error || 'Failed to update reservation. Please check your inputs.');
        return;
      }
    } else {
      // Create new reservation
      const result = await createReservation(reservationData);
      if (result.success) {
        toast({ title: 'Reservation created successfully!', description: reservationData.bookingName || reservationData.guestName });
        alert('Reservation created successfully!');
      } else {
        setFormError(result.error || 'Failed to create reservation. Please check your inputs.');
        return;
      }
    }

    // Reset form and close it
    setFormData({
      roomId: '',
      guestName: '',
      email: '',
      phone: '',
      idDocumentNumber: '',
      idDocumentType: 'Passport',
      nationalityCode: '',
      nationalityName: '',
      checkIn: '',
      checkOut: '',
      originRegion: '',
      roomType: 'Standard King',
      roomPreference: 'Non-smoking',
      bookingName: '',
      bookingType: 'Individual',
      companyName: '',
      bookingSource: '',
      partnerCode: '',
      utmSource: '',
      utmMedium: '',
      utmCampaign: '',
      utmTerm: '',
      utmContent: '',
      paymentMethod: 'Credit Card',
      settleAtCheckout: true,
      rate: 120,
      packageCode: 'RO',
      taxInclusive: true,
      adults: 2,
      children: 0,
      paymentInfoSource: '',
      paymentVerified: false,
      paymentInstructions: '',
      termsAccepted: false,
      signatureDataUrl: ''
    });
    setShowNewForm(false);
    setEditingReservationId(null);
    setFieldErrors({});
  };

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 flex justify-between items-center mb-6 py-3">
        <h2 className="text-3xl font-bold text-gray-800">Reservations</h2>
        <div className="flex items-center gap-3">
          {reservationsLastSyncAt && (
            <span className="text-xs text-gray-500">Last sync: {new Date(reservationsLastSyncAt).toLocaleTimeString()}</span>
          )}
          <button
            onClick={() => {
              setEditingReservationId(null);
              setFormData({
                roomId: '',
                guestName: '',
                email: '',
                phone: '',
                idDocumentNumber: '',
                idDocumentType: 'Passport',
                nationalityCode: '',
                nationalityName: '',
                checkIn: '',
                checkOut: '',
                originRegion: '',
                roomType: '',
                roomPreference: 'Non-smoking',
                bookingName: '',
                bookingType: 'Individual',
                companyName: '',
                bookingSource: '',
                partnerCode: '',
                utmSource: '',
                utmMedium: '',
                utmCampaign: '',
                utmTerm: '',
                utmContent: '',
                paymentMethod: 'Credit Card',
                settleAtCheckout: true,
                rate: 0,
                packageCode: 'RO',
                taxInclusive: true,
                adults: 2,
                children: 0,
                paymentInfoSource: '',
                paymentVerified: false,
                paymentInstructions: '',
                termsAccepted: false,
                signatureDataUrl: ''
              });
              setShowNewForm(!showNewForm);
            }}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
          >
            {showNewForm ? 'Close Form' : '+ New Reservation'}
          </button>
        </div>
      </div>

      {/* Status Tabs + Search + View Toggle */}
      {!showNewForm && (
        <div className="space-y-3 mb-4">
          {/* Status filter tabs */}
          <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
            {[
              { key: 'all' as const, label: 'All', count: (reservations || []).length },
              { key: 'confirmed' as const, label: 'Confirmed', count: (reservations || []).filter((r: any) => String(r.status || 'confirmed').toLowerCase() === 'confirmed').length },
              { key: 'checked-in' as const, label: 'In-House', count: (reservations || []).filter((r: any) => String(r.status || '').toLowerCase() === 'checked-in').length },
              { key: 'checked-out' as const, label: 'Checked Out', count: (reservations || []).filter((r: any) => String(r.status || '').toLowerCase() === 'checked-out').length },
              { key: 'cancelled' as const, label: 'Cancelled', count: (reservations || []).filter((r: any) => String(r.status || '').toLowerCase() === 'cancelled').length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${statusFilter === tab.key
                    ? 'bg-white shadow text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Search + view toggle row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search by guest name, email, phone, room type, or booking source…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div className="bg-gray-100 p-1 rounded-lg flex">
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${viewMode === 'list' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${viewMode === 'grid' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Grid
              </button>
            </div>
          </div>
          {displayReservations.length === 0 && (reservations || []).length > 0 && (
            <p className="text-center text-sm text-gray-500 py-2">No reservations match your current filters.</p>
          )}
        </div>
      )}

      {showNewForm && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">
            {editingReservationId ? 'Edit Reservation' : 'Create New Reservation'}
          </h3>
          <p className="text-sm text-gray-600 mb-4">Fields marked with * are required</p>
          {formError && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {formError}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-700">Guest Information</h4>
                  <Button variant="outline" onClick={() => setLookupOpen(true)} aria-label="Open guest lookup">Guest Lookup</Button>
                </div>
                <input
                  type="text"
                  name="guestName"
                  value={formData.guestName}
                  onChange={handleInputChange}
                  placeholder="Guest Name *"
                  className={`w-full px-4 py-2 border rounded-lg mb-2 ${fieldErrors.guestName ? 'border-red-500' : ''}`}
                  required
                />
                {fieldErrors.guestName && <p className="text-xs text-red-600 mb-2">{fieldErrors.guestName}</p>}
                {/* Nationality and ID Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                  <NationalitySelect
                    value={formData.nationalityCode}
                    onChange={(code, country) => {
                      // Automatically set the origin region based on nationality
                      const region = getRegionForCountry(code);
                      setFormData(prev => ({
                        ...prev,
                        nationalityCode: code,
                        nationalityName: country?.name || '',
                        originRegion: region
                      }));
                    }}
                    label="Nationality"
                  />
                  <div>
                    <label htmlFor="idDocumentType" className="block text-sm font-medium text-gray-700 mb-1">ID Type</label>
                    <select
                      id="idDocumentType"
                      name="idDocumentType"
                      value={formData.idDocumentType}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="Passport">Passport</option>
                      <option value="ID Card">ID Card</option>
                    </select>
                  </div>
                </div>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Email"
                  className="w-full px-4 py-2 border rounded-lg mb-2"
                />
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="Phone Number"
                  className="w-full px-4 py-2 border rounded-lg mb-2"
                />
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="idDocumentNumber">
                  ID/Passport Number
                </label>
                <input
                  id="idDocumentNumber"
                  type="text"
                  name="idDocumentNumber"
                  value={formData.idDocumentNumber}
                  onChange={handleInputChange}
                  placeholder="Enter ID or Passport number"
                  aria-label="ID or Passport Number"
                  aria-required="false"
                  aria-invalid={idDocError ? "true" : "false"}
                  aria-describedby="idDocHelp idDocError"
                  className={`w-full px-4 py-2 border rounded-lg ${idDocError ? 'border-red-500' : ''}`}
                />
                <p id="idDocHelp" className="text-xs text-gray-500 mt-1">Please enter your valid ID or Passport number</p>
                {idDocError && (
                  <p id="idDocError" className="text-xs text-red-600 mt-1">{idDocError}</p>
                )}
              </div>

              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Booking Information</h4>
                {/* Origin Region (searchable dropdown) */}
                <OriginRegionSelect
                  value={formData.originRegion}
                  onChange={(val) => setFormData(prev => ({ ...prev, originRegion: val }))}
                />
                {fieldErrors.originRegion && <p className="text-xs text-red-600 mb-2">{fieldErrors.originRegion}</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                  <div>
                    <label htmlFor="bookingSource" className="block text-sm font-medium text-gray-700 mb-1">Booking Source</label>
                    <select
                      id="bookingSource"
                      name="bookingSource"
                      title="Booking Source"
                      value={formData.bookingSource}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData(prev => ({ ...prev, bookingSource: val }));
                        if (val && val !== 'walk-in') {
                          openBookingSourceDialog(val);
                        } else {
                          setBookingSourceDialogOpen(false);
                          try { roomTypeRef.current?.focus(); } catch { }
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          const val = (e.currentTarget as HTMLSelectElement).value;
                          if (val && val !== 'walk-in') { e.preventDefault(); openBookingSourceDialog(val); }
                        }
                      }}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="">Select source...</option>
                      <option value="website">Website</option>
                      <option value="ota">OTA</option>
                      <option value="agent">Agent</option>
                      <option value="referral">Referral</option>
                      <option value="walk-in">Walk-in</option>
                    </select>
                  </div>

                </div>

                <input
                  type="text"
                  name="bookingName"
                  value={formData.bookingName}
                  onChange={handleInputChange}
                  placeholder="Booking Name (if different from guest)"
                  className="w-full px-4 py-2 border rounded-lg mb-2"
                  ref={bookingNameRef}
                />
                <select
                  name="bookingType"
                  value={formData.bookingType}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border rounded-lg mb-2"
                >
                  <option value="Individual">Individual</option>
                  <option value="Group">Group</option>
                </select>
                {formData.bookingType === 'Group' && (
                  <input
                    type="text"
                    name="companyName"
                    value={formData.companyName}
                    onChange={handleInputChange}
                    placeholder="Company Name *"
                    className="w-full px-4 py-2 border rounded-lg"
                    required
                  />
                )}
              </div>

              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Room Selection</h4>

                <div className="mb-4">
                  <label htmlFor="assignedRoom" className="block text-sm font-medium text-gray-700 mb-1">Assigned Room <span className="text-red-600">*</span></label>
                  <div className="flex gap-2">
                    <Input
                      id="assignedRoom"
                      value={formData.roomId ? (rooms.find((r: any) => r.id === formData.roomId)?.number || 'Unknown') : 'No Room Selected'}
                      readOnly
                      className={`bg-gray-50 ${!formData.roomId ? 'border-red-500' : ''}`}
                    />
                    <Button type="button" onClick={() => setRoomGridOpen(true)}>Select Room</Button>
                  </div>
                  {!formData.roomId && <p className="text-xs text-red-600 mt-1">Please select a vacant room from the grid.</p>}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const cfg = ratePlanService.getConfig();
                        const options = Object.keys(cfg.baseRates || {});
                        setRoomTypeOptions(options);
                        setOutOfSyncRoomType(!!(formData.roomType && !options.includes(formData.roomType)));
                        ratePlanService.logRateAudit({ type: 'mapping', roomType: formData.roomType });
                      } catch { }
                    }}
                    className="text-xs px-2 py-1 border rounded"
                  >
                    Refresh Room Types
                  </button>
                  {outOfSyncRoomType && <span className="text-xs text-red-600">Selected room type is not in Rate Management</span>}
                </div>
                  <label htmlFor="roomType" className="sr-only">Room Type</label>
                  <select
                    id="roomType"
                    name="roomType"
                    title="Room Type"
                  onChange={handleInputChange}
                  className={`w-full px-4 py-2 border rounded-lg mb-2 ${fieldErrors.roomType ? 'border-red-500' : ''} ${outOfSyncRoomType ? 'border-red-500' : ''}`}
                  ref={roomTypeRef}
                  disabled={roomTypeOptions.length === 0}
                >
                  {roomTypeOptions.length === 0 ? (
                    <option value="">No room types configured</option>
                  ) : (
                    roomTypeOptions.map(rt => (
                      <option key={rt} value={rt}>{rt}</option>
                    ))
                  )}
                </select>
                {fieldErrors.roomType && <p className="text-xs text-red-600 mb-2">{fieldErrors.roomType}</p>}
                {roomTypeError && (
                  <p className="text-xs text-red-600 mt-1">{roomTypeError}</p>
                )}
                <div className="flex gap-2 mb-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="roomPreference"
                      value="Non-smoking"
                      checked={formData.roomPreference === 'Non-smoking'}
                      onChange={handleInputChange}
                      className="mr-2"
                    />
                    Non-smoking
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="roomPreference"
                      value="Smoking"
                      checked={formData.roomPreference === 'Smoking'}
                      onChange={handleInputChange}
                      className="mr-2"
                    />
                    Smoking
                  </label>
                </div>
                <div className="flex gap-4">
                  <input
                    type="number"
                    name="adults"
                    value={formData.adults}
                    onChange={handleInputChange}
                    placeholder="Adults *"
                    className={`w-1/2 px-4 py-2 border rounded-lg ${fieldErrors.adults ? 'border-red-500' : ''}`}
                    min="1"
                    required
                  />
                  {fieldErrors.adults && <p className="text-xs text-red-600 mb-2">{fieldErrors.adults}</p>}
                  <input
                    type="number"
                    name="children"
                    value={formData.children}
                    onChange={handleInputChange}
                    placeholder="Children"
                    className="w-1/2 px-4 py-2 border rounded-lg"
                    min="0"
                  />
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Stay Details</h4>
                <input
                  type="date"
                  name="checkIn"
                  value={formData.checkIn}
                  onChange={handleInputChange}
                  placeholder="Check-In *"
                  className={`w-full px-4 py-2 border rounded-lg mb-2 ${fieldErrors.checkIn ? 'border-red-500' : ''}`}
                  required
                />
                {fieldErrors.checkIn && <p className="text-xs text-red-600 mb-2">{fieldErrors.checkIn}</p>}
                <input
                  type="date"
                  name="checkOut"
                  value={formData.checkOut}
                  onChange={handleInputChange}
                  placeholder="Check-Out *"
                  className={`w-full px-4 py-2 border rounded-lg mb-2 ${fieldErrors.checkOut ? 'border-red-500' : ''}`}
                  required
                />
                {fieldErrors.checkOut && <p className="text-xs text-red-600 mb-2">{fieldErrors.checkOut}</p>}
                <input
                  type="number"
                  name="rate"
                  value={formData.rate}
                  onChange={handleInputChange}
                  placeholder="Rate *"
                  className={`w-full px-4 py-2 border rounded-lg ${fieldErrors.rate ? 'border-red-500' : ''} ${rateSuggestion && Math.abs(Number(formData.rate || 0) - Number(rateSuggestion.total || 0)) > Math.max(5, Math.round(Number(rateSuggestion.total || 0) * 0.05)) ? 'border-yellow-500' : ''}`}
                  required
                />
                {fieldErrors.rate && <p className="text-xs text-red-600 mb-2">{fieldErrors.rate}</p>}
                {rateSuggestion && (
                  <div className="text-xs text-gray-700 mb-2">
                    <div>Suggested: <span className="font-semibold">{formatCurrency(rateSuggestion.total)}</span></div>
                    <div>Base: {formatCurrency(rateSuggestion.base)} • Region: {Math.round(rateSuggestion.regionAdjPct * 100)}% • Season: {Math.round(rateSuggestion.seasonAdjPct * 100)}%</div>
                    {Math.abs(Number(formData.rate || 0) - Number(rateSuggestion.total || 0)) > Math.max(5, Math.round(Number(rateSuggestion.total || 0) * 0.05)) && (
                      <div className="text-yellow-700">Entered rate deviates from standard pricing</div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 mb-2">
                  <div>
                    <label htmlFor="packageCode" className="block text-sm font-medium text-gray-700 mb-1">Meal Plan</label>
                    <select
                      id="packageCode"
                      name="packageCode"
                      title="Meal Plan"
                      value={formData.packageCode}
                      onChange={handleInputChange}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      {packageOptions.map(opt => (
                        <option key={opt.code} value={opt.code}>{opt.label} (+${opt.surcharge})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        name="taxInclusive"
                        checked={formData.taxInclusive}
                        onChange={handleInputChange}
                        className="mr-2 h-4 w-4"
                      />
                      <span className="text-sm font-medium text-gray-700">Tax Inclusive</span>
                    </label>
                  </div>
                </div>

                {/* Rate summary */}
                {nights > 0 && (
                  <div className="p-3 mt-2 bg-gray-50 border rounded-lg text-sm">
                    {(() => {
                      const totalRate = (typeof computeTotalRate === 'function' ? computeTotalRate : (b: any) => Number(b) || 0)(formData.rate, formData.packageCode, packageOptions, 'RO');
                      const totalStay = totalRate * nights;
                      const taxRate = 0.1; // 10% assumption or from settings

                      let displaySubtotal = 0;
                      let displayTax = 0;
                      let displayTotal = 0;

                      if (formData.taxInclusive) {
                        displaySubtotal = totalStay / (1 + taxRate);
                        displayTax = totalStay - displaySubtotal;
                        displayTotal = totalStay;
                      } else {
                        displaySubtotal = totalStay;
                        displayTax = totalStay * taxRate;
                        displayTotal = totalStay + displayTax;
                      }

                      return (
                        <>
                          <p className="text-gray-700">Nights: <span className="font-medium">{nights}</span></p>
                          <p className="text-gray-700">Base Nightly Rate: <span className="font-medium">{formatCurrency(formData.rate)}</span></p>
                          <p className="text-gray-700">Package: <span className="font-medium">{(typeof getResPackageLabel === 'function' ? getResPackageLabel : () => 'RO')({ packageCode: formData.packageCode }, packageOptions)}</span></p>
                          <p className="text-gray-700">Total Nightly Rate: <span className="font-medium">{formatCurrency(totalRate)}</span></p>
                          <div className="mt-1 border-t pt-1">
                            <p className="text-gray-700">Subtotal: <span className="font-medium">{formatCurrency(displaySubtotal)}</span></p>
                            <p className="text-gray-700">Tax ({Math.round(taxRate * 100)}%): <span className="font-medium">{formatCurrency(displayTax)}</span></p>
                            <p className="text-gray-800 text-base">Total: <span className="font-bold">{formatCurrency(displayTotal)}</span></p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-semibold text-gray-700 mb-2">Payment Options</h4>
                <div className="flex gap-2 mb-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="Credit Card"
                      checked={formData.paymentMethod === 'Credit Card'}
                      onChange={handleInputChange}
                      className="mr-2"
                    />
                    Credit Card
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="Cash"
                      checked={formData.paymentMethod === 'Cash'}
                      onChange={handleInputChange}
                      className="mr-2"
                    />
                    Cash
                  </label>
                </div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    name="settleAtCheckout"
                    checked={formData.settleAtCheckout}
                    onChange={handleInputChange}
                    className="mr-2"
                  />
                  Settle Bill At Checkout
                </label>
                <textarea
                  name="paymentInstructions"
                  value={formData.paymentInstructions}
                  onChange={handleInputChange}
                  placeholder="Payment instructions (e.g., deposit required, billing notes)"
                  className="w-full px-4 py-2 border rounded-lg mt-2"
                  rows={3}
                />
                {/* Payment verification section */}
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg mt-3">
                  <h4 className="font-semibold text-yellow-800 mb-2">Payment Details Verification</h4>
                  <p className="text-sm text-gray-700 mb-2">
                    Payment method: <span className="font-medium">{formData.paymentMethod}</span>
                  </p>
                  <select
                    name="paymentInfoSource"
                    value={formData.paymentInfoSource}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 border rounded-lg mb-2"
                  >
                    <option value="">Select source of payment information...</option>
                    <option value="Guest provided at booking">Guest provided at booking</option>
                    <option value="Corporate account on file">Corporate account on file</option>
                    <option value="Third-party OTA (e.g., Booking.com)">Third-party OTA (e.g., Booking.com)</option>
                    <option value="Stored card on file">Stored card on file</option>
                    <option value="Other">Other</option>
                  </select>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="paymentVerified"
                      checked={formData.paymentVerified}
                      onChange={handleInputChange}
                      className="mr-2"
                    />
                    I confirm the payment details source and authorization are correct.
                  </label>
                  <p className="text-xs text-gray-500 mt-1">Submission requires confirmation.</p>
                </div>
                {/* Guest Confirmation section removed per request */}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="submit"
                disabled={!isFormValid()}
                className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                {editingReservationId ? 'Update Reservation' : 'Create Reservation'}
              </button>
              <button
                type="button"
                onClick={handlePrintCurrentForm}
                className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
              >
                Print
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewForm(false);
                  setEditingReservationId(null);
                }}
                className="bg-gray-300 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <Dialog open={bookingSourceDialogOpen} onOpenChange={setBookingSourceDialogOpen}>
        <DialogContent className="min-w-[320px] max-w-[90vw]">
          <DialogHeader>
            <DialogTitle>Additional details for {String(bookingSourceDialogType).toUpperCase()}</DialogTitle>
            <DialogDescription>Provide required information to continue.</DialogDescription>
          </DialogHeader>
          {(() => {
            const defs = bookingSourceFieldDefs[bookingSourceDialogType] || [];
            return (
              <form aria-live="polite" onSubmit={(e) => { e.preventDefault(); applyBookingSourceDialog(); }}>
                <div className="grid gap-3">
                  {defs.map((def, idx) => {
                    const errId = `err-${def.id}`;
                    const val = bookingSourceDialogValues[def.id] || '';
                    const error = bookingSourceDialogErrors[def.id];
                    if (def.type === 'combobox') {
                      return (
                        <div key={def.id}>
                          <Label htmlFor={def.id}>{def.label}{def.required ? ' *' : ''}</Label>
                          <Select value={val} onValueChange={(v) => setBookingSourceDialogValues(prev => ({ ...prev, [def.id]: v }))}>
                            <SelectTrigger
                              id={def.id}
                              aria-label={def.label}
                              role="combobox"
                              aria-haspopup="listbox"
                              aria-autocomplete="list"
                              aria-invalid={!!error}
                              aria-describedby={error ? errId : undefined}
                              className="min-h-[48px]"
                            >
                              <SelectValue placeholder={`Select ${def.label.toLowerCase()}…`} />
                            </SelectTrigger>
                            <SelectContent>
                              {def.options?.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {error && <p id={errId} role="alert" className="text-destructive text-sm mt-1">{error}</p>}
                        </div>
                      );
                    }
                    return (
                      <div key={def.id}>
                        <Label htmlFor={def.id}>{def.label}{def.required ? ' *' : ''}</Label>
                        <Input
                          id={def.id}
                          type={def.type}
                          value={val}
                          onChange={(e) => setBookingSourceDialogValues(prev => ({ ...prev, [def.id]: e.target.value }))}
                          aria-invalid={!!error}
                          aria-describedby={error ? errId : undefined}
                          className="min-h-[48px]"
                          autoFocus={idx === 0}
                        />
                        {error && <p id={errId} role="alert" className="text-destructive text-sm mt-1">{error}</p>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => { setBookingSourceDialogOpen(false); }}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="default">
                    Confirm
                  </Button>
                </div>
                <div aria-live="assertive" className="sr-only">
                  {Object.values(bookingSourceDialogErrors).filter(Boolean).join('. ')}
                </div>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>

      <GuestLookupModal
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        onSelect={({ guest, reservation }) => {
          setFormData(prev => ({
            ...prev,
            guestName: reservation?.guestName || guest?.name || prev.guestName,
            email: (guest?.email || (reservation as any)?.email || prev.email) || '',
            phone: (guest?.phone || (reservation as any)?.phone || prev.phone) || '',
            nationalityName: (reservation as any)?.nationalityName || prev.nationalityName,
            nationalityCode: prev.nationalityCode,
            checkIn: reservation?.checkIn || prev.checkIn,
            checkOut: reservation?.checkOut || prev.checkOut,
          }))
        }}
      />

      {viewMode === 'grid' ? (
        <div className="bg-white rounded-xl shadow-lg p-4 h-[calc(100vh-300px)] flex flex-col">
          <RoomGrid
            onCellClick={(roomId, date) => {
              setFormData(prev => ({
                ...prev,
                roomId,
                checkIn: format(date, 'yyyy-MM-dd'),
                checkOut: format(addDays(date, 1), 'yyyy-MM-dd')
              }));
              setShowNewForm(true);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Guest Name</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Room No.</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Room Type</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Check-In</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Check-Out</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Booking Type</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Payment</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayReservations.map(res => (
                <tr key={res.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-800">{String(res.guestName || '')}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-800">
                    {(res as any).room_number || (res as any).roomNumber
                      ? <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs font-bold">{String((res as any).room_number || (res as any).roomNumber)}</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{String(res.roomType || '')}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{String(res.checkIn || '')}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{String(res.checkOut || '')}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {String(res.bookingType || 'Individual')}
                    {((res as any).companyName) && <span className="block text-xs text-gray-500">{String((res as any).companyName || '')}</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${String(res.status || '') === 'confirmed' ? 'bg-green-100 text-green-800' :
                      String(res.status || '') === 'checked-in' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                      {(() => { const st = String(res.status || ''); return st ? st.charAt(0).toUpperCase() + st.slice(1) : ''; })()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <div>{String(res.paymentMethod || 'Credit Card')}</div>
                    <div className="text-xs mt-1">
                      <span className={`inline-block px-2 py-1 rounded font-semibold ${(res as any).paymentVerified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {res.paymentVerified ? 'Verified' : 'Not Verified'}
                      </span>
                      {((res as any).paymentInfoSource) && (
                        <span className="ml-2 text-gray-500">{String((res as any).paymentInfoSource || '')}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {res.status !== 'checked-in' && (
                      <button
                        onClick={() => {
                          setEditingReservationId(res.id);
                          setFormData({
                            roomId: '', // Will be set when room is selected
                            guestName: res.guestName,
                            email: res.email || '',
                            phone: res.phone || '',
                            idDocumentNumber: (res as any).idDocumentNumberEncrypted ? decryptSensitive((res as any).idDocumentNumberEncrypted) : '',
                            idDocumentType: res.idDocumentType || 'Passport',
                            nationalityCode: res.nationalityCode || '',
                            nationalityName: res.nationalityName || '',
                            checkIn: (() => { const d = new Date(res.checkIn); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); })(),
                            checkOut: (() => { const d = new Date(res.checkOut); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); })(),
                            originRegion: (res as any).originRegion || '',
                            roomType: res.roomType,
                            roomPreference: res.roomPreference || 'Non-smoking',
                            bookingName: res.bookingName || '',
                            bookingType: res.bookingType || 'Individual',
                            companyName: res.companyName || '',
                            bookingSource: res.bookingSource || '',
                            partnerCode: res.partnerCode || '',
                            utmSource: res.utmSource || '',
                            utmMedium: res.utmMedium || '',
                            utmCampaign: res.utmCampaign || '',
                            utmTerm: res.utmTerm || '',
                            utmContent: res.utmContent || '',
                            paymentMethod: res.paymentMethod || 'Credit Card',
                            settleAtCheckout: res.settleAtCheckout !== false,
                            rate: res.rate,
                            adults: res.adults,
                            children: res.children || 0,
                            paymentInfoSource: res.paymentInfoSource || '',
                            paymentVerified: !!res.paymentVerified,
                            paymentInstructions: '',
                            termsAccepted: !!res.termsAccepted,
                            signatureDataUrl: '',
                            packageCode: (res as any).packageCode || 'RO',
                            taxInclusive: !!(res as any).taxInclusive
                          });
                          setShowNewForm(true);
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const html = await buildReservationPrintHTML({
                          guestName: res.guestName,
                          bookingName: (res as any).bookingName || res.guestName,
                          nationalityName: (res as any).nationalityName,
                          nationalityCode: (res as any).nationalityCode,
                          idDocumentType: (res as any).idDocumentType || 'Passport',
                          checkIn: res.checkIn,
                          checkOut: res.checkOut,
                          adults: res.adults,
                          children: res.children || 0,
                          roomType: res.roomType,
                          roomPreference: (res as any).roomPreference || 'Non-smoking',
                          bookingSource: (res as any).bookingSource || '',
                          partnerCode: (res as any).partnerCode || '',
                          rate: res.rate,
                          paymentInstructions: (res as any).paymentInstructions || ''
                        });
                        const doc = applySettingsToHTML('Reservation Details', html);
                        const w = window.open('', '_blank');
                        if (!w) return;
                        w.document.write(doc);
                        w.document.close();
                        try { w.focus(); } catch { }
                        try { w.print(); } catch { }
                      }}
                      className="ml-3 text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RoomGridModal
        isOpen={roomGridOpen}
        onClose={() => setRoomGridOpen(false)}
        onSelectRoom={(roomId) => {
          setFormData(prev => ({ ...prev, roomId }));
          setRoomGridOpen(false);
        }}
        startDate={formData.checkIn ? new Date(formData.checkIn) : new Date()}
      />
    </div>
  );
};
