import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ShiftReading } from '../../types';

interface ShiftReportModalProps {
  open: boolean;
  onClose: () => void;
  reading: ShiftReading | null;
}

export const ShiftReportModal: React.FC<ShiftReportModalProps> = ({ open, onClose, reading }) => {
  if (!reading) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {reading.reading_type} Reading #{reading.reading_number}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded">
              <div className="text-sm text-gray-600">Total Sales</div>
              <div className="text-2xl font-bold">${Number(reading.total_sales || 0).toFixed(2)}</div>
            </div>
            <div className="bg-green-50 p-4 rounded">
              <div className="text-sm text-gray-600">Transactions</div>
              <div className="text-2xl font-bold">{reading.total_transactions}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border p-3 rounded">
              <div className="text-sm font-medium">Bar Sales</div>
              <div className="text-xl">${reading.bar_sales.toFixed(2)}</div>
            </div>
            <div className="border p-3 rounded">
              <div className="text-sm font-medium">Restaurant Sales</div>
              <div className="text-xl">${reading.restaurant_sales.toFixed(2)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border p-3 rounded">
              <div className="text-sm font-medium">Cash Payments</div>
              <div className="text-xl">${reading.cash_payments.toFixed(2)}</div>
            </div>
            <div className="border p-3 rounded">
              <div className="text-sm font-medium">Card Payments</div>
              <div className="text-xl">${reading.card_payments.toFixed(2)}</div>
            </div>
          </div>

          {reading.reading_type === 'Z' && reading.report_data && (
            <div className="border-t pt-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-yellow-50 p-3 rounded">
                  <div className="text-sm">Expected Cash</div>
                  <div className="font-bold">${Number.isFinite(Number(reading.report_data.expectedCash)) ? Number(reading.report_data.expectedCash).toFixed(2) : '0.00'}</div>
                </div>
                <div className="bg-blue-50 p-3 rounded">
                  <div className="text-sm">Closing Cash</div>
                  <div className="font-bold">${Number.isFinite(Number(reading.report_data.closingCash)) ? Number(reading.report_data.closingCash).toFixed(2) : '0.00'}</div>
                </div>
                <div className={`p-3 rounded ${(Number(reading.report_data.cashDifference) || 0) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="text-sm">Difference</div>
                  <div className="font-bold">${Number.isFinite(Number(reading.report_data.cashDifference)) ? Number(reading.report_data.cashDifference).toFixed(2) : '0.00'}</div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
