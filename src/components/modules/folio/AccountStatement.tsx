import React, { useState, useMemo } from "react";
import { formatShortId } from "@/lib/formatId";
import { Folio } from "@/types/folio";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Guest } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ExportOptions, ExportFormat, generatePDF, generateDOCX, generateXLSX } from "@/lib/documentUtils";
import { printDocument } from "@/lib/posIntegration";
import { readReceiptBranding, applySettingsToHTML, readPrintSettings, writePrintSettings, Orientation } from "@/lib/printSettings";
import { ReportLayout, ReportTable, ReportSummary } from "@/components/ui/ReportLayout";
import { Calendar, CreditCard, Home, User, FileText, Download, Printer, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AccountStatementProps {
  folio: Folio;
  guests?: Guest[];
}

/**
 * AccountStatement Component
 * 
 * Displays a comprehensive account statement for a guest folio including:
 * - Guest name, room number, check-in/check-out dates
 * - Transaction history with running balance
 * - Summary totals (charges, payments, balance)
 * - Export and print functionality using ReportLayout
 */
const AccountStatement: React.FC<AccountStatementProps> = ({ folio, guests }) => {
  const guest = guests?.find(g => g.id === folio.guestId);
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week">("all");
  const [showExport, setShowExport] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showPrintableView, setShowPrintableView] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: 'pdf' as ExportFormat,
    applyWatermark: false,
    watermarkText: 'CONFIDENTIAL',
    includeMetadata: true,
    password: '',
    dateRange: { start: '', end: '' },
    includeTransactions: true,
    includeTotals: true,
    includeGuestDetails: true
  });
  const [previewHTML, setPreviewHTML] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [printSettings, setPrintSettings] = useState(readPrintSettings());

  // Format date helper
  const formatDate = (dateStr: string | undefined | null): string => {
    if (!dateStr) return 'N/A';
    try {
      return format(new Date(dateStr), "MMM dd, yyyy");
    } catch {
      return 'N/A';
    }
  };

  // Guest information
  const guestInfo = useMemo(() => ({
    name: guest?.name || (folio as any).guestName || 'Unassigned Guest',
    roomNumber: folio.roomNumber || guest?.roomNumber || 'N/A',
    // Stay dates live on the reservation → carried onto the folio; guest is a fallback.
    checkIn: formatDate((folio as any).arrivalDate || guest?.checkIn),
    checkOut: formatDate((folio as any).departureDate || guest?.checkOut),
    email: guest?.email || '',
    phone: guest?.phone || ''
  }), [guest, folio]);

  // Filter transactions based on date filter
  const filteredTransactions = useMemo(() => {
    const transactions = Array.isArray(folio.transactions) ? folio.transactions : [];
    return transactions.filter(transaction => {
      if (dateFilter === "all") return true;
      
      const today = new Date();
      const transactionDate = new Date(transaction.date);
      
      if (dateFilter === "today") {
        return (
          transactionDate.getDate() === today.getDate() &&
          transactionDate.getMonth() === today.getMonth() &&
          transactionDate.getFullYear() === today.getFullYear()
        );
      }
      
      if (dateFilter === "week") {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(today.getDate() - 7);
        return transactionDate >= oneWeekAgo;
      }
      
      return true;
    });
  }, [folio.transactions, dateFilter]);
  
  // Calculate totals
  const totals = useMemo(() => {
    const charges = filteredTransactions
      .filter(t => t.type === "charge" && !t.voidedBy)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
      
    const payments = filteredTransactions
      .filter(t => t.type === "payment" && !t.voidedBy)
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
      
    const adjustments = filteredTransactions
      .filter(t => t.type === "adjustment" && !t.voidedBy)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    // Compute balance from transactions: charges - payments + adjustments
    // This ensures the balance reflects all posted transactions
    const computedBalance = Number((charges - payments + adjustments).toFixed(2));
    
    // Use computed balance or fall back to folio.balance if no transactions
    const balance = filteredTransactions.length > 0 ? computedBalance : (folio.balance || 0);

    return { charges, payments, adjustments, balance };
  }, [filteredTransactions, folio.balance]);

  // Calculate running balance for each transaction
  const transactionsWithBalance = useMemo(() => {
    let runningBalance = 0;
    return filteredTransactions.map(t => {
      if (!t.voidedBy) {
        runningBalance += t.amount;
      }
      return { ...t, runningBalance };
    });
  }, [filteredTransactions]);

  // Meta information for report header
  const metaInfo = useMemo(() => [
    { label: 'Guest Name', value: guestInfo.name },
    { label: 'Room Number', value: guestInfo.roomNumber },
    { label: 'Check-In Date', value: guestInfo.checkIn },
    { label: 'Check-Out Date', value: guestInfo.checkOut },
  ], [guestInfo]);

  // Generate print HTML with guest details
  const generatePrintHTML = () => {
    const brand = readReceiptBranding();
    const rows = transactionsWithBalance.map(t => `
      <tr${t.voidedBy ? ' style="opacity:0.5"' : ''}>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${format(new Date(t.date), "MMM dd, yyyy")}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">
          ${t.description}${t.voidedBy ? ' <span style="color:#ef4444">(Voided)</span>' : ''}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-transform:capitalize">${t.type}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">$${Number(t.amount || 0).toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right">$${t.runningBalance.toFixed(2)}</td>
      </tr>
    `).join('');

    return `
      <div class="stmt">
        ${brand.show_logo && brand.logo_url ? `<div style="text-align:center;margin-bottom:8px"><img src="${brand.logo_url}" alt="Logo" style="max-height:60px;max-width:180px;object-fit:contain"/></div>` : ''}
        <div style="text-align:center;font-size:16pt;font-weight:700;color:#1e3a5f;margin-bottom:4px">${brand.restaurant_name || 'Property Management System'}</div>
        ${brand.address ? `<div style="text-align:center;font-size:9pt;color:#4a4a4a">${brand.address}</div>` : ''}
        ${brand.phone ? `<div style="text-align:center;font-size:9pt;color:#4a4a4a">Tel: ${brand.phone}</div>` : ''}
        
        <div style="width:100%;height:4px;background:linear-gradient(90deg,#0073e6,#2196f3);margin:12px 0 16px 0;border-radius:2px"></div>
        
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">
          <div style="font-size:14pt;font-weight:600;color:#0073e6;text-transform:uppercase;letter-spacing:0.05em">Account Statement</div>
          <div style="font-size:9pt;color:#6b7280">${format(new Date(), "MMMM dd, yyyy")}</div>
        </div>
        
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 24px;margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:4px">
          <div><div style="font-size:8pt;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Guest Name</div><div style="font-size:10pt;font-weight:500">${guestInfo.name}</div></div>
          <div><div style="font-size:8pt;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Room Number</div><div style="font-size:10pt;font-weight:500">${guestInfo.roomNumber}</div></div>
          <div><div style="font-size:8pt;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Check-In Date</div><div style="font-size:10pt;font-weight:500">${guestInfo.checkIn}</div></div>
          <div><div style="font-size:8pt;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Check-Out Date</div><div style="font-size:10pt;font-weight:500">${guestInfo.checkOut}</div></div>
        </div>
        
        <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:9pt">
          <thead>
            <tr>
              <th style="background:#0073e6;color:white;font-weight:600;text-align:left;padding:8px 10px;text-transform:uppercase;font-size:9pt;letter-spacing:0.03em">Date</th>
              <th style="background:#0073e6;color:white;font-weight:600;text-align:left;padding:8px 10px;text-transform:uppercase;font-size:9pt;letter-spacing:0.03em">Description</th>
              <th style="background:#0073e6;color:white;font-weight:600;text-align:left;padding:8px 10px;text-transform:uppercase;font-size:9pt;letter-spacing:0.03em">Type</th>
              <th style="background:#0073e6;color:white;font-weight:600;text-align:right;padding:8px 10px;text-transform:uppercase;font-size:9pt;letter-spacing:0.03em">Amount</th>
              <th style="background:#0073e6;color:white;font-weight:600;text-align:right;padding:8px 10px;text-transform:uppercase;font-size:9pt;letter-spacing:0.03em">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#6b7280">No transactions found</td></tr>'}
          </tbody>
        </table>
        
        <div style="border-top:2px solid #0073e6;padding-top:12px;margin-top:20px">
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10pt"><span style="color:#4a4a4a">Total Charges</span><span style="font-weight:600">$${totals.charges.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10pt"><span style="color:#4a4a4a">Total Payments</span><span style="font-weight:600">-$${totals.payments.toFixed(2)}</span></div>
          ${totals.adjustments !== 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10pt"><span style="color:#4a4a4a">Adjustments</span><span style="font-weight:600">$${totals.adjustments.toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:12pt;font-weight:700;border-top:1px solid #e5e7eb;margin-top:8px"><span>Account Balance</span><span style="color:#0073e6">$${Number(totals.balance || 0).toFixed(2)}</span></div>
        </div>
        
        <div style="text-align:center;font-size:8pt;color:#6b7280;margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb">
          Powered by Core DPMS • Printed on ${new Date().toLocaleString()}
        </div>
      </div>
      <!-- ReceiptBrandingApplied -->
    `;
  };

  return (
    <div className="space-y-6">
      {/* Guest Information Header */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-blue-600" />
              Account Statement
            </h2>
            <p className="text-sm text-gray-500 mt-1" title={folio.id}>Folio {formatShortId(folio.id)}</p>
          </div>
          <Badge variant={folio.status === 'open' ? 'default' : folio.status === 'closed' ? 'secondary' : 'outline'}>
            {folio.status.charAt(0).toUpperCase() + folio.status.slice(1)}
          </Badge>
        </div>

        {/* Guest Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">
              <User className="w-3.5 h-3.5" />
              Guest Name
            </div>
            <div className="text-lg font-semibold text-gray-900">{guestInfo.name}</div>
          </div>
          
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">
              <Home className="w-3.5 h-3.5" />
              Room Number
            </div>
            <div className="text-lg font-semibold text-gray-900">{guestInfo.roomNumber}</div>
          </div>
          
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">
              <Calendar className="w-3.5 h-3.5" />
              Check-In
            </div>
            <div className="text-lg font-semibold text-gray-900">{guestInfo.checkIn}</div>
          </div>
          
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">
              <Calendar className="w-3.5 h-3.5" />
              Check-Out
            </div>
            <div className="text-lg font-semibold text-gray-900">{guestInfo.checkOut}</div>
          </div>
        </div>
      </div>

      {/* Balance Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Charges</div>
                <div className="text-2xl font-bold text-gray-900">${totals.charges.toFixed(2)}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Payments</div>
                <div className="text-2xl font-bold text-green-600">${totals.payments.toFixed(2)}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Adjustments</div>
                <div className="text-2xl font-bold text-amber-600">${totals.adjustments.toFixed(2)}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="border-l-4 border-l-indigo-500 bg-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-indigo-600 uppercase tracking-wide">Account Balance</div>
                <div className="text-2xl font-bold text-indigo-700">${Number(totals.balance || 0).toFixed(2)}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-indigo-200 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-indigo-700" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Date Filter & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filter:</span>
          <div className="flex gap-1">
            <Button 
              variant={dateFilter === "all" ? "default" : "outline"} 
              size="sm"
              onClick={() => setDateFilter("all")}
            >
              All
            </Button>
            <Button 
              variant={dateFilter === "today" ? "default" : "outline"} 
              size="sm"
              onClick={() => setDateFilter("today")}
            >
              Today
            </Button>
            <Button 
              variant={dateFilter === "week" ? "default" : "outline"} 
              size="sm"
              onClick={() => setDateFilter("week")}
            >
              This Week
            </Button>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowPrintableView(true)}>
            <Printer className="w-4 h-4 mr-2" />
            Print Preview
          </Button>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">Amount</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactionsWithBalance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No transactions found
                  </td>
                </tr>
              ) : (
                transactionsWithBalance.map((transaction) => (
                  <tr 
                    key={transaction.id} 
                    className={`hover:bg-gray-50 transition-colors ${transaction.voidedBy ? "opacity-50 bg-gray-50" : ""}`}
                  >
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {format(new Date(transaction.date), "MMM dd, yyyy")}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {transaction.description}
                      {transaction.voidedBy && (
                        <Badge variant="destructive" className="ml-2 text-xs">Voided</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge 
                        variant={
                          transaction.type === 'charge' ? 'default' : 
                          transaction.type === 'payment' ? 'secondary' : 
                          'outline'
                        }
                        className="capitalize text-xs"
                      >
                        {transaction.type}
                      </Badge>
                    </td>
                    <td className={`px-4 py-3 text-sm text-right font-medium ${
                      transaction.type === 'payment' ? 'text-green-600' : 
                      transaction.type === 'charge' ? 'text-gray-900' : 
                      'text-amber-600'
                    }`}>
                      {transaction.type === 'payment' ? '-' : ''}${Number(transaction.amount || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                      ${transaction.runningBalance.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable View Dialog */}
      <Dialog open={showPrintableView} onOpenChange={setShowPrintableView}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Print Preview - Account Statement</DialogTitle>
          </DialogHeader>
          
          <ReportLayout
            reportName="Account Statement"
            subtitle={`Room ${guestInfo.roomNumber} - ${guestInfo.name}`}
            metaInfo={metaInfo}
            showSignature={true}
            signatureLabels={{ left: 'Guest Signature', right: 'Authorized By' }}
          >
            <ReportTable
              headers={[
                { label: 'Date', width: '120px' },
                { label: 'Description' },
                { label: 'Type', width: '100px' },
                { label: 'Amount', align: 'right', width: '100px' },
                { label: 'Balance', align: 'right', width: '100px' },
              ]}
              footer={
                <tr className="bg-gray-100 font-semibold">
                  <td colSpan={3} className="px-4 py-2 text-right">Account Balance:</td>
                  <td colSpan={2} className="px-4 py-2 text-right text-blue-600">${Number(totals.balance || 0).toFixed(2)}</td>
                </tr>
              }
            >
              {transactionsWithBalance.map((t) => (
                <tr key={t.id} className={t.voidedBy ? "opacity-50" : ""}>
                  <td className="px-3 py-2 border-b border-gray-200">{format(new Date(t.date), "MMM dd, yyyy")}</td>
                  <td className="px-3 py-2 border-b border-gray-200">
                    {t.description}
                    {t.voidedBy && <span className="text-red-500 ml-2">(Voided)</span>}
                  </td>
                  <td className="px-3 py-2 border-b border-gray-200 capitalize">{t.type}</td>
                  <td className="px-3 py-2 border-b border-gray-200 text-right">${Number(t.amount || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 border-b border-gray-200 text-right font-medium">${t.runningBalance.toFixed(2)}</td>
                </tr>
              ))}
            </ReportTable>
            
            <ReportSummary
              items={[
                { label: 'Total Charges', value: `$${totals.charges.toFixed(2)}` },
                { label: 'Total Payments', value: `-$${totals.payments.toFixed(2)}` },
                ...(totals.adjustments !== 0 ? [{ label: 'Adjustments', value: `$${totals.adjustments.toFixed(2)}` }] : []),
                { label: 'Account Balance', value: `$${Number(totals.balance || 0).toFixed(2)}`, isTotal: true },
              ]}
            />
          </ReportLayout>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Format</Label>
                <Select value={exportOptions.format} onValueChange={(v) => setExportOptions({ ...exportOptions, format: v as ExportFormat })}>
                  <SelectTrigger><SelectValue placeholder="Select format" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="docx">DOCX</SelectItem>
                    <SelectItem value="xlsx">XLSX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Password (optional)</Label>
                <Input type="password" value={exportOptions.password || ''} onChange={(e) => setExportOptions({ ...exportOptions, password: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={exportOptions.dateRange?.start || ''} onChange={(e) => setExportOptions({ ...exportOptions, dateRange: { ...(exportOptions.dateRange || {}), start: e.target.value } })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={exportOptions.dateRange?.end || ''} onChange={(e) => setExportOptions({ ...exportOptions, dateRange: { ...(exportOptions.dateRange || {}), end: e.target.value } })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Include Data</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="inc-tx" checked={!!exportOptions.includeTransactions} onCheckedChange={(c) => setExportOptions({ ...exportOptions, includeTransactions: c as boolean })} />
                <Label htmlFor="inc-tx">Transactions</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="inc-tot" checked={!!exportOptions.includeTotals} onCheckedChange={(c) => setExportOptions({ ...exportOptions, includeTotals: c as boolean })} />
                <Label htmlFor="inc-tot">Totals</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="inc-guest" checked={!!exportOptions.includeGuestDetails} onCheckedChange={(c) => setExportOptions({ ...exportOptions, includeGuestDetails: c as boolean })} />
                <Label htmlFor="inc-guest">Guest Details</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowExport(false)}>Cancel</Button>
            <Button onClick={async () => {
              const meta = exportOptions.includeMetadata ? {
                generatedAt: new Date().toISOString(),
                folioId: folio.id,
                guestName: guest?.name || '',
                format: exportOptions.format
              } : undefined;
              const opts = { ...exportOptions, metadata: meta };
              let blob: Blob;
              if (opts.format === 'pdf') blob = await generatePDF(folio, opts, guest?.name, undefined, undefined, undefined);
              else if (opts.format === 'docx') blob = await generateDOCX(folio, opts, guest?.name, undefined, undefined, undefined);
              else blob = await generateXLSX(folio, opts, guest?.name, undefined, undefined, undefined);
              const name = (guest?.name || 'Guest').replace(/\s+/g, '_');
              const fn = `statement_${name}_${new Date().getTime()}.${opts.format}`;
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
              setShowExport(false);
            }}>Export</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Dialog */}
      <Dialog open={showPrint} onOpenChange={setShowPrint}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Print Statement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Orientation</Label>
                <Select
                  value={printSettings.orientation}
                  onValueChange={(v) => {
                    const next = writePrintSettings({ orientation: v as Orientation });
                    setPrintSettings(next);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select orientation" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Header</Label>
                <Input
                  value={printSettings.headerText}
                  onChange={(e) => {
                    const next = writePrintSettings({ headerText: e.target.value });
                    setPrintSettings(next);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Footer</Label>
                <Input
                  value={printSettings.footerText}
                  onChange={(e) => {
                    const next = writePrintSettings({ footerText: e.target.value });
                    setPrintSettings(next);
                  }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => {
                const title = `Statement — ${folio.id}`;
                const htmlInner = generatePrintHTML();
                const wrapped = applySettingsToHTML(title, htmlInner);
                setPreviewHTML(wrapped);
                setShowPreview(true);
              }}>Preview</Button>
              <Button onClick={() => {
                const title = `Statement — ${folio.id}`;
                const htmlInner = generatePrintHTML();
                const wrapped = applySettingsToHTML(title, htmlInner);
                printDocument(wrapped, title, true);
                setShowPrint(false);
              }}>Print</Button>
            </div>
            {showPreview && (
              <div className="border rounded h-[60vh] overflow-auto bg-white">
                <iframe title="statement-preview" srcDoc={previewHTML} className="w-full h-full" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccountStatement;
