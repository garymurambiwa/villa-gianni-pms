import React, { useMemo, useRef, useCallback } from 'react';
import { readReceiptBranding, readPrintSettings, PaperSize } from '@/lib/printSettings';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface CompanyInfo {
  name: string;
  logo_url?: string;
  show_logo?: boolean;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface ReportLayoutProps {
  /** Report title displayed in header (e.g., "Account Statement", "Guest Folio") */
  reportName: string;
  /** Optional subtitle (e.g., "Room 101 - John Doe") */
  subtitle?: string;
  /** Report generation date (defaults to current date) */
  reportDate?: Date | string;
  /** Page size: A4 or Letter */
  pageSize?: 'A4' | 'Letter';
  /** Orientation: portrait or landscape */
  orientation?: 'portrait' | 'landscape';
  /** Custom company info (overrides global settings) */
  companyInfo?: Partial<CompanyInfo>;
  /** Report content */
  children: React.ReactNode;
  /** Whether to show print button */
  showPrintButton?: boolean;
  /** Whether to show download button (future PDF export) */
  showDownloadButton?: boolean;
  /** Custom header content (appended after company info) */
  headerContent?: React.ReactNode;
  /** Custom footer content (before powered by) */
  footerContent?: React.ReactNode;
  /** Additional CSS classes for the container */
  className?: string;
  /** Show signature section */
  showSignature?: boolean;
  /** Signature labels */
  signatureLabels?: { left?: string; right?: string };
  /** Meta information to display (e.g., Guest Name, Room Number) */
  metaInfo?: Array<{ label: string; value: string }>;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format date for report display
 */
const formatReportDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Get company info from global settings
 */
const getCompanyInfo = (override?: Partial<CompanyInfo>): CompanyInfo => {
  try {
    const branding = readReceiptBranding();
    return {
      name: override?.name || branding.restaurant_name || 'Core DPMS',
      logo_url: override?.logo_url ?? branding.logo_url,
      show_logo: override?.show_logo ?? branding.show_logo ?? true,
      address: override?.address ?? branding.address,
      phone: override?.phone ?? branding.phone,
      email: override?.email ?? branding.email,
      website: override?.website ?? branding.website,
    };
  } catch {
    return {
      name: override?.name || 'Core DPMS',
      logo_url: override?.logo_url,
      show_logo: override?.show_logo ?? true,
      address: override?.address,
      phone: override?.phone,
      email: override?.email,
      website: override?.website,
    };
  }
};

// ============================================================================
// REPORT LAYOUT COMPONENT
// ============================================================================

/**
 * ReportLayout - Reusable component for all printed documents
 * 
 * Provides consistent branding, layout, and print optimization for:
 * - Guest Folios
 * - Account Statements
 * - Management Reports
 * - Z/X Readings
 * - Invoices
 * 
 * Features:
 * - Company header with logo and details
 * - Thematic blue divider
 * - Report name and date
 * - Print-optimized table styles
 * - Page break handling
 * - Signature sections
 */
export const ReportLayout: React.FC<ReportLayoutProps> = ({
  reportName,
  subtitle,
  reportDate = new Date(),
  pageSize = 'A4',
  orientation = 'portrait',
  companyInfo: companyInfoOverride,
  children,
  showPrintButton = true,
  showDownloadButton = false,
  headerContent,
  footerContent,
  className = '',
  showSignature = false,
  signatureLabels = { left: 'Guest Signature', right: 'Authorized Signature' },
  metaInfo,
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const company = useMemo(() => getCompanyInfo(companyInfoOverride), [companyInfoOverride]);
  const formattedDate = useMemo(() => formatReportDate(reportDate), [reportDate]);

  // Print handler
  const handlePrint = useCallback(() => {
    if (!reportRef.current) return;
    
    // Create print window
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print this report.');
      return;
    }

    // Get print settings
    const settings = readPrintSettings();
    const sizeMap: Record<PaperSize, string> = {
      A4: '210mm 297mm',
      Letter: '8.5in 11in',
      Legal: '8.5in 14in'
    };

    // Build print HTML
    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${reportName} - ${company.name}</title>
        <style>
          :root {
            --print-brand-primary: #0073e6;
            --print-brand-secondary: #1e3a5f;
            --print-text-primary: #1a1a1a;
            --print-text-secondary: #4a4a4a;
            --print-text-muted: #6b7280;
            --print-border-color: #e5e7eb;
          }

          @page {
            size: ${pageSize === 'Letter' ? sizeMap.Letter : sizeMap.A4} ${orientation};
            margin: ${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm;
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 10pt;
            line-height: 1.4;
            color: var(--print-text-primary);
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .report-container {
            width: 100%;
            max-width: 100%;
          }

          .report-header {
            text-align: center;
            margin-bottom: 12px;
          }

          .company-logo {
            max-height: 60px;
            max-width: 180px;
            object-fit: contain;
            margin-bottom: 8px;
          }

          .company-name {
            font-size: 16pt;
            font-weight: 700;
            color: var(--print-brand-secondary);
            margin: 0 0 4px 0;
          }

          .company-details {
            font-size: 9pt;
            color: var(--print-text-secondary);
            line-height: 1.5;
          }

          .company-details span::after {
            content: " • ";
            color: var(--print-text-muted);
          }

          .company-details span:last-child::after {
            content: "";
          }

          .report-divider {
            width: 100%;
            height: 4px;
            background: linear-gradient(90deg, #0073e6, #2196f3);
            margin: 12px 0 16px 0;
            border-radius: 2px;
          }

          .report-identity {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--print-border-color);
          }

          .report-title {
            font-size: 14pt;
            font-weight: 600;
            color: var(--print-brand-primary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .report-subtitle {
            font-size: 10pt;
            color: var(--print-text-secondary);
            font-weight: 400;
            text-transform: none;
            letter-spacing: normal;
            margin-left: 8px;
          }

          .report-date {
            font-size: 9pt;
            color: var(--print-text-muted);
          }

          .report-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 8px 24px;
            margin-bottom: 16px;
            padding: 12px;
            background: #f8fafc;
            border-radius: 4px;
          }

          .report-meta-item {
            display: flex;
            flex-direction: column;
          }

          .report-meta-label {
            font-size: 8pt;
            font-weight: 600;
            color: var(--print-text-muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .report-meta-value {
            font-size: 10pt;
            color: var(--print-text-primary);
            font-weight: 500;
          }

          .report-content {
            margin-bottom: 20px;
          }

          /* Table Styles */
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 9pt;
          }

          thead {
            display: table-header-group;
          }

          thead th {
            background: var(--print-brand-primary) !important;
            color: white !important;
            font-weight: 600;
            text-align: left;
            padding: 8px 10px;
            font-size: 9pt;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }

          thead th.text-right { text-align: right; }
          thead th.text-center { text-align: center; }

          tbody tr {
            page-break-inside: avoid;
          }

          tbody tr:nth-child(even) {
            background: #f9fafb;
          }

          tbody td {
            padding: 6px 10px;
            border-bottom: 1px solid var(--print-border-color);
          }

          tbody td.text-right { text-align: right; }
          tbody td.text-center { text-align: center; }
          tbody td.font-bold { font-weight: 600; }

          tfoot tr {
            background: #e5e7eb !important;
            font-weight: 600;
          }

          tfoot td {
            padding: 8px 10px;
            border-top: 2px solid var(--print-brand-primary);
          }

          /* Signature Section */
          .signature-section {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 60px;
            margin-top: 40px;
            page-break-inside: avoid;
          }

          .signature-block {
            text-align: center;
          }

          .signature-line {
            border-bottom: 1px solid var(--print-text-primary);
            height: 40px;
            margin-bottom: 4px;
          }

          .signature-label {
            font-size: 8pt;
            color: var(--print-text-muted);
            text-transform: uppercase;
          }

          /* Footer */
          .powered-by {
            text-align: center;
            font-size: 8pt;
            color: var(--print-text-muted);
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid var(--print-border-color);
          }

          /* Page breaks */
          .page-break-before { page-break-before: always; }
          .page-break-after { page-break-after: always; }
          .avoid-break { page-break-inside: avoid; }
        </style>
      </head>
      <body>
        ${reportRef.current.innerHTML}
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printHTML);
    printWindow.document.close();
    printWindow.focus();

    // Trigger print after content loads
    const triggerPrint = () => {
      try {
        printWindow.print();
        setTimeout(() => printWindow.close(), 500);
      } catch {
        setTimeout(triggerPrint, 250);
      }
    };

    printWindow.addEventListener('load', triggerPrint);
    setTimeout(triggerPrint, 500);
  }, [reportName, company.name, pageSize, orientation]);

  return (
    <div className={`report-wrapper ${className}`}>
      {/* Print/Download Controls (hidden on print) */}
      {(showPrintButton || showDownloadButton) && (
        <div className="no-print flex justify-end gap-2 mb-4">
          {showPrintButton && (
            <Button onClick={handlePrint} variant="outline" size="sm">
              <Printer className="w-4 h-4 mr-2" />
              Print Report
            </Button>
          )}
          {showDownloadButton && (
            <Button variant="outline" size="sm" disabled>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          )}
        </div>
      )}

      {/* Report Container */}
      <div ref={reportRef} className="report-container report-preview bg-white">
        {/* Company Header */}
        <div className="report-header">
          {company.show_logo && company.logo_url && (
            <img
              src={company.logo_url}
              alt={`${company.name} Logo`}
              className="company-logo mx-auto"
            />
          )}
          <h1 className="company-name">{company.name}</h1>
          <div className="company-details">
            {company.address && <span>{company.address}</span>}
            {company.phone && <span>Tel: {company.phone}</span>}
            {company.email && <span>{company.email}</span>}
            {company.website && <span>{company.website}</span>}
          </div>
          {headerContent}
        </div>

        {/* Thematic Divider - Thick Blue Border */}
        <div className="report-divider" />

        {/* Report Identity */}
        <div className="report-identity">
          <h2 className="report-title">
            {reportName}
            {subtitle && <span className="report-subtitle">— {subtitle}</span>}
          </h2>
          <span className="report-date">{formattedDate}</span>
        </div>

        {/* Meta Information */}
        {metaInfo && metaInfo.length > 0 && (
          <div className="report-meta">
            {metaInfo.map((item, idx) => (
              <div key={idx} className="report-meta-item">
                <span className="report-meta-label">{item.label}</span>
                <span className="report-meta-value">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Report Content */}
        <div className="report-content">
          {children}
        </div>

        {/* Signature Section */}
        {showSignature && (
          <div className="signature-section avoid-break">
            <div className="signature-block">
              <div className="signature-line" />
              <span className="signature-label">{signatureLabels.left}</span>
            </div>
            <div className="signature-block">
              <div className="signature-line" />
              <span className="signature-label">{signatureLabels.right}</span>
            </div>
          </div>
        )}

        {/* Custom Footer Content */}
        {footerContent}

        {/* Powered By Footer */}
        <div className="powered-by">
          Powered by Core DPMS • Printed on {new Date().toLocaleString()}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SUB-COMPONENTS FOR REPORT CONTENT
// ============================================================================

/**
 * ReportSection - Section with title and content
 */
export const ReportSection: React.FC<{
  title: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, children, className = '' }) => (
  <div className={`report-section avoid-break ${className}`}>
    <h3 className="report-section-title text-sm font-semibold text-gray-700 border-b border-gray-200 pb-1 mb-3">
      {title}
    </h3>
    {children}
  </div>
);

/**
 * ReportTable - Pre-styled table for reports
 */
export const ReportTable: React.FC<{
  headers: Array<{ label: string; align?: 'left' | 'center' | 'right'; width?: string }>;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}> = ({ headers, children, footer, className = '' }) => (
  <table className={`report-table w-full border-collapse text-xs sm:text-sm ${className}`}>
    <thead>
      <tr>
        {headers.map((h, idx) => (
          <th
            key={idx}
            className={`bg-blue-600 text-white font-semibold p-2 text-${h.align || 'left'} uppercase text-xs tracking-wide`}
            style={h.width ? { width: h.width } : undefined}
          >
            {h.label}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
    {footer && <tfoot>{footer}</tfoot>}
  </table>
);

/**
 * ReportSummary - Summary/totals section
 */
export const ReportSummary: React.FC<{
  items: Array<{ label: string; value: string; isTotal?: boolean }>;
  className?: string;
}> = ({ items, className = '' }) => (
  <div className={`report-summary border-t-2 border-blue-600 pt-3 mt-4 ${className}`}>
    {items.map((item, idx) => (
      <div
        key={idx}
        className={`flex justify-between py-1 ${
          item.isTotal ? 'font-bold text-base border-t border-gray-200 pt-2 mt-2' : 'text-sm'
        }`}
      >
        <span className="text-gray-600">{item.label}</span>
        <span className={item.isTotal ? 'text-gray-900' : 'text-gray-700 font-medium'}>
          {item.value}
        </span>
      </div>
    ))}
  </div>
);

// Default export
export default ReportLayout;
