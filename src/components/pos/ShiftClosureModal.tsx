import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useShift } from '@/contexts/ShiftContext';
import { formatCurrency } from '@/lib/posIntegration';
import { ShiftReading } from '@/types';

interface ShiftClosureModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (zReading: ShiftReading) => void;
}

export const ShiftClosureModal: React.FC<ShiftClosureModalProps> = ({
  open,
  onClose,
  onSuccess
}) => {
  const { activeShift, endShift, getTotals } = useShift();
  const [closingCash, setClosingCash] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const totals = getTotals();
  const openingCashNum = Number(activeShift ? activeShift.openingCash : 0);
  const totalsCashNum = Number(totals?.cash ?? 0);
  const expectedCash = openingCashNum + totalsCashNum;
  const cashDifference = closingCash ? Number(closingCash) - expectedCash : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;

    setIsProcessing(true);
    setError('');
    setSuccess('');

    try {
      const result = await endShift(parseFloat(closingCash) || expectedCash);
      
      if (result.success) {
        if (result.error) {
          // Shift closed but printing failed
          setSuccess(`Shift closed successfully! ${result.error}`);
        } else {
          setSuccess('Shift closed successfully and Z reading printed!');
        }
        
        if (result.zReading && onSuccess) {
          onSuccess(result.zReading);
        }
        
        // Auto-close modal after success
        setTimeout(() => {
          onClose();
          resetForm();
        }, 2000);
      } else {
        setError(result.error || 'Failed to close shift');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setClosingCash('');
    setNotes('');
    setError('');
    setSuccess('');
  };

  const handleClose = () => {
    if (!isProcessing) {
      onClose();
      resetForm();
    }
  };

  if (!activeShift) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close Shift & Generate Z Reading</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Shift Summary */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <h4 className="font-semibold text-sm">Shift Summary</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Opening Cash:</div>
              <div className="font-medium">{formatCurrency(activeShift.openingCash)}</div>
              <div>Cash Sales:</div>
              <div className="font-medium">{formatCurrency(totals.cash)}</div>
              <div>Card Sales:</div>
              <div className="font-medium">{formatCurrency(totals.card)}</div>
              <div>Room Charges:</div>
              <div className="font-medium">{formatCurrency(totals.roomCharge)}</div>
              <div>Total Transactions:</div>
              <div className="font-medium">{totals.count}</div>
              {totals.voidedCount > 0 && (
                <>
                  <div>Voided Transactions:</div>
                  <div className="font-medium text-red-600">
                    {totals.voidedCount} ({formatCurrency(totals.voidedAmount)})
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Cash Reconciliation */}
          <div className="border-2 border-blue-200 p-4 rounded-lg space-y-3">
            <h4 className="font-semibold text-sm text-blue-800">Cash Reconciliation</h4>
            
            <div className="space-y-2">
              <Label htmlFor="closingCash">Closing Cash Count *</Label>
              <Input
                id="closingCash"
                type="number"
                step="0.01"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                placeholder={Number.isFinite(expectedCash) ? expectedCash.toFixed(2) : ''}
                required
                disabled={isProcessing}
              />
              <div className="text-xs text-gray-600">
                Expected: {formatCurrency(expectedCash)}
              </div>
            </div>

            {closingCash && (
              <div className={`p-2 rounded text-sm ${
                cashDifference === 0 
                  ? 'bg-green-50 text-green-800' 
                  : cashDifference > 0 
                    ? 'bg-blue-50 text-blue-800' 
                    : 'bg-red-50 text-red-800'
              }`}>
                <div className="font-medium">
                  Difference: {formatCurrency(Math.abs(cashDifference))} 
                  {cashDifference > 0 ? ' Over' : cashDifference < 0 ? ' Short' : ' Balanced'}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about the shift..."
              rows={3}
              disabled={isProcessing}
            />
          </div>

          {/* Alerts */}
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50">
              <AlertDescription className="text-green-800">{success}</AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isProcessing || !closingCash}
              className="flex-1"
            >
              {isProcessing ? 'Processing...' : 'Close Shift & Print Z Reading'}
            </Button>
          </div>

          {/* Info */}
          <div className="text-xs text-gray-500 text-center">
            This will automatically generate and print a Z reading cash-up slip
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
