import React, { useState, useMemo } from 'react';
import { useData } from '../../context/DataContext';
import { errorTracker } from '@/lib/errorTracker';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { format, differenceInCalendarDays, addDays, startOfToday } from 'date-fns';
import { Calendar, CreditCard, Search, UserCheck, UserX, Printer, Utensils, AlertTriangle, FileText, FileSearch, Settings, LayoutGrid, ArrowRightLeft } from 'lucide-react';
import { toast } from 'sonner';
import { getHotelName } from '@/lib/brand';
import { formatShortId } from '@/lib/formatId';
import { useAuth } from '@/context/AuthContext';
import { ChargesAudit } from './ChargesAudit';
import { GuestRegistry } from './GuestRegistry';
import { getResPackageLabel, computeTotalRate, sanitizePackageCode } from '@/lib/packageUtils';
import { logger } from '@/lib/logger';
import FOPrintCustomization from '@/components/modules/FOPrintCustomization';
import { generateBlankCheckInFormHTML } from '@/lib/reporting';
import FolioManagement from './folio/FolioManagement';
import { TransferRoomModal } from './folio/TransferRoomModal';
import { ReportLayout, ReportTable } from '../ui/ReportLayout';
import { QuickCheckInModal } from './QuickCheckInModal';
const packageOptions = [
  { code: 'RO', label: 'Room Only', surcharge: 0 },
  { code: 'BB', label: 'Bed & Breakfast', surcharge: 15 },
  { code: 'DBB', label: 'Dinner, Bed & Breakfast', surcharge: 45 },
];

export const FrontOffice: React.FC = () => {
  const ctx = useData() as any;
  const { user } = useAuth();
  // Charges is a Daily Audit Review tool — restricted to Night Auditor / Manager /
  // Admin (+ supervisor/auditor). Hidden from standard front-desk agents.
  const canSeeCharges = ['admin', 'manager', 'supervisor', 'auditor', 'nightauditor', 'night_auditor', 'night auditor']
    .includes(String(user?.role || '').toLowerCase().replace(/[^a-z_ ]/g, ''));

  // In-House multi-field search + pagination (dataset is the current in-house
  // guests — bounded — so client-side filtering stays responsive).
  const [inHouseSearch, setInHouseSearch] = useState('');
  const [inHouseSearchDebounced, setInHouseSearchDebounced] = useState('');
  const [inHousePage, setInHousePage] = useState(1);
  const inHousePageSize = 25;
  React.useEffect(() => { const t = setTimeout(() => { setInHouseSearchDebounced(inHouseSearch); setInHousePage(1); }, 300); return () => clearTimeout(t); }, [inHouseSearch]);

  // Clean print window: property name, report title, timestamp, full-width table.
  const printFOReport = (title: string, headers: string[], rowVals: (string | number)[][]) => {
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const body = rowVals.map(r => `<tr>${r.map((v, i) => `<td class="${i >= headers.length - 1 ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('');
    const html = `<!doctype html><html><head><title>${esc(title)}</title><style>
      body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}h1{font-size:19px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin-bottom:12px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}th{background:#f5f5f7;text-transform:uppercase;font-size:10px;color:#444}.r{text-align:right}
    </style></head><body>
      <h1>${esc(getHotelName())} — ${esc(title)}</h1>
      <div class="sub">${rowVals.length} record(s) · Generated ${new Date().toLocaleString()}</div>
      <table><thead><tr>${headers.map((h, i) => `<th class="${i >= headers.length - 1 ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); }
  };
  const rooms: any[] = Array.isArray(ctx?.rooms) ? ctx.rooms : [];
  const reservations: any[] = Array.isArray(ctx?.reservations) ? ctx.reservations : [];
  const guests: any[] = Array.isArray(ctx?.guests) ? ctx.guests : [];
  const folioCharges: any[] = Array.isArray(ctx?.folioCharges) ? ctx.folioCharges : [];
  const checkInGuest: any = typeof ctx?.checkInGuest === 'function' ? ctx.checkInGuest : () => { };
  const checkOutGuest: any = typeof ctx?.checkOutGuest === 'function' ? ctx.checkOutGuest : () => { };
  const updateRoomStatus: any = typeof ctx?.updateRoomStatus === 'function' ? ctx.updateRoomStatus : () => { };
  const addFolioCharge: any = typeof ctx?.addFolioCharge === 'function' ? ctx.addFolioCharge : () => { };
  const dataError: string | null = typeof ctx?.dataError === 'string' ? ctx.dataError : null;
  React.useEffect(() => {
    try {
      if (!Array.isArray(ctx?.rooms) || !Array.isArray(ctx?.reservations) || !Array.isArray(ctx?.guests) || !Array.isArray(ctx?.folioCharges)) {
        errorTracker.log('FrontOffice: missing or invalid data arrays', 'warning', {
          rooms: typeof ctx?.rooms,
          reservations: typeof ctx?.reservations,
          guests: typeof ctx?.guests,
          folioCharges: typeof ctx?.folioCharges
        });
      }
    } catch { }
  }, [ctx]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedResId, setSelectedResId] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [checkInDialogOpen, setCheckInDialogOpen] = useState(false);
  const [quickCheckInOpen, setQuickCheckInOpen] = useState(false);
  const [showPrintSettings, setShowPrintSettings] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // Manual Charge State
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeGuestId, setChargeGuestId] = useState<string | null>(null);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [roomStatusDialogOpen, setRoomStatusDialogOpen] = useState(false);

  // Room Availability Grid state
  const [roomAvailGridOpen, setRoomAvailGridOpen] = useState(false);
  const [gridStartDate, setGridStartDate] = useState<Date>(() => startOfToday());
  const [gridDays, setGridDays] = useState<7 | 14 | 30>(7);

  // Transfer Room State
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferResId, setTransferResId] = useState<string | null>(null);
  const [transferRoomId, setTransferRoomId] = useState<string | null>(null);

  // Assign Room State (for in-house guests with no room)
  const [assignRoomDialogOpen, setAssignRoomDialogOpen] = useState(false);
  const [assignRoomSelected, setAssignRoomSelected] = useState<string | null>(null);
  
  // Extend Stay State
  const [extendStayResId, setExtendStayResId] = useState<string | null>(null);
  const [extendStayDate, setExtendStayDate] = useState<string>('');
  const [extendStayDialogOpen, setExtendStayDialogOpen] = useState(false);

  // Check-in state
  const [rateOverride, setRateOverride] = useState<string>('');
  const [selectedPackage, setSelectedPackage] = useState<string>('RO');
  const [taxInclusive, setTaxInclusive] = useState<boolean>(false);
  const [taxEnabled, setTaxEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('corepms_frontoffice_tax_settings');
      if (raw) return !!JSON.parse(raw).enabled;
    } catch { }
    return true;
  });
  const [taxRatePercent, setTaxRatePercent] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('corepms_frontoffice_tax_settings');
      if (raw) {
        const obj = JSON.parse(raw);
        return typeof obj.ratePercent === 'number' ? String(obj.ratePercent) : String(obj.ratePercent || '10');
      }
    } catch { }
    return '10';
  });
  const [taxMethod, setTaxMethod] = useState<'inclusive' | 'exclusive'>(() => {
    try {
      const raw = localStorage.getItem('corepms_frontoffice_tax_settings');
      if (raw) return JSON.parse(raw).method === 'exclusive' ? 'exclusive' : 'inclusive';
    } catch { }
    return 'inclusive';
  });
  const [taxError, setTaxError] = useState<string | null>(null);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editGuestName, setEditGuestName] = useState('');
  const [editGuestEmail, setEditGuestEmail] = useState('');
  const [editGuestPhone, setEditGuestPhone] = useState('');
  const [showEditGuestDialog, setShowEditGuestDialog] = useState(false);

  const generateAndPrintReport = () => {
    const html = '<html><body><h1>POS Report</h1><p>Report generated.</p></body></html>';
    printHTMLContent(html);
  };

  const generateAndExportReport = () => {
    const data = 'Date,Type,Amount\n2024-01-01,Sales,100\n';
    const blob = new Blob([data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pos_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Guard against missing bridge/data
  React.useEffect(() => {
    if (!reservations && !guests) {
      setDbError("Connecting to local database...");
    } else {
      setDbError(null);
    }
  }, [reservations, guests]);

  // IDs of rooms that already have a checked-in reservation (guard against double check-in)
  const occupiedRoomIds = useMemo(() => {
    const ids = new Set<string>();
    reservations.forEach((r: any) => {
      if ((r.status === 'checked-in' || r.status === 'occupied') && (r.room_id || r.roomId)) {
        ids.add(r.room_id || r.roomId);
      }
    });
    return ids;
  }, [reservations]);

  // Available rooms: VC (Vacant Clean) + VD (Vacant Dirty) — both are unoccupied.
  // VD rooms still need housekeeping but can be assigned; they show a warning badge.
  // OOO/OOS rooms are excluded. Rooms already checked-in are excluded.
  const availableRooms = useMemo(() => {
    if (!rooms) return [];
    return rooms.filter((r: any) => {
      const s = String(r.status || '').toUpperCase();
      const isVacant = s === 'VC' || s === 'VD' || s === 'VACANT' || s === 'AVAILABLE';
      const isBlocked = s === 'OOO' || s === 'OOS';
      const isOccupied = occupiedRoomIds.has(r.id);
      return isVacant && !isBlocked && !isOccupied;
    });
  }, [rooms, occupiedRoomIds]);

  const isLoadingRooms = !rooms || (rooms.length === 0 && !dbError);
  const roomsError = (!rooms || rooms.length === 0) && dbError ? dbError : null;

  // Helper to safely get reservation status
  const getResStatus = (res: any) => res.status || 'confirmed';

  // Helper to safely get reservation package
  const getResPackage = (res: any) => getResPackageLabel(res, packageOptions, 'RO');

  const [guestLookupOpen, setGuestLookupOpen] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [arrivalsPreviewOpen, setArrivalsPreviewOpen] = useState(false);
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'restaurant' | 'arrivals' | 'departures' | 'inhouse' | 'blank-form' | 'both'>('restaurant');
  const [exportFormat, setExportFormat] = useState<'pdf' | 'html' | 'txt'>('pdf');
  const [printDestination, setPrintDestination] = useState<'printer' | 'download' | 'email'>('printer');

  // Report Generation Functions (defined early for use in handlePrintWithOptions)
  const generateRestaurantReport = (): string => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const checkedInGuests = reservations.filter(r => getResStatus(r) === 'checked-in');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Restaurant Guest List - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Restaurant Guest List</h1>
        <p>Date: ${today}</p>
        <p>Prepared for: Kitchen/Restaurant Operations</p>
        
        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Guest Name</th>
              <th>Pax</th>
              <th>Package</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${checkedInGuests.map(r => {
      const roomNum = guests.find(g => g.name === r.guestName)?.roomNumber || r.roomType;
      return `
                <tr>
                  <td>${roomNum}</td>
                  <td>${r.guestName}</td>
                  <td>${r.adults + (r.children || 0)}</td>
                  <td>${getResPackage(r)}</td>
                  <td>In House</td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
        
        <div class="summary">
          <h3>Summary</h3>
          <p>Total In-House Guests: ${checkedInGuests.length}</p>
          <p>Breakfast Meals (BB/DBB): ${checkedInGuests.filter(r => ['BB', 'DBB'].includes(r.packageCode || 'RO')).reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
          <p>Dinner Meals (DBB): ${checkedInGuests.filter(r => (r.packageCode || 'RO') === 'DBB').reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
        </div>
      </body>
      </html>
    `;
  };

  const generateArrivalsReport = (): string => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const arrivingGuests = reservations.filter(r => {
      const status = getResStatus(r);
      return status === 'confirmed' && r.checkIn === today;
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Today's Arrivals - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Today's Arrivals</h1>
        <p>Date: ${today}</p>
        <p>Prepared for: Front Office Operations</p>
        
        <table>
          <thead>
            <tr>
              <th>Guest Name</th>
              <th>Contact</th>
              <th>Room Type</th>
              <th>Room #</th>
              <th>Pax</th>
              <th>Package</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            ${arrivingGuests.map(r => {
      const roomAssignment = getRoomAssignment(r);
      return `
                <tr>
                  <td>${r.guestName}</td>
                  <td>${r.email || r.phone || '-'}</td>
                  <td>${r.roomType}</td>
                  <td>${roomAssignment}</td>
                  <td>${r.adults + (r.children || 0)}</td>
                  <td>${getResPackage(r)}</td>
                  <td>$${r.rate || 0}</td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
        
        <div class="summary">
          <h3>Summary</h3>
          <p>Total Arrivals: ${arrivingGuests.length}</p>
          <p>Expected Revenue: $${arrivingGuests.reduce((sum, r) => sum + (Number(r.rate) || 0), 0).toFixed(2)}</p>
        </div>
      </body>
      </html>
    `;
  };

  const generateCombinedReport = (): string => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const checkedInGuests = reservations.filter(r => getResStatus(r) === 'checked-in');
    const arrivingGuests = reservations.filter(r => {
      const status = getResStatus(r);
      return status === 'confirmed' && r.checkIn === today;
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Daily Operations Report - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1, h2 { color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
          h1 { text-align: center; }
          h2 { margin-top: 30px; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .section { margin-bottom: 30px; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Daily Operations Report</h1>
        <p>Date: ${today}</p>
        <p>Prepared for: Daily Operations Management</p>
        
        <div class="section">
          <h2>Restaurant/Kitchen Guest List</h2>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Guest Name</th>
                <th>Pax</th>
                <th>Package</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${checkedInGuests.map(r => {
      const roomNum = guests.find(g => g.name === r.guestName)?.roomNumber || r.roomType;
      return `
                  <tr>
                    <td>${roomNum}</td>
                    <td>${r.guestName}</td>
                    <td>${r.adults + (r.children || 0)}</td>
                    <td>${getResPackage(r)}</td>
                    <td>In House</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
          <div class="summary">
            <p>Total In-House Guests: ${checkedInGuests.length}</p>
            <p>Breakfast Meals: ${checkedInGuests.filter(r => ['BB', 'DBB'].includes(r.packageCode || 'RO')).reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
            <p>Dinner Meals: ${checkedInGuests.filter(r => (r.packageCode || 'RO') === 'DBB').reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
          </div>
        </div>
        
        <div class="section">
          <h2>Today's Arrivals</h2>
          <table>
            <thead>
              <tr>
                <th>Guest Name</th>
                <th>Contact</th>
                <th>Room Type</th>
                <th>Room #</th>
                <th>Pax</th>
                <th>Package</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              ${arrivingGuests.map(r => {
      const roomAssignment = getRoomAssignment(r);
      return `
                  <tr>
                    <td>${r.guestName}</td>
                    <td>${r.email || r.phone || '-'}</td>
                    <td>${r.roomType}</td>
                    <td>${roomAssignment}</td>
                    <td>${r.adults + (r.children || 0)}</td>
                    <td>${getResPackage(r)}</td>
                    <td>$${r.rate || 0}</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
          <div class="summary">
            <p>Total Arrivals: ${arrivingGuests.length}</p>
            <p>Expected Revenue: $${arrivingGuests.reduce((sum, r) => sum + (Number(r.rate) || 0), 0).toFixed(2)}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const generateDeparturesReport = (): string => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const departingGuests = reservations.filter(r => {
      const status = getResStatus(r);
      return (status === 'checked-in' || status === 'checked-out') && r.checkOut === today;
    });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Today's Departures - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Today's Departures</h1>
        <p>Date: ${today}</p>
        <p>Prepared for: Front Office Operations</p>
        
        <table>
          <thead>
            <tr>
              <th>Guest Name</th>
              <th>Room #</th>
              <th>Status</th>
              <th>Pax</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            ${departingGuests.map(r => {
              const roomAssignment = getRoomAssignment(r);
              return `
                <tr>
                  <td>${r.guestName}</td>
                  <td>${roomAssignment}</td>
                  <td>${getResStatus(r) === 'checked-out' ? 'Checked Out' : 'Due Out'}</td>
                  <td>${r.adults + (r.children || 0)}</td>
                  <td>$${r.rate || 0}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        
        <div class="summary">
          <h3>Summary</h3>
          <p>Total Departures: ${departingGuests.length}</p>
        </div>
      </body>
      </html>
    `;
  };

  const generateInHouseReport = (): string => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const checkedInGuests = reservations.filter(r => getResStatus(r) === 'checked-in');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>In-House Guest List - ${today}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; color: #333; border-bottom: 2px solid #333; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .summary { margin-top: 20px; font-weight: bold; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>In-House Guest List</h1>
        <p>Date: ${today}</p>
        
        <table>
          <thead>
            <tr>
              <th>Guest Name</th>
              <th>Room #</th>
              <th>Check-In</th>
              <th>Check-Out</th>
              <th>Pax</th>
              <th>Package</th>
            </tr>
          </thead>
          <tbody>
            ${checkedInGuests.map(r => {
              const roomAssignment = getRoomAssignment(r);
              return `
                <tr>
                  <td>${r.guestName}</td>
                  <td>${roomAssignment}</td>
                   <td>${r.checkIn  ? String(r.checkIn).split('T')[0]  : 'N/A'}</td>
                   <td>${r.checkOut ? String(r.checkOut).split('T')[0] : 'N/A'}</td>
                  <td>${r.adults + (r.children || 0)}</td>
                  <td>${getResPackage(r)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        
        <div class="summary">
          <h3>Summary</h3>
          <p>Total In-House Guests: ${checkedInGuests.length}</p>
        </div>
      </body>
      </html>
    `;
  };

  // Export Handler Functions
  const handlePDFExport = async (htmlContent: string, fileName: string) => {
    try {
      // For now, we'll save as HTML with .pdf extension suggestion
      // In a real implementation, you'd use a library like jsPDF or puppeteer
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.html`; // Will suggest PDF but save as HTML
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error('Failed to export PDF');
    }
  };

  const handleHTMLExport = async (htmlContent: string, fileName: string) => {
    try {
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error('Failed to export HTML');
    }
  };

  const handleTextExport = async (htmlContent: string, fileName: string) => {
    try {
      // Convert HTML to plain text (basic conversion)
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      const textContent = tempDiv.textContent || tempDiv.innerText || '';

      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error('Failed to export text');
    }
  };

  const printHTMLContent = (htmlContent: string) => {
    try {
      const win = window.open('', '_blank', 'width=900,height=700');
      if (win) {
        win.document.write(htmlContent);
        win.document.close();
        // Trigger print after a small delay to ensure content loads
        setTimeout(() => {
          win.print();
        }, 500);
      } else {
        toast.error('Pop-up blocked. Please allow pop-ups for this site.');
      }
    } catch (error) {
      throw new Error('Failed to open print window');
    }
  };

  // Enhanced print function with options
  const handlePrintWithOptions = async () => {
    setPrintOptionsOpen(false);

    try {
      let htmlContent = '';
      let fileName = '';

      // Generate appropriate content based on print mode
      if (printMode === 'restaurant') {
        htmlContent = generateRestaurantReport();
        fileName = `restaurant-guest-list-${format(new Date(), 'yyyy-MM-dd')}`;
      } else if (printMode === 'arrivals') {
        htmlContent = generateArrivalsReport();
        fileName = `todays-arrivals-${format(new Date(), 'yyyy-MM-dd')}`;
      } else if (printMode === 'departures') {
        htmlContent = generateDeparturesReport();
        fileName = `todays-departures-${format(new Date(), 'yyyy-MM-dd')}`;
      } else if (printMode === 'inhouse') {
        htmlContent = generateInHouseReport();
        fileName = `in-house-guests-${format(new Date(), 'yyyy-MM-dd')}`;
      } else if (printMode === 'blank-form') {
        htmlContent = generateBlankCheckInFormHTML();
        fileName = `blank-checkin-form-${format(new Date(), 'yyyy-MM-dd')}`;
      } else {
        htmlContent = generateCombinedReport();
        fileName = `daily-operations-${format(new Date(), 'yyyy-MM-dd')}`;
      }

      // Handle different export formats
      if (exportFormat === 'pdf') {
        await handlePDFExport(htmlContent, fileName);
      } else if (exportFormat === 'html') {
        await handleHTMLExport(htmlContent, fileName);
      } else {
        await handleTextExport(htmlContent, fileName);
      }

      // Handle different destinations
      if (printDestination === 'printer') {
        printHTMLContent(htmlContent);
      } else if (printDestination === 'download') {
        // Already handled in format-specific functions
        toast.success('Report downloaded successfully');
      } else {
        // Email functionality (placeholder)
        toast.success('Email functionality will be available in the next update');
      }
    } catch (error) {
      console.error('Print/export error:', error);
      toast.error('Failed to generate report');
    }
  };
  // Combined report for both restaurant and arrivals (legacy function for backward compatibility)
  const printCombinedReport = () => {
    const today = format(new Date(), 'yyyy-MM-dd');

    // Get restaurant guests (checked-in)
    const checkedInGuests = reservations.filter(r => getResStatus(r) === 'checked-in');

    // Get arrivals
    const arrivingGuests = reservations.filter(r => {
      const status = getResStatus(r);
      return status === 'confirmed' && r.checkIn === today;
    });

    let html = `
      <html>
        <head>
          <title>Daily Operations Report - ${today}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
            h2 { margin-top: 30px; border-bottom: 1px solid #ccc; padding-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .section { margin-bottom: 30px; }
            .summary { margin-top: 20px; font-weight: bold; }
            @media print {
              .no-print { display: none; }
              body { padding: 10px; }
            }
          </style>
        </head>
        <body>
          <h1>Daily Operations Report</h1>
          <p>Date: ${today}</p>
          
          <div class="section">
            <h2>Restaurant/Kitchen Guest List</h2>
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Guest Name</th>
                  <th>Pax</th>
                  <th>Package</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${checkedInGuests.map(r => {
      const roomNum = guests.find(g => g.name === r.guestName)?.roomNumber || r.roomType;
      return `
                    <tr>
                      <td>${roomNum}</td>
                      <td>${r.guestName}</td>
                      <td>${r.adults + (r.children || 0)}</td>
                      <td>${getResPackage(r)}</td>
                      <td>In House</td>
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
            <div class="summary">
              <p>Total In-House Guests: ${checkedInGuests.length}</p>
              <p>Breakfast Meals: ${checkedInGuests.filter(r => ['BB', 'DBB'].includes(r.packageCode || 'RO')).reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
              <p>Dinner Meals: ${checkedInGuests.filter(r => (r.packageCode || 'RO') === 'DBB').reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
            </div>
          </div>
          
          <div class="section">
            <h2>Today's Arrivals</h2>
            <table>
              <thead>
                <tr>
                  <th>Guest Name</th>
                  <th>Room Type</th>
                  <th>Room #</th>
                  <th>Pax</th>
                  <th>Package</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                ${arrivingGuests.map(r => {
      const roomAssignment = getRoomAssignment(r);
      return `
                    <tr>
                      <td>${r.guestName}</td>
                      <td>${r.roomType}</td>
                      <td>${roomAssignment}</td>
                      <td>${r.adults + (r.children || 0)}</td>
                      <td>${getResPackage(r)}</td>
                      <td>$${r.rate || 0}</td>
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
            <div class="summary">
              <p>Total Arrivals: ${arrivingGuests.length}</p>
              <p>Expected Revenue: $${arrivingGuests.reduce((sum, r) => sum + (Number(r.rate) || 0), 0).toFixed(2)}</p>
            </div>
          </div>
          
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    try {
      const win = window.open('', '_blank', 'width=900,height=700');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        toast.error('Pop-up blocked. Please allow pop-ups for this site.');
      }
    } catch (err) {
      toast.error('Failed to open print preview');
      console.error('printCombinedReport failed', err);
    }
  };

  // Logic to print the guest list for the restaurant/kitchen
  const printDailyPackageList = () => {
    // Use local date instead of UTC to fix timezone issues
    const today = format(new Date(), 'yyyy-MM-dd');
    // Filter for guests who are currently checked in (status='checked-in')
    // OR reservations arriving today (status='confirmed' && checkIn === today)
    const activeReservations = reservations.filter(r => {
      const status = getResStatus(r);
      const isCheckedIn = status === 'checked-in';
      const isArriving = status === 'confirmed' && r.checkIn === today;
      return isCheckedIn || isArriving;
    });

    let html = `
      <html>
        <head>
          <title>Daily Package Report - ${today}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .summary { margin-top: 30px; font-weight: bold; }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>Daily Meal Plan Report</h1>
          <p>Date: ${today}</p>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Guest Name</th>
                <th>Pax</th>
                <th>Package</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${activeReservations.map(r => {
      const roomNum = guests.find(g => g.name === r.guestName)?.roomNumber || r.roomType;
      return `
                  <tr>
                    <td>${roomNum}</td>
                    <td>${r.guestName}</td>
                    <td>${r.adults + (r.children || 0)}</td>
                    <td>${getResPackage(r)}</td>
                    <td>${getResStatus(r) === 'checked-in' ? 'In House' : 'Arrival'}</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>
          <div class="summary">
            <h3>Summary</h3>
            <p>Total Breakfasts (BB/DBB): ${activeReservations.filter(r => ['BB', 'DBB'].includes(r.packageCode || 'RO')).reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
            <p>Total Dinners (DBB): ${activeReservations.filter(r => (r.packageCode || 'RO') === 'DBB').reduce((sum, r) => sum + r.adults + (r.children || 0), 0)}</p>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
                // Optional: close after print
                // window.onafterprint = function() { window.close(); }
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    try {
      const win = window.open('', '_blank', 'width=800,height=600');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        toast.error('Pop-up blocked. Please allow pop-ups for this site.');
      }
    } catch (err) {
      toast.error('Failed to open print preview');
      console.error('printDailyPackageList failed', err);
    }
  };

  // Open arrivals print preview dialog
  const printArrivals = () => {
    setArrivalsPreviewOpen(true);
  };

  // Get arrivals list for the report
  const todayArrivals = useMemo(() => {
    // Use local date to match "today" correctly
    const today = format(new Date(), 'yyyy-MM-dd');
    return reservations.filter(r => {
      const status = getResStatus(r).toLowerCase();

      // Normalize checkIn date for comparison (same logic as arrivals filter)
      let checkInDate = '';

      // Try multiple field names for check-in date
      const rawCheckIn = r.checkIn || r.check_in_date || r.check_in;

      if (rawCheckIn) {
        const dateString = String(rawCheckIn);
        if (dateString.includes('T')) {
          checkInDate = dateString.split('T')[0];
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
          checkInDate = dateString;
        } else if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
          const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
          checkInDate = match ? match[1] : '';
        } else {
          try {
            const dateObj = new Date(dateString);
            if (!isNaN(dateObj.getTime())) {
              checkInDate = format(dateObj, 'yyyy-MM-dd');
            }
          } catch {
            checkInDate = dateString;
          }
        }
      }

      return (status === 'confirmed' || status === 'pending') && checkInDate === today;
    });
  }, [reservations]);

  // Get room assignment for a reservation
  const getRoomAssignment = (reservation: any) => {
    // Check if reservation has a room_id assigned
    if (reservation.room_id) {
      const room = rooms.find(r => r.id === reservation.room_id);
      return room?.number || 'Assigned';
    }
    // Check in guests list
    const guest = guests.find(g => g.name === reservation.guestName);
    if (guest?.roomNumber) return guest.roomNumber;
    // Return room type as fallback
    return reservation.roomType || 'TBA';
  };

  const openGuestLookup = () => {
    setGuestLookupOpen(true);
    setLookupQuery('');
  };

  const handleCheckInClick = (resId: string) => {
    const res = reservations.find(r => r.id === resId);
    if (!res) return;

    setSelectedResId(resId);
    setRateOverride(res.rate?.toString() || '');
    setSelectedPackage(sanitizePackageCode(res.packageCode || res.package_code || 'RO', 'RO'));
    setTaxInclusive(!!res.taxInclusive);

    // Room selection priority:
    // 1. Use reservation's pre-assigned room (room_id) if it exists and is available
    // 2. Match by room type from available rooms
    // 3. Do NOT auto-fallback to availableRooms[0] — that causes wrong room check-ins
    const preAssignedRoomId = res.room_id || res.roomId;
    if (preAssignedRoomId) {
      // Pre-assigned room exists — use it (may be OC if re-checking-in)
      const preRoom = rooms.find((r: any) => r.id === preAssignedRoomId);
      if (preRoom) {
        setSelectedRoom(preAssignedRoomId);
        setCheckInDialogOpen(true);
        return;
      }
    }

    // No pre-assignment — match by room type, but do NOT auto-select if ambiguous
    const matchByType = availableRooms.filter((r: any) => r.type === (res.roomType || res.room_type));
    if (matchByType.length === 1) {
      // Only one match — safe to auto-select
      setSelectedRoom(matchByType[0].id);
    } else {
      // Multiple matches or no match — let the user explicitly choose
      setSelectedRoom(null);
    }

    setCheckInDialogOpen(true);
  };

  const handleManualChargeClick = (guestId: string) => {
    setChargeGuestId(guestId);
    setChargeAmount('');
    setChargeDescription('');
    setChargeError(null);
    setChargeDialogOpen(true);
  };

  const handleTransferClick = (resId: string, roomId: string) => {
    setTransferResId(resId);
    setTransferRoomId(roomId);
    setTransferDialogOpen(true);
  };

  const handleCheckOut = async (reservationId: string) => {
    if (typeof checkOutGuest !== 'function') {
      const msg = 'FrontOffice: check-out unavailable';
      errorTracker.log(msg, 'critical', { reservationId, hasCheckOut: typeof checkOutGuest === 'function' });
      toast.error('Failed to process check-out');
      logger.error(msg, { reservationId });
      return;
    }
    try {
      await checkOutGuest(reservationId);
      toast.success('Guest checked out successfully');
      logger.info('FrontOffice: guest checked out', { reservationId });
    } catch (err: any) {
      const message = err?.message || 'Unknown check-out error';
      errorTracker.log(err as any, 'error', { action: 'check_out', reservationId });
      logger.error('FrontOffice: check-out failed', { reservationId, error: message });
      toast.error(`Check-out failed: ${message}`);
    }
  };

  const handleChargeSubmit = () => {
    if (!chargeGuestId) return;

    const amount = parseFloat(chargeAmount);
    if (isNaN(amount) || amount <= 0) {
      setChargeError("Please enter a valid positive amount");
      return;
    }

    if (!chargeDescription.trim()) {
      setChargeError("Please enter a description or code");
      return;
    }

    try {
      addFolioCharge({
        guestId: chargeGuestId,
        amount: amount,
        code: chargeDescription,
        date: new Date().toISOString()
      });
      toast.success("Charge added successfully");
      setChargeDialogOpen(false);
      setChargeGuestId(null);
    } catch (err) {
      toast.error("Failed to add charge");
      console.error(err);
    }
  };

  React.useEffect(() => {
    const pct = Math.max(0, Math.min(100, parseFloat(taxRatePercent || '0')));
    const valid = !isNaN(pct) && pct >= 0 && pct <= 100;
    setTaxError(valid ? null : 'Enter a number between 0 and 100');
    try {
      localStorage.setItem('corepms_frontoffice_tax_settings', JSON.stringify({
        enabled: taxEnabled,
        ratePercent: valid ? pct : 0,
        method: taxMethod
      }));
    } catch { }
  }, [taxEnabled, taxRatePercent, taxMethod]);

  const handleCheckInConfirm = () => {
    if (selectedResId && selectedRoom) {
      // Guard: prevent double check-in to an already-occupied room
      if (occupiedRoomIds.has(selectedRoom)) {
        const roomObj = rooms.find((r: any) => r.id === selectedRoom);
        toast.error(`Room ${roomObj?.number || selectedRoom} already has a checked-in guest. Select a different room.`);
        return;
      }
      const roomObj = rooms.find((r: any) => r.id === selectedRoom);
      const baseRate = rateOverride ? parseFloat(rateOverride) : (Number(roomObj?.rate) || (Number(reservations.find((r: any) => r.id === selectedResId)?.rate) || 0));
      const totalRate = computeTotalRate(baseRate, selectedPackage, packageOptions, 'RO');
      const pct = Math.max(0, Math.min(100, parseFloat(taxRatePercent || '0')));
      const includeTax = taxEnabled && taxMethod === 'inclusive';
      checkInGuest(selectedResId, selectedRoom, { rateOverride: totalRate, packageCode: sanitizePackageCode(selectedPackage, 'RO'), taxInclusive: includeTax });
      setCheckInDialogOpen(false);
      setSelectedResId(null);
      setSelectedRoom(null);
      toast.success("Guest checked in successfully");
    }
  };

  // Filter reservations
  const filteredReservations = reservations.filter(r =>
    (getResStatus(r) === 'confirmed' || getResStatus(r) === 'checked-in') &&
    ((r.guestName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.id || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const arrivals = useMemo(() => {
    // Use local date for accurate "today" check
    const today = format(new Date(), 'yyyy-MM-dd');

    console.log('[FrontOffice] Computing arrivals:', {
      totalReservations: reservations.length,
      today
    });

    const matchedArrivals = reservations.filter(r => {
      // Use consistent status checking with getResStatus helper
      const status = getResStatus(r).toLowerCase();

      // Normalize checkIn date for comparison
      // Handle various date formats that might come from database or API
      let checkInDate = '';

      // Try multiple field names for check-in date
      const rawCheckIn = r.checkIn || r.check_in_date || r.check_in;

      if (rawCheckIn) {
        const dateString = String(rawCheckIn);

        // Handle ISO date strings (2024-01-21T10:30:00.000Z)
        if (dateString.includes('T')) {
          checkInDate = dateString.split('T')[0];
        }
        // Handle already formatted YYYY-MM-DD dates
        else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
          checkInDate = dateString;
        }
        // Handle YYYY-MM-DD with additional info
        else if (/^\d{4}-\d{2}-\d{2}/.test(dateString)) {
          const match = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
          checkInDate = match ? match[1] : '';
        }
        // Handle other formats by parsing and reformatting
        else {
          try {
            const dateObj = new Date(dateString);
            if (!isNaN(dateObj.getTime())) {
              checkInDate = format(dateObj, 'yyyy-MM-dd');
            }
          } catch {
            // Fallback to original string if all else fails
            checkInDate = dateString;
          }
        }
      }

      // Match arrivals: confirmed/pending status AND check-in date matches today
      const isArrival = (status === 'confirmed' || status === 'pending') && checkInDate === today;

      // Debug logging for arrivals
      if (isArrival) {
        console.log('[FrontOffice] Matched arrival:', {
          guest: r.guestName,
          rawCheckIn: rawCheckIn,
          normalizedCheckIn: checkInDate,
          today,
          status
        });
      }

      return isArrival;
    });

    console.log('[FrontOffice] Found', matchedArrivals.length, 'arrivals for today');

    return matchedArrivals;
  }, [reservations]);

  const inHouse = filteredReservations.filter(r => getResStatus(r) === 'checked-in');

  // In-House view: multi-field search (guest / room / package) + client pagination.
  const inHouseRoomNo = (res: any) => res.roomNumber || rooms.find(r => String(r.id) === String(res.room_id))?.number || '';
  const inHouseFiltered = React.useMemo(() => {
    const q = inHouseSearchDebounced.trim().toLowerCase();
    if (!q) return inHouse;
    return inHouse.filter(r =>
      String(r.guestName || '').toLowerCase().includes(q) ||
      String(inHouseRoomNo(r)).toLowerCase().includes(q) ||
      String(getResPackage(r)).toLowerCase().includes(q));
  }, [inHouse, inHouseSearchDebounced, rooms]);
  const inHouseTotalPages = Math.max(1, Math.ceil(inHouseFiltered.length / inHousePageSize));
  const inHousePaged = inHouseFiltered.slice((inHousePage - 1) * inHousePageSize, inHousePage * inHousePageSize);
  const printInHouseList = () => printFOReport(
    'In-House Guests Report',
    ['Room', 'Guest', 'Reservation', 'Arrival', 'Departure', 'Package', 'Balance'],
    inHouseFiltered.map(r => [
      inHouseRoomNo(r) || 'Unassigned', r.guestName || 'Unknown', formatShortId(r.id),
      r.checkIn ? String(r.checkIn).slice(0, 10) : '—', r.checkOut ? String(r.checkOut).slice(0, 10) : '—',
      getResPackage(r), `$ ${(Number(r.rate) || 0).toFixed(2)}`,
    ]));

  const checkedOutToday = useMemo(() => {
    // Use local date for accurate "today" check
    const today = format(new Date(), 'yyyy-MM-dd');
    return filteredReservations.filter(r =>
      getResStatus(r) === 'checked-out' &&
      // Handle potential full ISO strings or just YYYY-MM-DD
      (r.checkOut && (r.checkOut === today || r.checkOut.startsWith(today)))
    );
  }, [filteredReservations]);

  // Open + print a guest folio statement (works for checked-out guests — reads
  // folio_charges from the DB, which persists after checkout).
  const [statementBusy, setStatementBusy] = useState<string | null>(null);
  const openGuestStatement = async (res: any) => {
    const rid = res.id || res.reservation_id;
    const gid = res.guestId || res.guest_id;
    if (!rid && !gid) { toast.error('No folio reference', { description: 'This reservation has no id to look up its statement.' }); return; }
    setStatementBusy(rid || gid);
    // Open the window synchronously so the browser keeps user-gesture trust
    const win = window.open('', '_blank');
    if (win) { try { win.document.write('<!doctype html><title>Loading statement…</title><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#475569">⏳ Loading guest statement…</body>'); } catch { /* noop */ } }
    try {
      const qs = new URLSearchParams();
      if (rid) qs.set('reservation_id', rid);
      if (gid) qs.set('guest_id', gid);
      const data = await fetch(`/api/folio/statement?${qs}`).then(r => r.json());
      if (!data.ok) throw new Error(data.error || 'Failed to load statement');
      const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const d10 = (s: any) => (s ? String(s).slice(0, 10) : '—');
      const h = data.header || {};
      const guestName = h.guest_name || res.guestName || 'Guest';
      const body = (data.lines || []).map((l: any) =>
        `<tr><td>${esc(d10(l.date))}</td><td>${esc(l.description)}</td><td>${esc(l.category || '')}</td><td class="r">${l.charge ? '$' + Number(l.charge).toFixed(2) : ''}</td><td class="r">${l.payment ? '$' + Number(l.payment).toFixed(2) : ''}</td><td class="r"><b>$${Number(l.balance).toFixed(2)}</b></td></tr>`).join('');
      const html = `<!doctype html><html><head><title>Guest Statement — ${esc(guestName)}</title><style>
        body{font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#666;font-size:12px;margin-bottom:12px}
        .meta{display:flex;gap:28px;font-size:12px;margin-bottom:14px;flex-wrap:wrap}
        .meta b{color:#111}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}
        th{background:#f5f5f7;font-size:10px;text-transform:uppercase;color:#555}
        .r{text-align:right}
        .totals{margin-top:14px;font-size:13px;text-align:right} .totals b{font-size:16px}
        .paid{color:#15803d} .owed{color:#b91c1c}
      </style></head><body>
        <h1>${esc(getHotelName())} — Guest Statement</h1>
        <div class="sub">Folio account history · Printed ${new Date().toLocaleString()}</div>
        <div class="meta">
          <div>Guest: <b>${esc(guestName)}</b></div>
          <div>Room: <b>${esc(h.room_number || res.roomType || '—')}</b></div>
          <div>Arrival: <b>${esc(d10(h.arrival))}</b></div>
          <div>Departure: <b>${esc(d10(h.departure || res.checkOut))}</b></div>
          <div>Status: <b>${esc(h.status || 'checked-out')}</b></div>
        </div>
        <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="r">Charges</th><th class="r">Payments</th><th class="r">Balance</th></tr></thead>
        <tbody>${body || '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">No folio transactions found for this guest.</td></tr>'}</tbody></table>
        <div class="totals">
          Charges: <b>$${Number(data.totalCharges || 0).toFixed(2)}</b> &nbsp;·&nbsp;
          Payments: <b class="paid">$${Number(data.totalPayments || 0).toFixed(2)}</b> &nbsp;·&nbsp;
          Balance: <b class="${Number(data.closingBalance) > 0.005 ? 'owed' : 'paid'}">$${Number(data.closingBalance || 0).toFixed(2)}</b>
        </div>
      </body></html>`;
      if (win) { win.document.open(); win.document.write(html); win.document.close(); win.focus(); setTimeout(() => { try { win.print(); } catch { /* noop */ } }, 300); }
    } catch (e: any) {
      if (win) { try { win.document.body.innerHTML = `<p style="color:#b91c1c;font-family:system-ui;padding:24px">Failed to load statement: ${e?.message || e}</p>`; } catch { /* noop */ } }
      toast.error('Statement failed', { description: String(e?.message || e) });
    } finally { setStatementBusy(null); }
  };

  if ((dataError || dbError) && guests.length === 0 && reservations.length === 0) {
    // Non-blocking now
  }

  const errorToShow = dataError || dbError;
  const isErrorVisible = !!errorToShow && errorToShow !== dismissedError;

  return (
    <div className="space-y-6">
      {isErrorVisible && (
        <div className="p-3 bg-yellow-50 border rounded text-sm" role="alert" aria-live="polite">
          <div className="flex items-center justify-between">
            <p className="text-yellow-800">{errorToShow}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry Connection</Button>
              <Button variant="ghost" size="sm" onClick={() => setDismissedError(errorToShow)}>Dismiss</Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Front Office</h2>
          <p className="text-muted-foreground">Manage arrivals, departures, and in-house guests</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setQuickCheckInOpen(true)}>
            <UserCheck className="mr-2 h-4 w-4" />
            Quick Check-In
          </Button>
          <Button variant="outline" onClick={openGuestLookup}>
            <FileSearch className="mr-2 h-4 w-4" />
            Guest Lookup
          </Button>
          <Button variant="outline" onClick={() => { setGridStartDate(startOfToday()); setRoomAvailGridOpen(true); }}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            Room Availability
          </Button>
          <Button variant="outline" onClick={() => setPrintOptionsOpen(true)}>
            <Utensils className="mr-2 h-4 w-4" />
            Print Restaurant Guest List
          </Button>
          <Button variant="outline" onClick={() => setRoomStatusDialogOpen(true)}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            Room Status Overview
          </Button>
          <Button variant="outline" onClick={printArrivals}>
            <Printer className="mr-2 h-4 w-4" />
            Print Arrivals
          </Button>
          <Button variant="outline" size="icon" onClick={() => setShowPrintSettings(true)} title="Print Settings">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center space-x-2 bg-white p-2 sm:p-4 rounded-lg shadow-sm border">
        <Search className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
        <Input
          placeholder="Search guest name or reservation ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 border-none shadow-none focus-visible:ring-0 ds-input-compact sm:h-10 sm:text-sm"
        />
      </div>

      <Tabs defaultValue="arrivals" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-7 h-auto p-1 bg-muted">
          <TabsTrigger value="in_house">In House ({inHouse.length})</TabsTrigger>
          <TabsTrigger value="arrivals">Arrivals ({arrivals.length})</TabsTrigger>
          <TabsTrigger value="departures">Departed ({checkedOutToday.length})</TabsTrigger>
          <TabsTrigger value="guests">Guests ({guests.length})</TabsTrigger>
          {canSeeCharges && <TabsTrigger value="charges">Charges</TabsTrigger>}
          <TabsTrigger value="folio">Folio</TabsTrigger>
        </TabsList>

        <TabsContent value="arrivals" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Expected Arrivals</CardTitle>
                  <CardDescription>Guests scheduled to check in today</CardDescription>
                </div>
                <Button variant="outline" onClick={() => printFOReport('Daily Arrivals Report',
                  ['Guest', 'Type', 'Arrival', 'Departure', 'Rate'],
                  arrivals.map((r: any) => [r.guestName || 'Unknown', r.roomType || '—', r.checkIn ? String(r.checkIn).slice(0,10) : '—', r.checkOut ? String(r.checkOut).slice(0,10) : '—', `$ ${(Number(r.rate)||0).toFixed(2)}`]))}
                  disabled={arrivals.length === 0}><Printer className="mr-2 h-4 w-4" />Print List</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arrivals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No arrivals found matching your search
                      </TableCell>
                    </TableRow>
                  ) : (
                    arrivals.map((res) => (
                      <TableRow key={res.id}>
                        <TableCell>
                          <div className="font-medium">{res.guestName}</div>
                          <div className="text-xs text-muted-foreground">ID: {res.id}</div>
                        </TableCell>
                        <TableCell>{res.roomType}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {res.checkIn && !isNaN(new Date(res.checkIn).getTime())
                              ? format(new Date(res.checkIn), 'MMM d')
                              : 'N/A'}
                            {' - '}
                            {res.checkOut && !isNaN(new Date(res.checkOut).getTime())
                              ? format(new Date(res.checkOut), 'MMM d')
                              : 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell>${res.rate}</TableCell>
                        <TableCell><Badge variant="outline">{getResPackage(res)}</Badge></TableCell>
                        <TableCell>
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Confirmed</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => handleCheckInClick(res.id)}>
                            <UserCheck className="mr-2 h-4 w-4" />
                            Check In
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="guests" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Guest Registry</CardTitle>
              <CardDescription>View and manage all guest profiles in the system</CardDescription>
            </CardHeader>
            <CardContent>
              <GuestRegistry
                onEdit={(g: any) => {
                  setEditingGuestId(g.id);
                  setEditGuestName(g.full_name || g.name || '');
                  setEditGuestEmail(g.email || '');
                  setEditGuestPhone(g.phone || '');
                  setShowEditGuestDialog(true);
                }}
                onDeleted={() => ctx.refreshData?.()}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="in_house" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>In House Guests</CardTitle>
                  <CardDescription>Currently occupied rooms</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <Input value={inHouseSearch} onChange={e => setInHouseSearch(e.target.value)}
                    placeholder="Search guest, room or package…" className="w-64" />
                  <Button variant="outline" onClick={printInHouseList} disabled={inHouseFiltered.length === 0}>
                    <Printer className="mr-2 h-4 w-4" />Print In-House List
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Departure</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Package</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inHouseFiltered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {inHouseSearchDebounced ? 'No in-house guests match your search' : 'No in-house guests found'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    inHousePaged.map((res) => {
                      // Prefer the SQL-joined room_number already on the reservation (always up-to-date),
                      // fall back to client-side room lookup if for some reason it's missing.
                      const room = rooms.find(r => String(r.id) === String(res.room_id));
                      const roomNumber = res.roomNumber || room?.number || 'Unassigned';
                      return (
                        <TableRow key={res.id}>
                          <TableCell className="font-bold">{roomNumber}</TableCell>
                          <TableCell>
                            <div className="font-medium">{res.guestName || 'Unknown'}</div>
                            <div className="text-xs text-muted-foreground">ID: {res.id}</div>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              try {
                                const d = new Date(res.checkOut);
                                return (!res.checkOut || isNaN(d.getTime())) ? 'N/A' : format(d, 'MMM d, yyyy');
                              } catch { return 'N/A'; }
                            })()}
                          </TableCell>
                          <TableCell>${(Number(res.rate) || 0).toFixed(2)}</TableCell>
                          <TableCell><Badge variant="secondary">{getResPackage(res)}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {!res.room_id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                                  title="Assign a room to this guest"
                                  onClick={() => {
                                    setAssignRoomResId(res.id);
                                    setAssignRoomSelected(availableRooms.length > 0 ? availableRooms[0].id : null);
                                    setAssignRoomDialogOpen(true);
                                  }}
                                >
                                  Assign Room
                                </Button>
                              )}
                              <Button variant="outline" size="sm" aria-label="View Folio" onClick={() => handleManualChargeClick(res.guest_id || res.id)}>
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button variant="outline" size="sm" title="Transfer Room" onClick={() => handleTransferClick(res.id, res.room_id)}>
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                                title="Extend Stay" 
                                onClick={() => {
                                  setExtendStayResId(res.id);
                                  setExtendStayDate(res.checkOut);
                                  setExtendStayDialogOpen(true);
                                }}
                              >
                                Extend
                              </Button>
                              <Button variant="destructive" size="sm" onClick={() => handleCheckOut(res.id)}>
                                <UserX className="mr-2 h-4 w-4" />
                                Check Out
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between text-sm mt-3">
                <div className="text-muted-foreground">{inHouseFiltered.length} in-house guest(s)</div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={inHousePage <= 1} onClick={() => setInHousePage(p => p - 1)}>Previous</Button>
                  <span className="text-xs">Page {inHousePage} of {inHouseTotalPages}</span>
                  <Button variant="outline" size="sm" disabled={inHousePage >= inHouseTotalPages} onClick={() => setInHousePage(p => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departures" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Today's Check-Outs</CardTitle>
                  <CardDescription>Guests who have departed today</CardDescription>
                </div>
                <Button variant="outline" onClick={() => printFOReport('Daily Departures Report',
                  ['Guest', 'Room', 'Departure', 'Balance'],
                  checkedOutToday.map((r: any) => [r.guestName || 'Unknown', (rooms.find(x => x.id === r.room_id)?.number || r.roomType || '—'), r.checkOut ? String(r.checkOut).slice(0,10) : '—', `$ ${(Number(r.rate)||0).toFixed(2)}`]))}
                  disabled={checkedOutToday.length === 0}><Printer className="mr-2 h-4 w-4" />Print List</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Departure</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Statement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checkedOutToday.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No departures today
                      </TableCell>
                    </TableRow>
                  ) : (
                    checkedOutToday.map((res) => {
                      const room = rooms.find(r => r.id === res.room_id);
                      const roomNumber = room?.number || res.roomType;
                      return (
                        <TableRow key={res.id}>
                          <TableCell className="font-medium">{res.guestName}</TableCell>
                          <TableCell>{roomNumber}</TableCell>
                          <TableCell>
                            {(() => {
                              try {
                                const d = new Date(res.checkOut);
                                return isNaN(d.getTime()) ? '-' : format(d, 'MMM d, yyyy');
                              } catch { return '-'; }
                            })()}
                          </TableCell>
                          <TableCell className="text-green-600">
                            ${(Number(res.rate) || 0).toFixed(2)}
                          </TableCell>
                          <TableCell><Badge variant="secondary" className="bg-gray-100 text-gray-800">Checked Out</Badge></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" disabled={statementBusy === res.id}
                              onClick={() => openGuestStatement(res)}>
                              <Printer className="w-3.5 h-3.5 mr-1" />
                              {statementBusy === res.id ? 'Loading…' : 'Statement'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {canSeeCharges && (
        <TabsContent value="charges" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Charges — Daily Audit Review</CardTitle>
              <CardDescription>Review posted folio transactions by date. Restricted to Night Auditor / Manager / Admin.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChargesAudit />
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* POS Reporting tab removed from Front Office — POS reporting lives in
            POS Management / Back-Office Reports. Standalone POS is unaffected. */}

        <TabsContent value="folio" className="mt-4">
          <FolioManagement />
        </TabsContent>
      </Tabs>

      <Dialog open={extendStayDialogOpen} onOpenChange={setExtendStayDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Extend Guest Stay</DialogTitle>
            <DialogDescription>
              Select the new departure date for this guest.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-checkout" className="text-right">
                New Check-out
              </Label>
              <Input
                id="new-checkout"
                type="date"
                className="col-span-3"
                value={extendStayDate}
                min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                onChange={(e) => setExtendStayDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendStayDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={async () => {
                if (!extendStayResId || !extendStayDate) return;
                const res = reservations.find(r => r.id === extendStayResId);
                if (!res) return;
                
                try {
                  const success = await ctx.updateReservation(extendStayResId, {
                    ...res,
                    checkOut: extendStayDate
                  });
                  if (success) {
                    toast.success('Stay extended successfully');
                    setExtendStayDialogOpen(false);
                  }
                } catch (err) {
                  toast.error('Failed to extend stay');
                }
              }}
            >
              Update Departure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={extendStayDialogOpen} onOpenChange={setExtendStayDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Extend Guest Stay</DialogTitle>
            <DialogDescription>
              Select the new departure date for this guest.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="new-checkout" className="text-right">
                New Check-out
              </Label>
              <Input
                id="new-checkout"
                type="date"
                className="col-span-3"
                value={extendStayDate}
                min={format(addDays(new Date(), 1), 'yyyy-MM-dd')}
                onChange={(e) => setExtendStayDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendStayDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={async () => {
                if (!extendStayResId || !extendStayDate) return;
                const res = reservations.find(r => r.id === extendStayResId);
                if (!res) return;
                
                try {
                  const success = await ctx.updateReservation(extendStayResId, {
                    ...res,
                    checkOut: extendStayDate
                  });
                  if (success) {
                    toast.success('Stay extended successfully');
                    setExtendStayDialogOpen(false);
                  }
                } catch (err) {
                  toast.error('Failed to extend stay');
                }
              }}
            >
              Update Departure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={roomStatusDialogOpen} onOpenChange={setRoomStatusDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Room Status Overview</DialogTitle>
            <DialogDescription>Current status of all rooms in the property.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 max-h-[60vh] overflow-y-auto">
            {rooms.map(room => (
              <div key={room.id} className={`p-3 rounded-lg border text-center ${room.status === 'VC' ? 'bg-green-50 border-green-200 text-green-800' :
                room.status === 'VD' ? 'bg-red-50 border-red-200 text-red-800' :
                  room.status === 'OC' ? 'bg-blue-50 border-blue-200 text-blue-800' :
                    room.status === 'OD' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                      'bg-gray-50 border-gray-200 text-gray-800'
                }`}>
                <div className="font-bold text-lg">{room.number}</div>
                <div className="text-xs font-medium uppercase mt-1">{room.status}</div>
                <div className="text-[10px] mt-1 truncate">{room.type}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center text-xs text-muted-foreground border-t pt-4">
            <div className="flex gap-3">
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span> VC (Vacant Clean)</span>
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-red-500 mr-1"></span> VD (Vacant Dirty)</span>
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-blue-500 mr-1"></span> OC (Occupied Clean)</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setRoomStatusDialogOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        {/* Adjusted max-h to 75vh to ensure it fits on smaller screens with virtual keyboards */}
        <DialogContent className="sm:max-w-[500px] max-h-[75vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>Check In Guest</DialogTitle>
            <DialogDescription>
              Assign a room and confirm rate details.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 p-6 py-4 overflow-y-auto flex-1 min-h-0">
            <div>
              <Label className="mb-2 block text-sm font-medium">Room</Label>
              <Select value={selectedRoom || ''} onValueChange={setSelectedRoom} disabled={isLoadingRooms || !!roomsError || availableRooms.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder={
                    isLoadingRooms ? "Loading rooms..." :
                      roomsError ? "Error loading rooms" :
                        availableRooms.length === 0 ? "No rooms available" :
                          "Assign Room..."
                  } />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((r: any) => {
                    const isDirty = String(r.status || '').toUpperCase() === 'VD';
                    return (
                      <SelectItem key={r.id} value={r.id}>
                        <span className="flex items-center gap-2">
                          Room {r.number} — {r.type} · ${Number(r.rate || 0).toFixed(0)}/night
                          {isDirty && (
                            <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 border border-amber-300 rounded px-1 py-0.5 font-medium">
                              Needs Cleaning
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {availableRooms.length === 0 && !isLoadingRooms && !roomsError && (
                <p className="text-xs text-orange-600 mt-1">
                  No vacant rooms available. Check if all rooms are occupied or marked OOO.
                </p>
              )}
              {roomsError && <p className="text-xs text-red-500 mt-1">{roomsError}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block text-sm font-medium">Daily Rate ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={rateOverride}
                  onChange={(e) => setRateOverride(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium">Meal Plan</Label>
                <Select value={selectedPackage} onValueChange={setSelectedPackage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {packageOptions.map(pkg => (
                      <SelectItem key={pkg.code} value={pkg.code}>
                        {pkg.label} (+${pkg.surcharge})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2 pt-2">
              <Label className="text-sm font-medium">Tax Settings</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="tax_enabled"
                    checked={taxEnabled}
                    onCheckedChange={(checked) => setTaxEnabled(!!checked)}
                    aria-label="Enable tax calculation"
                  />
                  <Label htmlFor="tax_enabled" className="text-sm">Enable Tax</Label>
                </div>
                <div>
                  <Label htmlFor="tax_rate" className="mb-2 block text-sm">Tax Percentage</Label>
                  <Input
                    id="tax_rate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.01"
                    value={taxRatePercent}
                    onChange={(e) => setTaxRatePercent(e.target.value)}
                    aria-invalid={!!taxError}
                    aria-describedby="tax_rate_help"
                  />
                  <p id="tax_rate_help" className={`text-xs mt-1 ${taxError ? 'text-red-600' : 'text-gray-500'}`}>
                    {taxError ? taxError : 'Enter a value between 0 and 100'}
                  </p>
                </div>
                <div>
                  <Label className="mb-2 block text-sm">Calculation Method</Label>
                  <Select value={taxMethod} onValueChange={(v) => setTaxMethod(v as 'inclusive' | 'exclusive')}>
                    <SelectTrigger data-testid="fo-checkin-method-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclusive">Exclusive (add tax on top)</SelectItem>
                      <SelectItem value="inclusive">Inclusive (rate includes tax)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-3 rounded-md border border-blue-100 mt-2">
              <p className="text-xs text-blue-800">
                <strong>Summary:</strong> Room {rooms.find(r => r.id === selectedRoom)?.number || 'Unassigned'} •
                {(() => {
                  const roomObj = rooms.find(r => r.id === selectedRoom);
                  const baseIn = rateOverride ? parseFloat(rateOverride) : (roomObj?.rate || 0);
                  const nightlyBase = (typeof computeTotalRate === 'function' ? computeTotalRate : () => baseIn)(baseIn, selectedPackage, packageOptions, 'RO');
                  const pct = Math.max(0, Math.min(100, parseFloat(taxRatePercent || '0')));
                  const r = isNaN(pct) ? 0 : pct / 100;
                  const nights = (() => {
                    const res = reservations.find(x => x.id === selectedResId);
                    if (!res) return 1;
                    try {
                      return Math.max(1, differenceInCalendarDays(new Date(res.checkOut), new Date(res.checkIn)));
                    } catch { return 1 }
                  })();
                  const calc = (() => {
                    if (!taxEnabled) {
                      const subtotal = nightlyBase * nights;
                      return { nights, nightlyBase, subtotal, tax: 0, total: subtotal, r };
                    }
                    if (taxMethod === 'inclusive') {
                      const nightlySubtotal = nightlyBase / (1 + r);
                      const nightlyTax = nightlyBase - nightlySubtotal;
                      return { nights, nightlyBase, subtotal: nightlySubtotal * nights, tax: nightlyTax * nights, total: nightlyBase * nights, r };
                    }
                    const nightlyTax = nightlyBase * r;
                    const nightlyTotal = nightlyBase + nightlyTax;
                    return { nights, nightlyBase, subtotal: nightlyBase * nights, tax: nightlyTax * nights, total: nightlyTotal * nights, r };
                  })();
                  const pkgLabel = packageOptions.find(p => p.code === sanitizePackageCode(selectedPackage, 'RO'))?.label;
                  return `Rate $${nightlyBase.toFixed(2)} • ${pkgLabel}${taxEnabled ? (taxMethod === 'inclusive' ? ' (Tax Inc.)' : ' (+ Tax)') : ''} • Nights ${calc.nights} • Subtotal $${calc.subtotal.toFixed(2)} • Tax (${(calc.r * 100).toFixed(2)}%) $${calc.tax.toFixed(2)} • Total $${calc.total.toFixed(2)}`;
                })()}
              </p>
            </div>
            <div className="p-3 mt-2 bg-gray-50 border rounded-lg text-sm">
              {(() => {
                const roomObj = rooms.find(r => r.id === selectedRoom);
                const baseIn = rateOverride ? parseFloat(rateOverride) : (roomObj?.rate || 0);
                const nightlyBase = (typeof computeTotalRate === 'function' ? computeTotalRate : () => baseIn)(baseIn, selectedPackage, packageOptions, 'RO');
                const pct = Math.max(0, Math.min(100, parseFloat(taxRatePercent || '0')));
                const r = isNaN(pct) ? 0 : pct / 100;
                const res = reservations.find(x => x.id === selectedResId);
                const nights = (() => {
                  if (!res) return 1;
                  try {
                    return Math.max(1, differenceInCalendarDays(new Date(res.checkOut), new Date(res.checkIn)));
                  } catch { return 1 }
                })();
                const calc = (() => {
                  if (!taxEnabled) {
                    const subtotal = nightlyBase * nights;
                    return { nights, nightlyBase, subtotal, tax: 0, total: subtotal };
                  }
                  if (taxMethod === 'inclusive') {
                    const nightlySubtotal = nightlyBase / (1 + r);
                    const nightlyTax = nightlyBase - nightlySubtotal;
                    return { nights, nightlyBase, subtotal: nightlySubtotal * nights, tax: nightlyTax * nights, total: nightlyBase * nights };
                  }
                  const nightlyTax = nightlyBase * r;
                  const nightlyTotal = nightlyBase + nightlyTax;
                  return { nights, nightlyBase, subtotal: nightlyBase * nights, tax: nightlyTax * nights, total: nightlyTotal * nights };
                })();
                return (
                  <>
                    <p className="text-gray-700">Nights: <span className="font-medium">{calc.nights}</span></p>
                    <p className="text-gray-700">Nightly Rate: <span className="font-medium" data-testid="fo-checkin-nightly-rate">${nightlyBase.toFixed(2)}</span></p>
                    <div className="mt-1">
                      <p className="text-gray-700">Subtotal: <span className="font-medium" data-testid="fo-checkin-subtotal">${calc.subtotal.toFixed(2)}</span></p>
                      <p className="text-gray-700">Tax ({(r * 100).toFixed(2)}%): <span className="font-medium" data-testid="fo-checkin-tax">${calc.tax.toFixed(2)}</span></p>
                      <p className="text-gray-800">Total: <span className="font-semibold" data-testid="fo-checkin-total">${calc.total.toFixed(2)}</span></p>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="p-6 pt-2 border-t mt-auto">
            <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCheckInConfirm} disabled={!selectedRoom}>Confirm Check In</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={chargeDialogOpen} onOpenChange={setChargeDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Manual Charge</DialogTitle>
            <DialogDescription>
              Post a charge to the guest folio manually.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="charge-amount">Amount ($)</Label>
              <Input
                id="charge-amount"
                type="number"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="charge-desc">Description / Code</Label>
              <Input
                id="charge-desc"
                value={chargeDescription}
                onChange={(e) => setChargeDescription(e.target.value)}
                placeholder="e.g. Minibar, Laundry, etc."
              />
            </div>
            {chargeError && (
              <p className="text-sm text-red-500">{chargeError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleChargeSubmit}>Add Charge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TransferRoomModal
        isOpen={transferDialogOpen}
        onClose={() => setTransferDialogOpen(false)}
        reservationId={transferResId}
        currentRoomId={transferRoomId}
        onSuccess={() => {
          setTransferDialogOpen(false);
          setTransferResId(null);
          setTransferRoomId(null);
          // loadAllData() is called inside TransferRoomModal before onSuccess fires
          // so DataContext state is already fresh — no reload needed
        }}
      />

      {/* Assign Room Dialog — for in-house guests with no room assigned */}
      <Dialog open={assignRoomDialogOpen} onOpenChange={setAssignRoomDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Assign Room</DialogTitle>
            <DialogDescription>Select a room to assign to this in-house guest.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {availableRooms.length === 0 ? (
              <p className="text-sm text-orange-600 font-medium">No available rooms at the moment. Mark a room as vacant first.</p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="assign-room-select">Room</Label>
                <Select value={assignRoomSelected || ''} onValueChange={setAssignRoomSelected}>
                  <SelectTrigger id="assign-room-select">
                    <SelectValue placeholder="Select a room" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRooms.map(r => (
                      <SelectItem key={r.id} value={r.id}>
                        Room {r.number} — {r.type} (${r.rate}/night)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignRoomDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!assignRoomSelected || availableRooms.length === 0}
              onClick={() => {
                if (assignRoomResId && assignRoomSelected) {
                  const res = reservations.find(r => r.id === assignRoomResId);
                  const roomObj = availableRooms.find(r => r.id === assignRoomSelected);
                  const baseRate = roomObj?.rate || res?.rate || 0;
                  const pkgCode = sanitizePackageCode(res?.packageCode || res?.package_code || 'RO', 'RO');
                  const totalRate = computeTotalRate(baseRate, pkgCode, packageOptions, 'RO');
                  checkInGuest(assignRoomResId, assignRoomSelected, { rateOverride: totalRate, packageCode: pkgCode, taxInclusive: true });
                  toast.success('Room assigned successfully');
                  setAssignRoomDialogOpen(false);
                  setAssignRoomResId(null);
                  setAssignRoomSelected(null);
                }
              }}
            >
              Assign Room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={guestLookupOpen} onOpenChange={setGuestLookupOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Guest Lookup</DialogTitle>
            <DialogDescription>Search for past and present guests.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 mb-4">
              <Search className="h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by name, email, or reservation ID..."
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const q = lookupQuery.toLowerCase();
                    const hits = reservations.filter(r =>
                      !q ||
                      (r.guestName || '').toLowerCase().includes(q) ||
                      (r.id || '').toLowerCase().includes(q) ||
                      (r.email || '').toLowerCase().includes(q)
                    ).slice(0, 50);

                    if (hits.length === 0) {
                      return <TableRow><TableCell colSpan={4} className="text-center py-4">No results found</TableCell></TableRow>;
                    }

                    return hits.map(r => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.guestName}</div>
                          <div className="text-xs text-muted-foreground">{r.email}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.checkIn} - {r.checkOut}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getResStatus(r)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => {
                            setGuestLookupOpen(false);
                            setSearchTerm(r.id); // Populate main search
                          }}>Select</Button>
                        </TableCell>
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuestLookupOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FOPrintCustomization open={showPrintSettings} onClose={() => setShowPrintSettings(false)} />

      {/* Print Options Dialog */}
      <Dialog open={printOptionsOpen} onOpenChange={setPrintOptionsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Print Options</DialogTitle>
            <DialogDescription>
              Select what information you want to print for restaurant operations.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-4">
              <div>
                <Label className="text-base font-medium mb-2 block">Report Content</Label>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="print-restaurant"
                      name="print-mode"
                      value="restaurant"
                      checked={printMode === 'restaurant'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="Restaurant Guest List"
                      aria-label="Restaurant Guest List"
                    />
                    <Label htmlFor="print-restaurant" className="flex items-center gap-2">
                      <Utensils className="h-4 w-4" />
                      Restaurant Guest List
                      <span className="text-xs text-muted-foreground ml-1">
                        (Checked-in guests for meal planning)
                      </span>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="print-arrivals"
                      name="print-mode"
                      value="arrivals"
                      checked={printMode === 'arrivals'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="Today's Arrivals"
                      aria-label="Today's Arrivals"
                    />
                    <Label htmlFor="print-arrivals" className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4" />
                      Today's Arrivals
                      <span className="text-xs text-muted-foreground ml-1">
                        (Guests checking in today)
                      </span>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="print-departures"
                      name="print-mode"
                      value="departures"
                      checked={printMode === 'departures'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="Today's Departures"
                      aria-label="Today's Departures"
                    />
                    <Label htmlFor="print-departures" className="flex items-center gap-2">
                      <UserX className="h-4 w-4" />
                      Today's Departures
                      <span className="text-xs text-muted-foreground ml-1">
                        (Guests checking out today)
                      </span>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="print-inhouse"
                      name="print-mode"
                      value="inhouse"
                      checked={printMode === 'inhouse'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="In-House Guest List"
                      aria-label="In-House Guest List"
                    />
                    <Label htmlFor="print-inhouse" className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4" />
                      In-House Guest List
                      <span className="text-xs text-muted-foreground ml-1">
                        (All currently checked-in guests)
                      </span>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="print-both"
                      name="print-mode"
                      value="both"
                      checked={printMode === 'both'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="Combined Report"
                      aria-label="Combined Report"
                    />
                    <Label htmlFor="print-both" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Combined Report
                      <span className="text-xs text-muted-foreground ml-1">
                        (Both restaurant list and arrivals)
                      </span>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2 pt-2 border-t mt-2">
                    <input
                      type="radio"
                      id="print-blank"
                      name="print-mode"
                      value="blank-form"
                      checked={printMode === 'blank-form'}
                      onChange={(e) => setPrintMode(e.target.value as any)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                      title="Blank Check-in Form"
                      aria-label="Blank Check-in Form"
                    />
                    <Label htmlFor="print-blank" className="flex items-center gap-2 font-semibold">
                      <Printer className="h-4 w-4 text-hotel-primary" />
                      Print Blank Check-in Form
                      <span className="text-xs text-muted-foreground ml-1 font-normal">
                        (Clean form for walk-ins)
                      </span>
                    </Label>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-base font-medium mb-2 block">Export Format</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={exportFormat === 'pdf' ? 'default' : 'outline'}
                    onClick={() => setExportFormat('pdf')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14,2 14,8 20,8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <line x1="10" y1="9" x2="8" y2="9" />
                    </svg>
                    <span className="text-xs">PDF</span>
                  </Button>
                  <Button
                    variant={exportFormat === 'html' ? 'default' : 'outline'}
                    onClick={() => setExportFormat('html')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <line x1="4" y1="20" x2="20" y2="4" />
                      <line x1="4" y1="4" x2="20" y2="20" />
                    </svg>
                    <span className="text-xs">HTML</span>
                  </Button>
                  <Button
                    variant={exportFormat === 'txt' ? 'default' : 'outline'}
                    onClick={() => setExportFormat('txt')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14,2 14,8 20,8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <line x1="10" y1="9" x2="8" y2="9" />
                    </svg>
                    <span className="text-xs">Text</span>
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-base font-medium mb-2 block">Output Destination</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={printDestination === 'printer' ? 'default' : 'outline'}
                    onClick={() => setPrintDestination('printer')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                  >
                    <Printer className="h-5 w-5" />
                    <span className="text-xs">Printer</span>
                  </Button>
                  <Button
                    variant={printDestination === 'download' ? 'default' : 'outline'}
                    onClick={() => setPrintDestination('download')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7,10 12,15 17,10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span className="text-xs">Download</span>
                  </Button>
                  <Button
                    variant={printDestination === 'email' ? 'default' : 'outline'}
                    onClick={() => setPrintDestination('email')}
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    disabled
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <span className="text-xs">Email</span>
                    <span className="text-[10px] text-muted-foreground">(Soon)</span>
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50 p-3 rounded-md border border-blue-100">
                <h4 className="font-medium text-blue-800 mb-1">Preview Summary</h4>
                <div className="space-y-1">
                  <p className="text-sm text-blue-700">
                    {printMode === 'restaurant' && (
                      <>Restaurant list: {inHouse.length} in-house guests with meal packages</>
                    )}
                    {printMode === 'arrivals' && (
                      <>Arrivals report: {todayArrivals.length} guests checking in today</>
                    )}
                    {printMode === 'departures' && (
                      <>Departures report: Guests checking out today</>
                    )}
                    {printMode === 'inhouse' && (
                      <>In-House report: {inHouse.length} currently checked-in guests</>
                    )}
                    {printMode === 'both' && (
                      <>Combined report: {inHouse.length} in-house + {todayArrivals.length} arrivals</>
                    )}
                  </p>
                  <p className="text-xs text-blue-600">
                    Format: <span className="font-medium">{exportFormat.toUpperCase()}</span> •
                    Destination: <span className="font-medium">
                      {printDestination === 'printer' ? 'Direct Print' :
                        printDestination === 'download' ? 'File Download' : 'Email (Coming Soon)'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOptionsOpen(false)}>Cancel</Button>
            <Button onClick={handlePrintWithOptions}>
              {printDestination === 'printer' ? (
                <Printer className="mr-2 h-4 w-4" />
              ) : printDestination === 'download' ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 h-4 w-4">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 h-4 w-4">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              )}
              {printDestination === 'printer' ? 'Print Report' :
                printDestination === 'download' ? 'Download Report' : 'Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arrivals Print Preview Dialog */}
      <Dialog open={arrivalsPreviewOpen} onOpenChange={setArrivalsPreviewOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="no-print">
            <DialogTitle>Arrivals Report Preview</DialogTitle>
            <DialogDescription>
              Review the arrivals report before printing. Click "Print Report" to send to printer.
            </DialogDescription>
          </DialogHeader>

          <ReportLayout
            reportName="Daily Arrivals Report"
            subtitle={`${todayArrivals.length} Guest${todayArrivals.length !== 1 ? 's' : ''} Expected`}
            reportDate={new Date()}
            showPrintButton={true}
            showDownloadButton={false}
            metaInfo={[
              { label: 'Report Type', value: 'Front Office - Arrivals' },
              { label: 'Business Date', value: format(new Date(), 'MMMM d, yyyy') },
              { label: 'Total Arrivals', value: String(todayArrivals.length) },
              { label: 'Generated By', value: 'Front Desk' }
            ]}
          >
            {todayArrivals.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-lg">No arrivals scheduled for today</p>
                <p className="text-sm mt-2">Check back later or view upcoming reservations in the Reservations module.</p>
              </div>
            ) : (
              <ReportTable
                headers={[
                  { label: 'Guest Name', align: 'left' },
                  { label: 'Contact', align: 'left' },
                  { label: 'Room Type', align: 'left' },
                  { label: 'Room #', align: 'center' },
                  { label: 'Check-In', align: 'center' },
                  { label: 'Check-Out', align: 'center' },
                  { label: 'Nights', align: 'center' },
                  { label: 'Pax', align: 'center' },
                  { label: 'Package', align: 'left' },
                  { label: 'Rate', align: 'right' }
                ]}
                footer={
                  <tr>
                    <td colSpan={7} className="text-right font-semibold">Total Guests:</td>
                    <td className="text-center font-bold">
                      {todayArrivals.reduce((sum, r) => sum + (r.adults || 1) + (r.children || 0), 0)}
                    </td>
                    <td></td>
                    <td className="text-right font-bold">
                      ${todayArrivals.reduce((sum, r) => sum + (Number(r.rate) || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                }
              >
                {todayArrivals.map((res) => {
                  const nights = (() => {
                    try {
                      return Math.max(1, differenceInCalendarDays(new Date(res.checkOut), new Date(res.checkIn)));
                    } catch { return 1; }
                  })();
                  return (
                    <tr key={res.id}>
                      <td className="font-medium">
                        {res.guestName}
                        {res.vip && <span className="ml-1 text-xs text-amber-600">(VIP)</span>}
                      </td>
                      <td className="text-sm text-gray-600">
                        {res.email || res.phone || '-'}
                      </td>
                      <td>{res.roomType}</td>
                      <td className="text-center font-medium">{getRoomAssignment(res)}</td>
                      <td className="text-center">
                        {(() => {
                          try {
                            const d = new Date(res.checkIn);
                            return isNaN(d.getTime()) ? '-' : format(d, 'MMM d');
                          } catch { return '-'; }
                        })()}
                      </td>
                      <td className="text-center">
                        {(() => {
                          try {
                            const d = new Date(res.checkOut);
                            return isNaN(d.getTime()) ? '-' : format(d, 'MMM d');
                          } catch { return '-'; }
                        })()}
                      </td>
                      <td className="text-center">{nights}</td>
                      <td className="text-center">
                        {res.adults || 1}{res.children ? `+${res.children}` : ''}
                      </td>
                      <td>
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          {getResPackage(res)}
                        </span>
                      </td>
                      <td className="text-right font-medium">${(Number(res.rate) || 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </ReportTable>
            )}

            {/* Special Requests Section */}
            {todayArrivals.some(r => r.specialRequests || r.notes) && (
              <div className="mt-6 avoid-break">
                <h4 className="font-semibold text-sm border-b pb-1 mb-3">Special Requests & Notes</h4>
                <div className="space-y-2">
                  {todayArrivals.filter(r => r.specialRequests || r.notes).map(r => (
                    <div key={r.id} className="text-sm p-2 bg-gray-50 rounded">
                      <span className="font-medium">{r.guestName}:</span>{' '}
                      <span className="text-gray-600">{r.specialRequests || r.notes}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ReportLayout>

          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setArrivalsPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QuickCheckInModal
        isOpen={quickCheckInOpen}
        onClose={() => setQuickCheckInOpen(false)}
      />

      {/* ── Room Availability Grid ── */}
      <Dialog open={roomAvailGridOpen} onOpenChange={setRoomAvailGridOpen}>
        <DialogContent className="max-w-[95vw] w-full max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b">
            <DialogTitle>Room Availability Grid</DialogTitle>
            <DialogDescription className="sr-only">Visual room availability calendar</DialogDescription>
          </DialogHeader>

          {/* Controls */}
          <div className="flex items-center justify-between gap-3 px-5 py-2 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              {/* Day range selector */}
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={gridDays}
                onChange={e => setGridDays(Number(e.target.value) as 7 | 14 | 30)}
              >
                <option value={7}>7 Days</option>
                <option value={14}>14 Days</option>
                <option value={30}>30 Days</option>
              </select>
              <Button variant="outline" size="sm" onClick={() => setGridStartDate(d => addDays(d, -gridDays))}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setGridStartDate(startOfToday())}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => setGridStartDate(d => addDays(d, gridDays))}>Next</Button>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-100 border border-green-300"></span>Vacant</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-200 border border-blue-400"></span>Booked</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-200 border border-amber-400"></span>Occupied</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-200 border border-gray-400"></span>Checked Out</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400"></span>Dirty</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-400"></span>OOO</span>
            </div>
          </div>

          {/* Grid */}
          {(() => {
            const today = format(startOfToday(), 'yyyy-MM-dd');
            const dateColumns = Array.from({ length: gridDays }, (_, i) => addDays(gridStartDate, i));
            const sortedRooms = [...rooms].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));

            // Build a lookup: roomId → array of {checkIn, checkOut, status}
            type ResSlot = { checkIn: string; checkOut: string; status: string; guestName: string };
            const roomResMap = new Map<string, ResSlot[]>();
            for (const res of reservations) {
              const rid = String(res.room_id || '');
              if (!rid) continue;
              if (!roomResMap.has(rid)) roomResMap.set(rid, []);
              roomResMap.get(rid)!.push({
                checkIn: String(res.checkIn || res.check_in_date || '').substring(0, 10),
                checkOut: String(res.checkOut || res.check_out_date || '').substring(0, 10),
                status: String(res.status || '').toLowerCase(),
                guestName: String(res.guestName || ''),
              });
            }

            const getCellInfo = (room: any, date: Date): { bg: string; label: string; title: string } => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isToday = dateStr === today;

              const slots = roomResMap.get(String(room.id)) || [];
              for (const slot of slots) {
                if (!slot.checkIn || !slot.checkOut) continue;
                if (dateStr >= slot.checkIn && dateStr < slot.checkOut) {
                  const displayName = slot.guestName ? (slot.guestName.split(' ')[0] || slot.guestName) : '';
                  if (slot.status === 'checked-in') {
                    return { bg: 'bg-amber-200 border-amber-400 text-amber-950', label: displayName, title: `Occupied — ${slot.guestName}` };
                  }
                  if (slot.status === 'checked-out') {
                    return { bg: 'bg-gray-200 border-gray-400 text-gray-700', label: displayName, title: `Checked Out — ${slot.guestName}` };
                  }
                  if (slot.status === 'confirmed' || slot.status === 'pending') {
                    return { bg: 'bg-blue-200 border-blue-400 text-blue-950', label: displayName, title: `Booked — ${slot.guestName}` };
                  }
                }
              }

              // Today's Room Status Overlay (if no reservation)
              if (isToday) {
                const s = String(room.status || '').toUpperCase();
                if (s === 'OOO' || s === 'OUT OF ORDER') {
                  return { bg: 'bg-red-200 border-red-400 text-red-900', label: 'OOO', title: 'Out of Order' };
                }
                if (s === 'VD' || s === 'VACANT DIRTY' || s === 'OD' || s === 'OCCUPIED DIRTY') {
                  return { bg: 'bg-yellow-200 border-yellow-400 text-yellow-900', label: 'Dirty', title: `Dirty (${s})` };
                }
                if (s === 'OCC' || s === 'OCCUPIED') {
                  return { bg: 'bg-amber-200 border-amber-400 text-amber-950', label: 'Occupied', title: 'Occupied' };
                }
              }

              return { bg: 'bg-green-100 border-green-300 text-green-900', label: '', title: 'Vacant' };
            };

            return (
              <div className="flex-1 overflow-auto">
                <table className="border-collapse w-full text-xs select-none" style={{ minWidth: `${160 + gridDays * 68}px` }}>
                  <thead className="sticky top-0 z-10 bg-white shadow-sm">
                    <tr>
                      <th className="sticky left-0 z-20 bg-gray-50 border border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 min-w-[160px] w-[160px]">Room</th>
                      {dateColumns.map(date => {
                        const ds = format(date, 'yyyy-MM-dd');
                        const isToday = ds === today;
                        return (
                          <th
                            key={ds}
                            className={`border border-gray-200 px-1 py-2 text-center font-medium min-w-[68px] w-[68px] ${isToday ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600'
                              }`}
                          >
                            <div className="text-sm font-bold">{format(date, 'd')}</div>
                            <div className={`text-[10px] font-normal ${isToday ? 'text-blue-100' : 'text-gray-400'}`}>{format(date, 'EEE')}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRooms.map((room, ri) => (
                      <tr key={room.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="sticky left-0 z-10 border border-gray-200 px-3 py-2 bg-inherit min-w-[160px] w-[160px]">
                          <div className="font-semibold text-gray-800">{room.number}</div>
                          <div className="text-[10px] text-gray-400 truncate">{room.type}</div>
                        </td>
                        {dateColumns.map(date => {
                          const { bg, title, label } = getCellInfo(room, date);
                          const ds = format(date, 'yyyy-MM-dd');
                          const isToday = ds === today;
                          const isVacant = title === 'Vacant';
                          return (
                            <td
                              key={ds}
                              title={title}
                              onClick={() => {
                                if (isVacant) {
                                  // Find the room and pre-select it in QuickCheckInModal
                                  const room = rooms.find((r: any) => r.id === room.id);
                                  if (room) {
                                    // Set the selected room in the QuickCheckInModal
                                    (window as any).__quickCheckInRoomId = room.id;
                                    (window as any).__quickCheckInRoomNumber = room.number;
                                  }
                                  setQuickCheckInOpen(true);
                                }
                              }}
                              className={`border ${isToday ? 'border-blue-400' : 'border-gray-200'
                                } ${bg} h-10 min-w-[68px] w-[68px] text-center ${isVacant ? 'cursor-pointer hover:opacity-50' : 'cursor-default'} transition-opacity hover:opacity-75 relative`}
                            >
                              {label && (
                                <div className="flex items-center justify-center h-full w-full">
                                  <span className="truncate max-w-full px-1 text-[10px] font-medium leading-tight">
                                    {label}
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {sortedRooms.length === 0 && (
                      <tr><td colSpan={gridDays + 1} className="py-10 text-center text-gray-400 italic">No rooms found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

          <div className="px-5 py-3 border-t flex justify-end bg-gray-50">
            <Button variant="outline" onClick={() => setRoomAvailGridOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Edit Guest Dialog */}
      <Dialog open={showEditGuestDialog} onOpenChange={setShowEditGuestDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Guest Profile</DialogTitle>
            <DialogDescription>Update guest contact information.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="guestName">Full Name</Label>
              <Input 
                id="guestName" 
                value={editGuestName} 
                onChange={(e) => setEditGuestName(e.target.value)} 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guestEmail">Email Address</Label>
              <Input 
                id="guestEmail" 
                type="email" 
                value={editGuestEmail} 
                onChange={(e) => setEditGuestEmail(e.target.value)} 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="guestPhone">Phone Number</Label>
              <Input 
                id="guestPhone" 
                value={editGuestPhone} 
                onChange={(e) => setEditGuestPhone(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditGuestDialog(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (!editGuestName.trim()) {
                toast.error('Name is required');
                return;
              }
              try {
                const { updateGuestInDb } = await import('@/lib/dbSync');
                const res = await updateGuestInDb(editingGuestId!, {
                  name: editGuestName,
                  email: editGuestEmail,
                  phone: editGuestPhone
                });
                if (res.success) {
                  toast.success('Guest updated successfully');
                  setShowEditGuestDialog(false);
                  ctx.refreshData?.();
                } else {
                  toast.error('Failed to update guest: ' + res.error);
                }
              } catch (err) {
                toast.error('Failed to update guest');
              }
            }}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
