import React, { useMemo } from 'react';
import { ReportLayout, ReportTable, ReportSummary, ReportSection } from './ReportLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog';
import { Button } from './button';
import { format } from 'date-fns';

// ============================================================================
// TYPES
// ============================================================================

export interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  format?: (value: any, row: any) => string | React.ReactNode;
}

export interface ReportSummaryItem {
  label: string;
  value: string | number;
  isTotal?: boolean;
}

export interface ReportViewerProps {
  /** Report title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Report date */
  reportDate?: Date | string;
  /** Column definitions */
  columns: ReportColumn[];
  /** Row data */
  rows: any[];
  /** Report type - detailed shows all data, summary shows aggregates */
  reportType?: 'detailed' | 'summary';
  /** Meta information for report header */
  metaInfo?: Array<{ label: string; value: string }>;
  /** Footer summary items */
  footerSummary?: ReportSummaryItem[];
  /** Show signature section */
  showSignature?: boolean;
  /** Signature labels */
  signatureLabels?: { left?: string; right?: string };
  /** Whether dialog is open */
  open?: boolean;
  /** Dialog open change handler */
  onOpenChange?: (open: boolean) => void;
  /** Custom footer content */
  footerContent?: React.ReactNode;
  /** Additional sections to render */
  sections?: Array<{ title: string; content: React.ReactNode }>;
  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Page size for printing */
  pageSize?: 'A4' | 'Letter';
}

// ============================================================================
// REPORT VIEWER COMPONENT
// ============================================================================

/**
 * ReportViewer - Standardized report viewing component with print support.
 * 
 * Uses ReportLayout for consistent branding and accounting-standard formatting.
 * Supports both detailed and summary report types with comprehensive transaction data.
 */
export const ReportViewer: React.FC<ReportViewerProps> = ({
  title,
  subtitle,
  reportDate = new Date(),
  columns,
  rows,
  reportType = 'detailed',
  metaInfo = [],
  footerSummary = [],
  showSignature = false,
  signatureLabels = { left: 'Prepared By', right: 'Approved By' },
  open = true,
  onOpenChange,
  footerContent,
  sections = [],
  loading = false,
  error,
  emptyMessage = 'No data available for this report',
  pageSize = 'A4'
}) => {
  // Format report date
  const formattedDate = useMemo(() => {
    const d = typeof reportDate === 'string' ? new Date(reportDate) : reportDate;
    return format(d, 'MMMM d, yyyy');
  }, [reportDate]);

  // Add report type to meta info
  const enhancedMetaInfo = useMemo(() => [
    { label: 'Report Type', value: reportType === 'detailed' ? 'Detailed Report' : 'Summary Report' },
    { label: 'Generated', value: format(new Date(), 'MMM d, yyyy h:mm a') },
    ...metaInfo
  ], [metaInfo, reportType]);

  // Format cell value
  const formatCell = (col: ReportColumn, row: any, rowIndex: number): React.ReactNode => {
    const value = row[col.key] ?? row[col.key.toLowerCase()] ?? row[col.label] ?? row[col.label.toLowerCase()] ?? '';
    
    if (col.format) {
      return col.format(value, row);
    }

    if (value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return col.align === 'right' 
        ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : value.toLocaleString();
    }
    return String(value);
  };

  // Build table headers
  const tableHeaders = useMemo(() => 
    columns.map(col => ({
      label: col.label,
      align: col.align || 'left' as const,
      width: col.width
    })), [columns]);

  // Build summary items for ReportSummary
  const summaryItems = useMemo(() => 
    footerSummary.map(s => ({
      label: s.label,
      value: typeof s.value === 'number' 
        ? `$${s.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : s.value,
      isTotal: s.isTotal
    })), [footerSummary]);

  // Dialog wrapper content
  const dialogContent = (
    <DialogContent className="sm:max-w-[950px] max-h-[90vh] overflow-y-auto">
      <DialogHeader className="no-print">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {subtitle || `${reportType === 'detailed' ? 'Detailed' : 'Summary'} report with accounting-standard formatting. Click "Print Report" to print.`}
        </DialogDescription>
      </DialogHeader>
      
      <ReportLayout
        reportName={title}
        subtitle={subtitle}
        reportDate={reportDate}
        showPrintButton={true}
        showDownloadButton={false}
        pageSize={pageSize}
        metaInfo={enhancedMetaInfo}
        showSignature={showSignature}
        signatureLabels={signatureLabels}
        footerContent={footerContent}
      >
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full mb-2" />
            <p>Loading report data...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-600">
            <p className="font-medium">Error loading report</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-lg">{emptyMessage}</p>
          </div>
        ) : (
          <>
            <ReportTable headers={tableHeaders}>
              {rows.map((row, idx) => (
                <tr key={row.id || idx} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                  {columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      className={`p-2 border-b border-gray-200 ${
                        col.align === 'right' ? 'text-right' :
                        col.align === 'center' ? 'text-center' : ''
                      }`}
                    >
                      {formatCell(col, row, idx)}
                    </td>
                  ))}
                </tr>
              ))}
            </ReportTable>

            {/* Additional sections */}
            {sections.map((section, idx) => (
              <ReportSection key={idx} title={section.title}>
                {section.content}
              </ReportSection>
            ))}

            {/* Footer Summary */}
            {summaryItems.length > 0 && (
              <ReportSummary items={summaryItems} />
            )}
          </>
        )}
      </ReportLayout>
      
      <DialogFooter className="no-print">
        <Button variant="outline" onClick={() => onOpenChange?.(false)}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );

  // If dialog mode
  if (onOpenChange) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {dialogContent}
      </Dialog>
    );
  }

  // Standalone mode (no dialog)
  return (
    <div className="report-viewer-standalone">
      <ReportLayout
        reportName={title}
        subtitle={subtitle}
        reportDate={reportDate}
        showPrintButton={true}
        showDownloadButton={false}
        pageSize={pageSize}
        metaInfo={enhancedMetaInfo}
        showSignature={showSignature}
        signatureLabels={signatureLabels}
        footerContent={footerContent}
      >
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full mb-2" />
            <p>Loading report data...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-600">
            <p className="font-medium">Error loading report</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-lg">{emptyMessage}</p>
          </div>
        ) : (
          <>
            <ReportTable headers={tableHeaders}>
              {rows.map((row, idx) => (
                <tr key={row.id || idx} className={idx % 2 === 1 ? 'bg-gray-50' : ''}>
                  {columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      className={`p-2 border-b border-gray-200 ${
                        col.align === 'right' ? 'text-right' :
                        col.align === 'center' ? 'text-center' : ''
                      }`}
                    >
                      {formatCell(col, row, idx)}
                    </td>
                  ))}
                </tr>
              ))}
            </ReportTable>

            {sections.map((section, idx) => (
              <ReportSection key={idx} title={section.title}>
                {section.content}
              </ReportSection>
            ))}

            {summaryItems.length > 0 && (
              <ReportSummary items={summaryItems} />
            )}
          </>
        )}
      </ReportLayout>
    </div>
  );
};

// ============================================================================
// HELPER HOOKS
// ============================================================================

/**
 * Hook to manage report viewer state
 */
export const useReportViewer = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [reportKey, setReportKey] = React.useState<string | null>(null);

  const openReport = React.useCallback((key: string) => {
    setReportKey(key);
    setIsOpen(true);
  }, []);

  const closeReport = React.useCallback(() => {
    setIsOpen(false);
    setReportKey(null);
  }, []);

  return {
    isOpen,
    reportKey,
    openReport,
    closeReport,
    setIsOpen
  };
};

export default ReportViewer;
