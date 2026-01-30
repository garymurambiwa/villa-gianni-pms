import { Folio, Transaction } from '../types/folio';
import { printDocument } from './posIntegration';
import { format } from 'date-fns';

// Document format types
export type ExportFormat = 'pdf' | 'docx' | 'xlsx';
export type PrintQuality = 'draft' | 'normal' | 'high';
export type ColorMode = 'color' | 'grayscale';

export interface PrintOptions {
  pageRange?: { start: number; end: number };
  quality: PrintQuality;
  colorMode: ColorMode;
}

export interface ExportOptions {
  format: ExportFormat;
  password?: string;
  applyWatermark: boolean;
  watermarkText?: string;
  includeMetadata: boolean;
  metadata?: Record<string, string>;
  dateRange?: { start?: string; end?: string };
  includeTransactions?: boolean;
  includeTotals?: boolean;
  includeGuestDetails?: boolean;
}

export interface BatchExportOptions extends ExportOptions {
  folioIds: string[];
}

// Helper function to format currency
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Generate folio document content
export const generateFolioContent = (
  folio: Folio, 
  guestName?: string, 
  roomType?: string,
  checkInDate?: Date,
  checkOutDate?: Date,
  options?: { 
    range?: { start?: Date; end?: Date }; 
    includeTransactions?: boolean; 
    includeTotals?: boolean; 
    includeGuestDetails?: boolean 
  }
): string => {
  const { transactions } = folio;
  const { readReceiptBranding } = require('./printSettings');
  const brand = readReceiptBranding();
  const blue = '#0073e6';
  const range = options?.range;
  const includeTx = options?.includeTransactions !== false;
  const includeTotals = options?.includeTotals !== false;
  const includeGuest = options?.includeGuestDetails !== false;
  
  let content = '';
  content += `${brand.restaurant_name ? `${brand.restaurant_name}\n` : 'Hotel Folio\n'}`;
  if (brand.address) content += `${brand.address}\n`;
  if (brand.phone) content += `Phone: ${brand.phone}\n`;
  if (brand.email) content += `Email: ${brand.email}\n`;
  content += `\n`;
  if (includeGuest) {
    content += `Guest: ${guestName || 'Unknown Guest'}\n`;
    content += `Room: ${folio.roomNumber}${roomType ? ` (${roomType})` : ''}\n`;
    if (checkInDate) content += `Check-in: ${format(checkInDate, 'MMM dd, yyyy')}\n`;
    if (checkOutDate) content += `Check-out: ${format(checkOutDate, 'MMM dd, yyyy')}\n`;
  }
  content += `\n`;
  if (includeTx) {
    content += `TRANSACTIONS:\n`;
    content += `-----------------------------------------------------\n`;
    content += `Date       | Description                | Amount\n`;
    content += `-----------------------------------------------------\n`;
  }
  
  const inRange = (d: Date) => {
    if (!range || (!range.start && !range.end)) return true;
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const start = range.start ? new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate()) : undefined;
    const end = range.end ? new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate()) : undefined;
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  };

  const filtered = transactions.filter(t => inRange(new Date(t.date)));
  if (includeTx) {
    filtered.forEach(transaction => {
      content += `\n${format(new Date(transaction.date), 'MM/dd/yyyy')} | ${transaction.description.padEnd(25)} | ${formatCurrency(transaction.amount)}`;
    });
    content += `\n`;
  }
  
  // Calculate total
  if (includeTotals) {
    const total = filtered.reduce((sum, t) => sum + t.amount, 0);
    content += `-----------------------------------------------------\n`;
    content += `TOTAL: ${formatCurrency(total)}\n`;
    content += `-----------------------------------------------------\n`;
  }
  
  return content;
};

// Generate PDF document
export const generatePDF = async (
  folio: Folio, 
  options: ExportOptions,
  guestName?: string,
  roomType?: string,
  checkInDate?: Date,
  checkOutDate?: Date
): Promise<Blob> => {
  try {
    if (!folio) {
      throw new Error('Invalid folio data');
    }
    
    // In a real implementation, this would use a PDF library
    // For this demo, we'll simulate PDF generation
    const range = options.dateRange ? { 
      start: options.dateRange.start ? new Date(options.dateRange.start) : undefined, 
      end: options.dateRange.end ? new Date(options.dateRange.end) : undefined 
    } : undefined;
    let content = generateFolioContent(
      folio, 
      guestName, 
      roomType, 
      checkInDate, 
      checkOutDate,
      { 
        range, 
        includeTransactions: options.includeTransactions !== false, 
        includeTotals: options.includeTotals !== false,
        includeGuestDetails: options.includeGuestDetails !== false
      }
    );
    content = injectMetadata(content, options);
    
    // Apply security if needed
    const secureContent = options.applyWatermark && options.watermarkText 
      ? applyWatermark(content, options.watermarkText)
      : content;
    
    // Simulate PDF generation delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return a mock PDF blob
    return new Blob([secureContent], { type: 'application/pdf' });
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(`Failed to generate PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Generate DOCX document
export const generateDOCX = async (
  folio: Folio, 
  options: ExportOptions,
  guestName?: string,
  roomType?: string,
  checkInDate?: Date,
  checkOutDate?: Date
): Promise<Blob> => {
  try {
    if (!folio) {
      throw new Error('Invalid folio data');
    }
    
    // In a real implementation, this would use a DOCX library
    const range = options.dateRange ? { 
      start: options.dateRange.start ? new Date(options.dateRange.start) : undefined, 
      end: options.dateRange.end ? new Date(options.dateRange.end) : undefined 
    } : undefined;
    let content = generateFolioContent(
      folio, 
      guestName, 
      roomType, 
      checkInDate, 
      checkOutDate,
      { 
        range, 
        includeTransactions: options.includeTransactions !== false, 
        includeTotals: options.includeTotals !== false,
        includeGuestDetails: options.includeGuestDetails !== false
      }
    );
    content = injectMetadata(content, options);
    
    // Apply security if needed
    const secureContent = options.applyWatermark && options.watermarkText 
      ? applyWatermark(content, options.watermarkText)
      : content;
    
    // Simulate DOCX generation delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Return a mock DOCX blob
    return new Blob([secureContent], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  } catch (error) {
    console.error('Error generating DOCX:', error);
    throw new Error(`Failed to generate DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Generate XLSX document
export const generateXLSX = async (
  folio: Folio, 
  options: ExportOptions,
  guestName?: string,
  roomType?: string,
  checkInDate?: Date,
  checkOutDate?: Date
): Promise<Blob> => {
  try {
    if (!folio) {
      throw new Error('Invalid folio data');
    }
    
    // In a real implementation, this would use an XLSX library
    const range = options.dateRange ? { 
      start: options.dateRange.start ? new Date(options.dateRange.start) : undefined, 
      end: options.dateRange.end ? new Date(options.dateRange.end) : undefined 
    } : undefined;
    let content = generateFolioContent(
      folio, 
      guestName, 
      roomType, 
      checkInDate, 
      checkOutDate,
      { 
        range, 
        includeTransactions: options.includeTransactions !== false, 
        includeTotals: options.includeTotals !== false,
        includeGuestDetails: options.includeGuestDetails !== false
      }
    );
    content = injectMetadata(content, options);
    
    // Apply security if needed
    const secureContent = options.applyWatermark && options.watermarkText 
      ? applyWatermark(content, options.watermarkText)
      : content;
    
    // Simulate XLSX generation delay
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Return a mock XLSX blob
    return new Blob([secureContent], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } catch (error) {
    console.error('Error generating XLSX:', error);
    throw new Error(`Failed to generate XLSX: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Apply watermark to document content
export const applyWatermark = (content: string, watermarkText: string): string => {
  // In a real implementation, this would apply a watermark to the document
  // For this demo, we'll just add the watermark text to the content
  return `${content}\n\n${watermarkText} - ${new Date().toISOString()}`;
};

// Print folio document
export const printFolio = async (
  folio: Folio, 
  options: PrintOptions,
  guestName?: string,
  roomType?: string,
  checkInDate?: Date,
  checkOutDate?: Date
): Promise<boolean> => {
  try {
    if (!folio) {
      throw new Error('Invalid folio data');
    }
    
    // Generate folio content and print via browser print dialog
    const content = generateFolioContent(folio, guestName, roomType, checkInDate, checkOutDate);

    // Optional watermark rendering
    const wm = options && 'applyWatermark' in options ? (options as any).applyWatermark : false;
    const wmText = options && 'watermarkText' in options ? (options as any).watermarkText : '';
    const contentWithWatermark = wm && wmText ? `${content}\n\n${wmText}` : content;

    // Basic HTML wrapper respecting print quality and color mode
    const { readReceiptBranding } = await import('./printSettings');
    const brand = readReceiptBranding();
    const title = `Folio — ${folio.id}`;
    const html = `
      <div style="font-family: system-ui, monospace;">
        ${brand.show_logo && brand.logo_url ? `<div style="text-align:center"><img src="${brand.logo_url}" alt="Logo" style="max-width:120px"/></div>` : ''}
        <div style="text-align:center;font-weight:bold">${brand.restaurant_name}</div>
        <div style="margin-top:8px; white-space:pre-wrap; font-family: monospace;">${contentWithWatermark.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      </div>
    `;

    // Trigger the print dialog (requires user gesture)
    printDocument(html, title, true);
    return true;
  } catch (error) {
    console.error('Error printing folio:', error);
    throw new Error(`Failed to print folio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Batch export multiple folios
export const batchExportFolios = async (
  folios: Folio[], 
  options: BatchExportOptions,
  guestLookup?: (guestId: string) => { name?: string; checkInDate?: Date; checkOutDate?: Date } | undefined,
  roomLookup?: (roomNumber: string) => { type?: string } | undefined
): Promise<Blob[]> => {
  // Export each folio based on the selected format
  const exportPromises = folios.map(folio => {
    const guest = guestLookup?.(folio.guestId);
    const room = roomLookup?.(folio.roomNumber);
    
    switch (options.format) {
      case 'pdf':
        return generatePDF(folio, options, guest?.name, room?.type, guest?.checkInDate, guest?.checkOutDate);
      case 'docx':
        return generateDOCX(folio, options, guest?.name, room?.type, guest?.checkInDate, guest?.checkOutDate);
      case 'xlsx':
        return generateXLSX(folio, options, guest?.name, room?.type, guest?.checkInDate, guest?.checkOutDate);
      default:
        return generatePDF(folio, options, guest?.name, room?.type, guest?.checkInDate, guest?.checkOutDate);
    }
  });
  
  // Wait for all exports to complete
  return Promise.all(exportPromises);
};

// Download a blob as a file
export const downloadBlob = (blob: Blob, filename: string): void => {
  try {
    if (!blob || blob.size === 0) {
      throw new Error('Invalid file data');
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`File "${filename}" downloaded successfully`);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};
const injectMetadata = (content: string, options: ExportOptions): string => {
  if (!options.includeMetadata) return content;
  const meta = options.metadata || {};
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`);
  const metaBlock = `\n\n--- Metadata ---\n${lines.join('\n')}\n----------------`;
  return `${content}${metaBlock}`;
};
