import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useData } from '@/context/DataContext';
import { transferService } from '@/lib/transferService';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface TransferRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
    reservationId: string | null;
    currentRoomId: string | null;
    onSuccess: () => void;
}

export const TransferRoomModal: React.FC<TransferRoomModalProps> = ({
    isOpen,
    onClose,
    reservationId,
    currentRoomId,
    onSuccess
}) => {
    const { rooms } = useData();
    const [targetRoomId, setTargetRoomId] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [markOldAsOOO, setMarkOldAsOOO] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // Filter available rooms (Vacant Clean or Vacant Dirty)
    // Also exclude current room
    const availableRooms = React.useMemo(() => {
        if (!rooms) return [];
        return rooms
            .filter((r: any) => r.id !== currentRoomId && ['VC', 'VD'].includes(r.status))
            .sort((a: any, b: any) => a.number.localeCompare(b.number));
    }, [rooms, currentRoomId]);

    useEffect(() => {
        if (isOpen) {
            setTargetRoomId('');
            setReason('');
            setMarkOldAsOOO(false);
            setError(null);
        }
    }, [isOpen]);

    const handleTransfer = async () => {
        if (!reservationId) return;
        if (!targetRoomId) {
            setError('Please select a target room');
            return;
        }
        if (!reason.trim()) {
            setError('Please provide a reason for the transfer');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const result = await transferService.transferGuest(
                reservationId,
                targetRoomId,
                reason,
                markOldAsOOO
            );

            if (result.ok) {
                toast.success('Guest transferred successfully');
                onSuccess();
                onClose();
            } else {
                setError(result.error || 'Transfer failed');
            }
        } catch (e: any) {
            setError(e.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const currentRoom = rooms?.find((r: any) => r.id === currentRoomId);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isLoading && !open && onClose()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Transfer Guest Room</DialogTitle>
                    <DialogDescription>
                        Move guest from Room {currentRoom?.number || 'Unknown'} to another vacant room.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    <div className="grid gap-2">
                        <Label htmlFor="target-room">New Room</Label>
                        <Select value={targetRoomId} onValueChange={setTargetRoomId}>
                            <SelectTrigger id="target-room">
                                <SelectValue placeholder="Select available room" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableRooms.map((room: any) => (
                                    <SelectItem key={room.id} value={room.id}>
                                        Room {room.number} ({room.type}) - {room.status}
                                    </SelectItem>
                                ))}
                                {availableRooms.length === 0 && (
                                    <div className="p-2 text-sm text-gray-500 text-center">No vacant rooms available</div>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="reason">Reason for Transfer</Label>
                        <Textarea
                            id="reason"
                            placeholder="e.g. Guest request, AC breakdown, Upgrade..."
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="ooo"
                            checked={markOldAsOOO}
                            onCheckedChange={(c) => setMarkOldAsOOO(c === true)}
                        />
                        <Label htmlFor="ooo" className="text-sm font-normal cursor-pointer">
                            Mark old room as Out of Order (OOO)
                        </Label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleTransfer} disabled={isLoading}>
                        {isLoading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Transferring...
                            </>
                        ) : (
                            'Confirm Transfer'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
