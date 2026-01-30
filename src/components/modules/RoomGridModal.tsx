import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, format, startOfDay, isWithinInterval, isSameDay } from 'date-fns';
import { useData } from '@/context/DataContext';

interface RoomGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRoom: (roomId: string) => void;
  startDate?: Date;
}

export const RoomGridModal: React.FC<RoomGridModalProps> = ({ isOpen, onClose, onSelectRoom, startDate = new Date() }) => {
  const { rooms, reservations } = useData();
  const [viewDays, setViewDays] = useState(7);
  const [currentStartDate, setCurrentStartDate] = useState(startOfDay(startDate));

  const dates = useMemo(() => {
    return Array.from({ length: viewDays }, (_, i) => addDays(currentStartDate, i));
  }, [viewDays, currentStartDate]);

  const gridData = useMemo(() => {
    return rooms.map((room: any) => {
      // Find reservations for this room that are active
      const roomRes = reservations.filter((res: any) => 
        (res.room_id === room.id || res.roomId === room.id) &&
        res.status !== 'cancelled' && res.status !== 'checked-out'
      );

      const cells = dates.map(date => {
        const res = roomRes.find((r: any) => {
          const start = startOfDay(new Date(r.check_in_date || r.checkIn));
          const end = startOfDay(new Date(r.check_out_date || r.checkOut));
          // Reservation includes check-in day, excludes check-out day for occupancy logic usually
          // But "Tape Chart" usually shows the block visually.
          // Let's assume inclusive start, exclusive end for availability.
          if (isSameDay(date, start)) return true;
          if (date > start && date < end) return true;
          return false;
        });
        
        let status = 'vacant';
        if (res) {
          if (res.status === 'checked-in' || res.status === 'occupied') status = 'occupied';
          else if (res.status === 'blocked') status = 'blocked';
          else status = 'booked';
        }
        return { date, status, res };
      });

      return { room, cells };
    });
  }, [rooms, reservations, dates]);

  const getCellColor = (status: string) => {
    switch (status) {
      case 'occupied': return 'bg-red-500 hover:bg-red-600';
      case 'booked': return 'bg-blue-500 hover:bg-blue-600';
      case 'blocked': return 'bg-yellow-500 hover:bg-yellow-600';
      default: return 'bg-green-100 hover:bg-green-200 cursor-pointer';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] h-[90vh] flex flex-col p-4">
        <DialogHeader className="mb-4">
          <DialogTitle>Room Availability Grid</DialogTitle>
          <div className="flex gap-2 mt-2 items-center">
            <Select value={String(viewDays)} onValueChange={(v) => setViewDays(Number(v))}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="View" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 Days</SelectItem>
                <SelectItem value="30">30 Days</SelectItem>
                <SelectItem value="90">90 Days</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 ml-4">
              <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, -viewDays))}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(new Date())}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, viewDays))}>Next</Button>
            </div>
            <div className="flex gap-4 ml-auto text-sm">
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-100 border"></div> Vacant</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 border"></div> Booked</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 border"></div> Occupied</div>
              <div className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-500 border"></div> Blocked</div>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto border rounded-md relative">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white z-20 shadow-sm">
              <tr>
                <th className="p-2 border-b bg-slate-100 min-w-[150px] text-left sticky left-0 z-20">Room</th>
                {dates.map(date => (
                  <th key={date.toISOString()} className={`p-2 border-b border-r bg-slate-50 min-w-[60px] text-center text-xs ${isSameDay(date, new Date()) ? 'bg-blue-50' : ''}`}>
                    <div className="font-semibold">{format(date, 'd')}</div>
                    <div className="text-slate-500">{format(date, 'EEE')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridData.map(({ room, cells }) => (
                <tr key={room.id} className="hover:bg-slate-50">
                  <td className="p-2 border-r border-b font-medium sticky left-0 bg-white z-10 min-w-[150px]">
                    <div className="flex flex-col">
                      <span>{room.number}</span>
                      <span className="text-xs text-muted-foreground">{room.type}</span>
                    </div>
                  </td>
                  {cells.map((cell, idx) => (
                    <td 
                      key={idx} 
                      className={`p-1 border-r border-b transition-colors ${getCellColor(cell.status)}`}
                      onClick={() => cell.status === 'vacant' && onSelectRoom(room.id)}
                      title={cell.res ? `${cell.res.guestName} (${cell.res.status})` : 'Available - Click to Select'}
                    >
                      {/* Optional: Add content inside cell if needed */}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
};
