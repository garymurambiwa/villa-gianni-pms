import React, { useState, useEffect } from 'react';
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
    const [idNumber, setIdNumber] = useState('');
    const [roomId, setRoomId] = useState('');
    const [nights, setNights] = useState('1');
    const [adults, setAdults] = useState('1');
    const [rate, setRate] = useState('');
    const [packageCode, setPackageCode] = useState('RO');
    const [loading, setLoading] = useState(false);
    const [checkInDate, setCheckInDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [checkOutDate, setCheckOutDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));

    // Already-occupied room IDs (guard against double check-in)
    const reservations = Array.isArray(ctx?.reservations) ? ctx.reservations : [];
    const occupiedRoomIds = new Set(
        reservations
            .filter((r: any) => r.status === 'checked-in' || r.status === 'occupied')
            .map((r: any) => r.room_id || r.roomId)
            .filter(Boolean)
    );

    // Available rooms: VC (clean) + VD (dirty — needs housekeeping but is vacant)
    // Mirrors FrontOffice logic. OOO/OOS excluded. Already-occupied excluded.
    const availableRooms = rooms.filter((r: any) => {
        const s = String(r.status || '').toUpperCase();
        const isVacant = s === 'VC' || s === 'VD' || s === 'VACANT' || s === 'AVAILABLE';
        const isBlocked = s === 'OOO' || s === 'OOS';
        return isVacant && !isBlocked && !occupiedRoomIds.has(r.id);
    });

    // Whenever the modal opens, check for pre-selected room from Room Availability Grid
    React.useEffect(() => {
        if (isOpen) {
            const preSelectedRoomId = (window as any).__quickCheckInRoomId;
            const preSelectedRoomNumber = (window as any).__quickCheckInRoomNumber;
            if (preSelectedRoomId) {
                setRoomId(preSelectedRoomId);
                const room = rooms.find(r => r.id === preSelectedRoomId);
                if (room) {
                    setRate(String(room.rate || '0'));
                }
                // Clear the global selection after using it
                (window as any).__quickCheckInRoomId = undefined;
                (window as any).__quickCheckInRoomNumber = undefined;
            }
        }
    }, [isOpen, rooms]);

    // Update check-out date when check-in date or nights change
    useEffect(() => {
        if (checkInDate && nights) {
            const checkIn = new Date(checkInDate);
            const nightsNum = parseInt(nights) || 1;
            setCheckOutDate(format(addDays(checkIn, nightsNum), 'yyyy-MM-dd'));
        }
    }, [checkInDate, nights]);

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
        if (!guestName || !roomId || !nights) {
            toast.error('Guest name and room are required.');
            return;
        }
        // Guard: block double check-in to an occupied room
        if (occupiedRoomIds.has(roomId)) {
            const room = rooms.find((r: any) => r.id === roomId);
            toast.error(`Room ${room?.number || roomId} already has a checked-in guest. Please select another room.`);
            return;
        }

        setLoading(true);

        try {
            const selectedRoom = rooms.find((r: any) => r.id === roomId);
            // Sanitize rate — fall back to room rate if user-entered rate is empty/invalid
            const parsedRate = parseFloat(rate);
            const effectiveRate = isFinite(parsedRate) && parsedRate > 0
                ? parsedRate
                : Number(selectedRoom?.rate) || 0;

            console.log('[QuickCheckIn] Calling createReservation with rate:', effectiveRate);

            const resResult = await createReservation({
                guestName,
                phone: phoneNumber,
                email,
                idNumber,
                roomId,
                checkIn: checkInDate,
                checkOut: checkOutDate,
                rate: effectiveRate,
                packageCode,
                adults: parseInt(adults) || 1,
                children: 0,
                roomType: selectedRoom?.type || 'Standard',
                status: 'confirmed'
            });

            if (!resResult.success) {
                throw new Error(resResult.error || 'Failed to create reservation');
            }

            console.log('[QuickCheckIn] createReservation successful, reservationId:', resResult.reservationId);

            // Attempt to check them in immediately if we got the reservation ID back.
            if (resResult.reservationId) {
                const checkInOk = await checkInGuest(resResult.reservationId, roomId, {
                    rateOverride: effectiveRate,
                    packageCode
                });
                if (checkInOk === false) {
                    throw new Error('Reservation created but check-in step failed. See console for details.');
                }
                toast.success(`Walk-in guest ${guestName} checked in successfully!`);
            } else {
                toast.success(`Walk-in guest ${guestName} reservation created (Check-In manual step required).`);
            }

            // Reset form
            setGuestName('');
            setPhoneNumber('');
            setEmail('');
            setIdNumber('');
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <div className="space-y-2">
                            <Label htmlFor="idNumber">Passport / ID Number</Label>
                            <Input
                                id="idNumber"
                                value={idNumber}
                                onChange={(e) => setIdNumber(e.target.value)}
                                placeholder="Required for Check-in"
                            />
                        </div>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                        <div className="space-y-2">
                            <Label htmlFor="checkInDate">Check-In Date <span className="text-red-500">*</span></Label>
                            <Input
                                id="checkInDate"
                                type="date"
                                value={checkInDate}
                                onChange={(e) => setCheckInDate(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="checkOutDate">Check-Out Date <span className="text-red-500">*</span></Label>
                            <Input
                                id="checkOutDate"
                                type="date"
                                value={checkOutDate}
                                onChange={(e) => setCheckOutDate(e.target.value)}
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
