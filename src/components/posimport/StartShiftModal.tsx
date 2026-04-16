import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { useShift } from '../../contexts/ShiftContext';
import { useAuth } from '../../context/AuthContext';

interface StartShiftModalProps {
  open: boolean;
  onClose: () => void;
}

export const StartShiftModal: React.FC<StartShiftModalProps> = ({ open, onClose }) => {
  const [openingCash, setOpeningCash] = useState('0');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const { startShift } = useShift();
  const { user, costCentre } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if user is authenticated
    if (!user || !user.id) {
      alert('Please log in to start a shift.');
      return;
    }

    setLoading(true);
    try {
      await startShift(parseFloat(openingCash), notes, user.id, costCentre || undefined);
      onClose();
      setOpeningCash('0');
      setNotes('');
    } catch (error) {
      alert('Failed to start shift: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start New Shift</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="openingCash">Opening Cash Amount</Label>
            <Input
              id="openingCash"
              type="number"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              className="transition-all duration-200 hover:shadow-md"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="transition-all duration-200 hover:shadow-md disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Start Shift'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};