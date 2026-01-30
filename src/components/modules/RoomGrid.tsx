import React, { useState, useMemo } from 'react';
import { addDays, format, startOfDay, isSameDay } from 'date-fns';
import { useData } from '@/context/DataContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RoomGridProps {
  onCellClick?: (roomId: string, date: Date) => void;
  startDate?: Date;
}

export const RoomGrid: React.FC<RoomGridProps> = ({ onCellClick, startDate = new Date() }) => {
  const { rooms, reservations } = useData();
  const [viewDays, setViewDays] = useState(14);
  const [currentStartDate, setCurrentStartDate] = useState(startOfDay(startDate));

  const dates = useMemo(() => {
    return Array.from({ length: viewDays }, (_, i) => addDays(currentStartDate, i));
  }, [viewDays, currentStartDate]);

  const gridData = useMemo(() => {
    // Sort rooms by number
    const sortedRooms = [...rooms].sort((a: any, b: any) => 
      a.number.localeCompare(b.number, undefined, { numeric: true })
    );

    return sortedRooms.map((room: any) => {
      const roomRes = reservations.filter((res: any) => 
        (res.room_id === room.id || res.roomId === room.id) &&
        res.status !== 'cancelled' && res.status !== 'checked-out'
      );

      const cells = dates.map(date => {
        const res = roomRes.find((r: any) => {
          const start = startOfDay(new Date(r.check_in_date || r.checkIn));
          const end = startOfDay(new Date(r.check_out_date || r.checkOut));
          // User requirement: date >= check_in AND date < check_out
          if (date >= start && date < end) return true;
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
      case 'occupied': return 'bg-red-500 hover:bg-red-600 text-white';
      case 'booked': return 'bg-blue-500 hover:bg-blue-600 text-white';
      case 'blocked': return 'bg-yellow-500 hover:bg-yellow-600 text-black';
      default: return 'bg-green-50 hover:bg-green-100 cursor-pointer';
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow border">
      <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
        <h3 className="font-semibold text-lg">Room Availability</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, -viewDays))}>Prev</Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(new Date())}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, viewDays))}>Next</Button>
          <Select value={String(viewDays)} onValueChange={(v) => setViewDays(Number(v))}>
            <SelectTrigger className="w-[100px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Days</SelectItem>
              <SelectItem value="14">14 Days</SelectItem>
              <SelectItem value="30">30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto relative">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-white z-20 shadow-sm">
            <tr>
              <th className="p-2 border-b border-r bg-slate-100 min-w-[120px] text-left sticky left-0 z-20">Room</th>
              {dates.map(date => (
                <th key={date.toISOString()} className={`p-2 border-b border-r bg-slate-50 min-w-[60px] text-center text-xs ${isSameDay(date, new Date()) ? 'bg-blue-50 text-blue-700' : ''}`}>
                  <div className="font-bold">{format(date, 'd')}</div>
                  <div className="text-gray-500 font-normal">{format(date, 'EEE')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridData.map(({ room, cells }) => (
              <tr key={room.id} className="hover:bg-slate-50">
                <td className="p-2 border-r border-b font-medium sticky left-0 bg-white z-10 min-w-[120px]">
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-800">{room.number}</span>
                    <span className="text-xs text-gray-500">{room.type}</span>
                  </div>
                </td>
                {cells.map((cell, idx) => (
                  <td 
                    key={idx} 
                    className={`p-1 border-r border-b transition-colors text-xs text-center align-middle ${getCellColor(cell.status)}`}
                    onClick={() => cell.status === 'vacant' && onCellClick?.(room.id, cell.date)}
                    title={cell.res ? `${cell.res.guestName} (${cell.res.status})` : 'Available'}
                  >
                    {cell.res && (
                      <div className="truncate w-full max-w-[50px] px-1">
                        {cell.res.guestName.split(' ')[0]}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="p-2 border-t bg-gray-50 text-xs flex gap-4 rounded-b-lg">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-50 border"></div> Vacant</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Booked</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-red-500 rounded-sm"></div> Occupied</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-yellow-500 rounded-sm"></div> Blocked</div>
      </div>
    </div>
  );
};
