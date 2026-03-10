import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';

interface QuickCheckInModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const QuickCheckInModal: React.FC<QuickCheckInModalProps> = ({ isOpen, onClose }) => {
    const ctx = useData() as any;
    const rooms = Array.isArray(ctx?.rooms) ? ctx.rooms : [];
    const createReservation = typeof ctx?.createReservation === 'function' ? ctx.createReservation : async () => ({ success: false, error: 'Not available' });
    const checkInGuest = typeof ctx?.checkInGuest === 'function' ? ctx.checkInGuest : async () => { };

    const [guestName, setGuestName] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [roomId, setRoomId] = useState('');
    const [nights, setNights] = useState('1');
    const [adults, setAdults] = useState('1');
    const [rate, setRate] = useState('');
    const [packageCode, setPackageCode] = useState('RO');
    const [loading, setLoading] = useState(false);

    // Filter for available rooms
    const availableRooms = rooms.filter(r => {
        const s = String(r.status || '').toLowerCase();
        return s === 'available' || s === 'vacant' || String(r.status).toUpperCase() === 'VC';
    });

    // Whenever a room is selected, update the rate to the room's default rate if empty
    const handleRoomChange = (val: string) => {
        setRoomId(val);
        const room = rooms.find(r => r.id === val);
        if (room && !rate) {
            setRate(String(room.rate || '0'));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!guestName || !roomId || !nights || !rate) {
            toast.error('Please fill in all required fields (Name, Room, Nights, Rate).');
            return;
        }

        setLoading(true);

        try {
            const today = new Date();
            const checkInDate = format(today, 'yyyy-MM-dd');
            const checkOutDate = format(addDays(today, parseInt(nights)), 'yyyy-MM-dd');

            const selectedRoom = rooms.find(r => r.id === roomId);

            console.log('[QuickCheckIn] Calling createReservation...');

            const resResult = await createReservation({
                guestName,
                phone: phoneNumber,
                email,
                roomId,
                checkIn: checkInDate,
                checkOut: checkOutDate,
                rate: parseFloat(rate),
                packageCode,
                adults: parseInt(adults),
                children: 0,
                roomType: selectedRoom?.type || 'Standard',
                status: 'confirmed'
            });

            if (!resResult.success) {
                throw new Error(resResult.error || 'Failed to create reservation');
            }

            console.log('[QuickCheckIn] createReservation successful, generating check-in...');

            // Attempt to check them in immediately if we got the reservation ID back.
            if (resResult.reservationId) {
                await checkInGuest(resResult.reservationId, roomId, {
                    rateOverride: parseFloat(rate),
                    packageCode
                });
                toast.success(`Walk-in guest ${guestName} checked in successfully!`);
            } else {
                toast.success(`Walk-in guest ${guestName} reservation created (Check-In manual step required).`);
            }

            // Reset form
            setGuestName('');
            setPhoneNumber('');
            setEmail('');
            setRoomId('');
            setNights('1');
            setAdults('1');
            setRate('');
            setPackageCode('RO');
            onClose();

        } catch (err: any) {
            console.error('[QuickCheckIn] Error:', err);
            toast.error(err.message || 'Failed to complete quick check-in');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Quick Check-In (Walk-In)</DialogTitle>
                    <DialogDescription>
                        Instantly create a reservation and check the guest in simultaneously.
                    </DialogDescription>
                </DialogHeader>

                <form id="quick-checkin-form" onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="guestName">Guest Name <span className="text-red-500">*</span></Label>
                            <Input
                                id="guestName"
                                value={guestName}
                                onChange={(e) => setGuestName(e.target.value)}
                                placeholder="e.g. John Doe"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phoneNumber">Phone Number</Label>
                            <Input
                                id="phoneNumber"
                                value={phoneNumber}
                                onChange={(e) => setPhoneNumber(e.target.value)}
                                placeholder="Optional"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Optional"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Room Assignment <span className="text-red-500">*</span></Label>
                            <Select value={roomId} onValueChange={handleRoomChange}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select available room..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableRooms.length === 0 ? (
                                        <SelectItem value="none" disabled>No rooms available</SelectItem>
                                    ) : (
                                        availableRooms.map(r => (
                                            <SelectItem key={r.id} value={r.id}>
                                                Room {r.number} ({r.type}) - ${r.rate}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="nights">Nights <span className="text-red-500">*</span></Label>
                            <Input
                                id="nights"
                                type="number"
                                min="1"
                                value={nights}
                                onChange={(e) => setNights(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t pt-4">
                        <div className="space-y-2">
                            <Label htmlFor="adults">Adults</Label>
                            <Input
                                id="adults"
                                type="number"
                                min="1"
                                value={adults}
                                onChange={(e) => setAdults(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="rate">Daily Rate ($) <span className="text-red-500">*</span></Label>
                            <Input
                                id="rate"
                                type="number"
                                min="0"
                                step="0.01"
                                value={rate}
                                onChange={(e) => setRate(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Package</Label>
                            <Select value={packageCode} onValueChange={setPackageCode}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="RO">Room Only (RO)</SelectItem>
                                    <SelectItem value="BB">Bed & Breakfast (BB)</SelectItem>
                                    <SelectItem value="DBB">Dinner, B&B (DBB)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </form>

                <DialogFooter className="mt-4 border-t pt-4">
                    <Button variant="outline" onClick={onClose} disabled={loading} type="button">Cancel</Button>
                    <Button type="submit" form="quick-checkin-form" disabled={loading || !roomId}>
                        {loading ? 'Checking in...' : 'Complete Quick Check-In'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
