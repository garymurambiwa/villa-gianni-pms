import React, { useState } from 'react';
import { Folio } from '../../../types/folio';
import { 
  ExportFormat, 
  ExportOptions, 
  PrintOptions, 
  ColorMode, 
  PrintQuality,
  generatePDF,
  generateDOCX,
  generateXLSX,
  printFolio,
  batchExportFolios,
  downloadBlob,
  generateFolioContent
} from '../../../lib/documentUtils';
import { Button } from '../../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Progress } from '../../ui/progress';
import { useToast } from '../../../hooks/use-toast';
import { Guest, Room } from '@/types';
import PrintCustomizationModal from '@/components/modules/PrintCustomizationModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { applySettingsToHTML } from '@/lib/printSettings';

interface PrintExportPanelProps {
  folio: Folio;
  availableFolios?: Folio[];
  guests: Guest[];
  rooms?: Room[];
}

const PrintExportPanel: React.FC<PrintExportPanelProps> = ({ folio, availableFolios = [], guests, rooms = [] }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'print' | 'export'>('print');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPrintSettings, setShowPrintSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHTML, setPreviewHTML] = useState<string>('');
  
  // Print options
  const [printOptions, setPrintOptions] = useState<PrintOptions>({
    pageRange: { start: 1, end: 5 },
    quality: 'normal' as PrintQuality,
    colorMode: 'color' as ColorMode
  });
  
  // Export options
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
  
  // Batch export options
  const [selectedFolioIds, setSelectedFolioIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  
  // Handle print action
  const handlePrint = async () => {
    setIsProcessing(true);
    setProgress(10);
    
    try {
      // Get guest and room information
      const guest = guests.find(g => g.id === folio.guestId);
      const room = rooms.find(r => r.number === folio.roomNumber);
      
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 200);
      
      await printFolio(
        folio, 
        printOptions, 
        guest?.name,
        room?.type,
        guest?.checkIn ? new Date(guest.checkIn) : undefined,
        guest?.checkOut ? new Date(guest.checkOut) : undefined
      );
      
      clearInterval(progressInterval);
      setProgress(100);
      
      toast({
        title: "Print job sent",
        description: "The folio has been sent to the printer.",
      });
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: "Print failed",
        description: error instanceof Error 
          ? `Error: ${error.message}` 
          : "There was an error printing the folio. Please verify printer connection and system resources.",
        variant: "destructive"
      });
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setProgress(0);
      }, 1000);
    }
  };
  
  // Handle export action
  const handleExport = async () => {
    setIsProcessing(true);
    setProgress(10);
    
    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 15, 90));
      }, 200);
      
      let blob: Blob;
      
      if (batchMode && selectedFolioIds.length > 0) {
        // Batch export
        const selectedFolios = availableFolios.filter(f => 
          selectedFolioIds.includes(f.id)
        );
        
        // Create lookup functions for batch export
        const guestLookup = (guestId: string) => guests.find(g => g.id === guestId);
        const roomLookup = (roomNumber: string) => rooms.find(r => r.number === roomNumber);
        
        const blobs = await batchExportFolios(selectedFolios, { ...exportOptions, folioIds: selectedFolioIds }, guestLookup, roomLookup);
        
        // In a real implementation, we would zip these files
        // For this demo, we'll just download the first one
        blob = blobs[0];
        
        clearInterval(progressInterval);
        setProgress(100);
        
        // Download the file
        downloadBlob(blob, `batch_folios_${new Date().getTime()}.${exportOptions.format}`);
        
        toast({
          title: "Batch export complete",
          description: `${blobs.length} folios exported successfully.`,
        });
      } else {
        // Single folio export
        // Get guest and room information
        const guest = guests.find(g => g.id === folio.guestId);
        const room = rooms.find(r => r.number === folio.roomNumber);
        
        const meta = exportOptions.includeMetadata ? {
          generatedAt: new Date().toISOString(),
          folioId: folio.id,
          guestName: guest?.name || '',
          roomNumber: folio.roomNumber,
          format: exportOptions.format,
        } : undefined;
        const enriched = { ...exportOptions, metadata: meta };
        switch (exportOptions.format) {
          case 'pdf':
            blob = await generatePDF(
              folio,
              enriched,
              guest?.name,
              room?.type,
              guest?.checkIn ? new Date(guest.checkIn) : undefined,
              guest?.checkOut ? new Date(guest.checkOut) : undefined
            );
            break;
          case 'docx':
            blob = await generateDOCX(
              folio,
              enriched,
              guest?.name,
              room?.type,
              guest?.checkIn ? new Date(guest.checkIn) : undefined,
              guest?.checkOut ? new Date(guest.checkOut) : undefined
            );
            break;
          case 'xlsx':
            blob = await generateXLSX(
              folio,
              enriched,
              guest?.name,
              room?.type,
              guest?.checkIn ? new Date(guest.checkIn) : undefined,
              guest?.checkOut ? new Date(guest.checkOut) : undefined
            );
            break;
          default:
            blob = await generatePDF(
              folio,
              enriched,
              guest?.name,
              room?.type,
              guest?.checkIn ? new Date(guest.checkIn) : undefined,
              guest?.checkOut ? new Date(guest.checkOut) : undefined
            );
        }
        
        clearInterval(progressInterval);
        setProgress(100);
        
        // Download the file
        const guestObj = guests.find(g => g.id === folio.guestId);
        const guestName = (guestObj?.name || 'Guest').replace(/\s+/g, '_');
        downloadBlob(blob, `folio_${guestName}_${new Date().getTime()}.${exportOptions.format}`);
        
        toast({
          title: "Export complete",
          description: `Folio exported as ${exportOptions.format.toUpperCase()} successfully.`,
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export failed",
        description: error instanceof Error 
          ? `Error: ${error.message}` 
          : "There was an error exporting the folio. Please verify file format, permissions, and system resources.",
        variant: "destructive"
      });
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
        setProgress(0);
      }, 1000);
    }
  };
  
  return (
    <div className="p-4 border rounded-lg bg-card">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'print' | 'export')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="print">Print</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        
        <TabsContent value="print" className="space-y-4 mt-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pageRangeStart">Page Range Start</Label>
                <Input
                  id="pageRangeStart"
                  type="number"
                  min={1}
                  value={printOptions.pageRange?.start || 1}
                  onChange={(e) => setPrintOptions({
                    ...printOptions,
                    pageRange: {
                      ...printOptions.pageRange!,
                      start: parseInt(e.target.value)
                    }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pageRangeEnd">Page Range End</Label>
                <Input
                  id="pageRangeEnd"
                  type="number"
                  min={1}
                  value={printOptions.pageRange?.end || 5}
                  onChange={(e) => setPrintOptions({
                    ...printOptions,
                    pageRange: {
                      ...printOptions.pageRange!,
                      end: parseInt(e.target.value)
                    }
                  })}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="printQuality">Print Quality</Label>
              <Select
                value={printOptions.quality}
                onValueChange={(value) => setPrintOptions({
                  ...printOptions,
                  quality: value as PrintQuality
                })}
              >
                <SelectTrigger id="printQuality">
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="colorMode">Color Mode</Label>
              <Select
                value={printOptions.colorMode}
                onValueChange={(value) => setPrintOptions({
                  ...printOptions,
                  colorMode: value as ColorMode
                })}
              >
                <SelectTrigger id="colorMode">
                  <SelectValue placeholder="Select color mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="color">Color</SelectItem>
                  <SelectItem value="grayscale">Grayscale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              onClick={handlePrint} 
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? 'Printing...' : 'Print Folio'}
            </Button>
            <Button 
              variant="outline"
              onClick={() => setShowPrintSettings(true)}
              disabled={isProcessing}
              className="w-full"
            >
              Customize Print
            </Button>
            <Button 
              variant="secondary"
              onClick={openPreview}
              disabled={isProcessing}
              className="w-full"
            >
              Preview Folio
            </Button>
          </div>
        </TabsContent>
        
        <TabsContent value="export" className="space-y-4 mt-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="exportFormat">Export Format</Label>
              <Select
                value={exportOptions.format}
                onValueChange={(value) => setExportOptions({
                  ...exportOptions,
                  format: value as ExportFormat
                })}
              >
                <SelectTrigger id="exportFormat">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="docx">DOCX</SelectItem>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateStart">Start Date</Label>
                <Input
                  id="dateStart"
                  type="date"
                  value={exportOptions.dateRange?.start || ''}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    dateRange: { ...(exportOptions.dateRange || {}), start: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateEnd">End Date</Label>
                <Input
                  id="dateEnd"
                  type="date"
                  value={exportOptions.dateRange?.end || ''}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    dateRange: { ...(exportOptions.dateRange || {}), end: e.target.value }
                  })}
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="applyWatermark"
                checked={exportOptions.applyWatermark}
                onCheckedChange={(checked) => setExportOptions({
                  ...exportOptions,
                  applyWatermark: checked as boolean
                })}
              />
              <Label htmlFor="applyWatermark">Apply Watermark</Label>
            </div>
            
            {exportOptions.applyWatermark && (
              <div className="space-y-2">
                <Label htmlFor="watermarkText">Watermark Text</Label>
                <Input
                  id="watermarkText"
                  value={exportOptions.watermarkText}
                  onChange={(e) => setExportOptions({
                    ...exportOptions,
                    watermarkText: e.target.value
                  })}
                />
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="password">Password Protection</Label>
              <Input
                id="password"
                type="password"
                placeholder="Leave empty for no password"
                value={exportOptions.password || ''}
                onChange={(e) => setExportOptions({
                  ...exportOptions,
                  password: e.target.value
                })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Include Data</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeTransactions"
                  checked={!!exportOptions.includeTransactions}
                  onCheckedChange={(checked) => setExportOptions({
                    ...exportOptions,
                    includeTransactions: checked as boolean
                  })}
                />
                <Label htmlFor="includeTransactions">Transactions</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeTotals"
                  checked={!!exportOptions.includeTotals}
                  onCheckedChange={(checked) => setExportOptions({
                    ...exportOptions,
                    includeTotals: checked as boolean
                  })}
                />
                <Label htmlFor="includeTotals">Totals</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeGuestDetails"
                  checked={!!exportOptions.includeGuestDetails}
                  onCheckedChange={(checked) => setExportOptions({
                    ...exportOptions,
                    includeGuestDetails: checked as boolean
                  })}
                />
                <Label htmlFor="includeGuestDetails">Guest Details</Label>
              </div>
            </div>
            
            {availableFolios.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="batchMode"
                    checked={batchMode}
                    onCheckedChange={(checked) => setBatchMode(checked as boolean)}
                  />
                  <Label htmlFor="batchMode">Batch Export Multiple Folios</Label>
                </div>
                
                {batchMode && (
                  <div className="space-y-4">
                    <div>
                      <Label>Available Folios</Label>
                      <div className="max-h-40 overflow-y-auto space-y-2">
                        {availableFolios.map((f) => {
                          const guest = guests.find(g => g.id === f.guestId);
                          return (
                            <div key={f.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`folio-${f.id}`}
                                checked={selectedFolioIds.includes(f.id)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedFolioIds([...selectedFolioIds, f.id]);
                                  } else {
                                    setSelectedFolioIds(selectedFolioIds.filter(id => id !== f.id));
                                  }
                                }}
                              />
                              <Label htmlFor={`folio-${f.id}`}>
                                {guest?.name || 'Unknown Guest'} - Room {f.roomNumber}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <Button 
              onClick={handleExport} 
              disabled={isProcessing || (batchMode && selectedFolioIds.length === 0)}
              className="w-full"
            >
              {isProcessing ? 'Exporting...' : batchMode ? 'Batch Export Folios' : 'Export Folio'}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      
      {isProcessing && (
        <div className="mt-4 space-y-3">
          <Progress value={progress} className="w-full" />
          <LoadingSpinner label={activeTab === 'print' ? 'Preparing print job…' : 'Generating document…'} size="sm" className="justify-center" />
        </div>
      )}
      {showPreview && (
        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Print Preview</DialogTitle>
            </DialogHeader>
            <div className="border rounded h-[70vh] overflow-auto bg-white">
              <iframe title="print-preview" srcDoc={previewHTML} className="w-full h-full" />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {showPrintSettings && (<PrintCustomizationModal open={showPrintSettings} onClose={() => setShowPrintSettings(false)} />)}
    </div>
  );
};

export default PrintExportPanel;
  const openPreview = () => {
    try {
      const guest = guests.find(g => g.id === folio.guestId);
      const room = rooms.find(r => r.number === folio.roomNumber);
      const content = generateFolioContent(
        folio,
        guest?.name,
        room?.type,
        guest?.checkIn ? new Date(guest.checkIn) : undefined,
        guest?.checkOut ? new Date(guest.checkOut) : undefined
      );
      const html = applySettingsToHTML(`Preview — Folio ${folio.id}`, `<pre style="white-space:pre-wrap">${content.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`);
      setPreviewHTML(html);
      setShowPreview(true);
    } catch (e) {
      toast({ title: 'Preview failed', description: 'Could not generate preview.', variant: 'destructive' });
    }
  };
