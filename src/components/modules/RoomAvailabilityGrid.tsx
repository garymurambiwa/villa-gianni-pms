import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { addDays, format, startOfDay, isSameDay } from 'date-fns';
import { RefreshCw, AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/lib/db';

export const RoomAvailabilityGrid: React.FC = () => {
  const { rooms, reservations, guests, loadAllData } = useData() as any;
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [showFixPanel, setShowFixPanel] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixLog, setFixLog] = useState<string[]>([]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (typeof loadAllData === 'function') await loadAllData();
      toast({ title: 'Refreshed', description: 'Room availability updated from database.' });
    } catch { /* non-fatal */ } finally {
      setRefreshing(false);
    }
  }, [loadAllData, toast]);

  /**
   * Force-check-in all confirmed reservations whose check-in date is on or before
   * today. Optionally restrict to a specific list of room numbers.
   */
  const handleForceCheckIn = useCallback(async (roomNumbers?: string[]) => {
    setFixing(true);
    setFixLog([]);
    const log: string[] = [];
    const today = new Date().toISOString().slice(0, 10);

    try {
      // Fetch overdue confirmed reservations from DB
      const res = await db.query<any>(
        `SELECT r.id as res_id, r.room_id, r.check_in_date, r.guest_id,
                g.full_name as guest_name, ro.number as room_number, ro.type as room_type
         FROM reservations r
         LEFT JOIN guests g ON g.id = r.guest_id
         LEFT JOIN rooms  ro ON ro.id = r.room_id
         WHERE r.status = 'confirmed'
           AND r.check_in_date::date <= $1::date
           AND r.room_id IS NOT NULL`,
        [today]
      );

      if (!('rows' in res) || res.rows.length === 0) {
        log.push('No overdue confirmed reservations found.');
        setFixLog(log);
        setFixing(false);
        return;
      }

      // Filter by room numbers if specified
      const targets = roomNumbers && roomNumbers.length > 0
        ? res.rows.filter((r: any) => roomNumbers.includes(String(r.room_number)))
        : res.rows;

      if (targets.length === 0) {
        log.push(`No confirmed reservations found for rooms: ${roomNumbers?.join(', ')}.`);
        setFixLog(log);
        setFixing(false);
        return;
      }

      log.push(`Found ${targets.length} reservation(s) to fix…`);
      setFixLog([...log]);

      let successCount = 0;
      let failCount    = 0;

      for (const row of targets) {
        try {
          const txResult = await db.transaction([
            {
              sql: `UPDATE reservations
                    SET status = 'checked-in'
                    WHERE id = $1 AND status = 'confirmed'`,
              params: [row.res_id]
            },
            {
              sql: `UPDATE rooms
                    SET status = 'OC', updated_at = NOW()
                    WHERE id = $1`,
              params: [row.room_id]
            },
            {
              // Ensure folio exists
              sql: `INSERT INTO folios
                          (id, guest_id, reservation_id, room_number, status, balance,
                           package_code, created_by, inserted_at, updated_at)
                    SELECT gen_random_uuid()::text,
                           r.guest_id, r.id, ro.number,
                           'open', 0,
                           COALESCE(r.package_code, 'RO'),
                           'auto_fix',
                           NOW(), NOW()
                    FROM reservations r
                    JOIN rooms ro ON ro.id = r.room_id
                    WHERE r.id = $1
                    ON CONFLICT (reservation_id) DO UPDATE
                      SET status = 'open', updated_at = NOW()`,
              params: [row.res_id]
            }
          ]);

          if ((txResult as any).ok) {
            log.push(`✅ Room ${row.room_number} — ${row.guest_name}: confirmed → checked-in`);
            successCount++;
          } else {
            log.push(`❌ Room ${row.room_number} — ${row.guest_name}: FAILED — ${(txResult as any).error}`);
            failCount++;
          }
        } catch (err: any) {
          log.push(`❌ Room ${row.room_number} — ${row.guest_name}: ERROR — ${err?.message || err}`);
          failCount++;
        }
        setFixLog([...log]);
      }

      log.push(`Done. ${successCount} fixed, ${failCount} failed.`);
      setFixLog([...log]);

      if (successCount > 0) {
        toast({
          title: `${successCount} Reservation(s) Fixed`,
          description: 'Guests have been moved from Confirmed → Checked-In.',
        });
        if (typeof loadAllData === 'function') await loadAllData();
      }
    } catch (err: any) {
      log.push(`Fatal error: ${err?.message || err}`);
      setFixLog([...log]);
      toast({ title: 'Fix Failed', description: String(err?.message || err), variant: 'destructive' });
    } finally {
      setFixing(false);
    }
  }, [loadAllData, toast]);

  // Count of overdue confirmed reservations (for badge)
  const overdueConfirmedCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return reservations.filter((r: any) => {
      const ci = String(r.checkIn || r.check_in_date || '').slice(0, 10);
      return r.status === 'confirmed' && ci && ci <= today && (r.room_id || r.roomId);
    }).length;
  }, [reservations]);
  const [viewDays, setViewDays] = useState(() => {
    const saved = sessionStorage.getItem('availability_grid_viewDays');
    return saved ? Number(saved) : 30;
  });
  const [currentStartDate, setCurrentStartDate] = useState(() => {
    const saved = sessionStorage.getItem('availability_grid_startDate');
    return saved ? new Date(saved) : startOfDay(new Date());
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Persistence logic
  useEffect(() => {
    sessionStorage.setItem('availability_grid_viewDays', String(viewDays));
    sessionStorage.setItem('availability_grid_startDate', currentStartDate.toISOString());
  }, [viewDays, currentStartDate]);

  useEffect(() => {
    const savedScroll = sessionStorage.getItem('availability_grid_scrollLeft');
    if (savedScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = Number(savedScroll);
    }

    const handleScroll = () => {
      if (scrollContainerRef.current) {
        sessionStorage.setItem('availability_grid_scrollLeft', String(scrollContainerRef.current.scrollLeft));
      }
    };

    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  const dates = useMemo(() => {
    return Array.from({ length: viewDays }, (_, i) => addDays(currentStartDate, i));
  }, [viewDays, currentStartDate]);

  const gridData = useMemo(() => {
    const sortedRooms = [...rooms].sort((a: any, b: any) => 
      a.number.localeCompare(b.number, undefined, { numeric: true })
    );

    return sortedRooms.map((room: any) => {
      // FIX: filter by room_id OR roomId (handles both snake_case from DB and camelCase)
      const roomRes = reservations.filter((res: any) => {
        const linkedRoomId = res.room_id || res.roomId;
        return linkedRoomId === room.id &&
          res.status !== 'cancelled' &&
          res.status !== 'checked-out';
      });

      const cells = dates.map(date => {
        const res = roomRes.find((r: any) => {
          const rawStart = r.checkIn || r.check_in_date || r.check_in;
          const rawEnd   = r.checkOut || r.check_out_date || r.check_out;
          if (!rawStart || !rawEnd) return false;
          const start = startOfDay(new Date(rawStart));
          const end   = startOfDay(new Date(rawEnd));
          return date >= start && date < end;
        });

        let status = 'vacant';
        if (res) {
          if (res.status === 'checked-in' || res.status === 'occupied') status = 'occupied';
          else if (res.status === 'blocked') status = 'blocked';
          else status = 'booked';
        }

        // Also cross-check the room's physical status for today
        // If room.status shows OOO/maintenance even with no reservation, show that
        const todayDate = startOfDay(new Date());
        if (isSameDay(date, todayDate) && !res) {
          const rs = String(room.status || '').toUpperCase();
          if (rs === 'OOO' || rs === 'OOS') status = 'blocked';
          else if (rs === 'OC' || rs === 'OD') status = 'occupied'; // Physically occupied even without linked reservation
        }

        return { date, status, res };
      });

      return { room, cells };
    });
  }, [rooms, reservations, dates]);

  const handleCellClick = (cell: any, room: any) => {
    if (cell.status === 'vacant') {
      // Logic for new reservation from grid if needed, otherwise ignore or toast
      toast({ title: "Vacant Room", description: `Room ${room.number} is available on ${format(cell.date, 'MMM dd')}.` });
      return;
    }

    if (cell.res) {
      const res = cell.res;
      if (res.status === 'checked-in') {
        // Navigate to Folio Management
        sessionStorage.setItem('folio_guestId', res.guestId || res.guest_id);
        const event = new CustomEvent('navigateToModule', { detail: { module: 'frontoffice' } });
        window.dispatchEvent(event);
      } else {
        // Navigate to Reservations edit mode
        sessionStorage.setItem('reservationEditId', res.id);
        const event = new CustomEvent('navigateToModule', { detail: { module: 'reservations' } });
        window.dispatchEvent(event);
      }
    }
  };

  const getCellColor = (status: string) => {
    switch (status) {
      case 'occupied': return 'bg-red-500 hover:bg-red-600 text-white cursor-pointer';
      case 'booked': return 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer';
      case 'blocked': return 'bg-yellow-500 hover:bg-yellow-600 text-black cursor-pointer';
      default: return 'bg-green-50 hover:bg-green-100 cursor-default';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-white rounded-xl shadow-xl border overflow-hidden m-4">
      {/* Header */}
      <div className="p-4 border-b flex justify-between items-center bg-gray-50/80 backdrop-blur-sm">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-800">Room Availability Grid</h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh room data from database"
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {/* Admin fix button — shown when there are overdue confirmed bookings */}
            <button
              onClick={() => setShowFixPanel(v => !v)}
              title="Fix overdue confirmed check-ins"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                overdueConfirmedCount > 0
                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              <Wrench size={13} />
              Fix Check-Ins
              {overdueConfirmedCount > 0 && (
                <span className="ml-1 bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                  {overdueConfirmedCount}
                </span>
              )}
            </button>
          </div>
          <p className="text-sm text-gray-500">Interactive tape chart for room management</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white border rounded-lg shadow-sm">
            <Button variant="ghost" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, -7))} className="px-3 border-r rounded-r-none">
              &larr; 7d
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCurrentStartDate(new Date())} className="px-4">
              Today
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCurrentStartDate(addDays(currentStartDate, 7))} className="px-3 border-l rounded-l-none">
              7d &rarr;
            </Button>
          </div>
          
          <Select value={String(viewDays)} onValueChange={(v) => setViewDays(Number(v))}>
            <SelectTrigger className="w-[120px] bg-white">
              <SelectValue placeholder="View Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="14">14 Days</SelectItem>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="60">60 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Admin Fix Panel ────────────────────────────────────────────── */}
      {showFixPanel && (
        <div className="border-b bg-amber-50/80 px-4 py-3 text-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800 mb-1">
                Auto Check-In Fix — Overdue Confirmed Reservations
              </p>
              <p className="text-gray-600 text-xs mb-3">
                The buttons below will update the status of confirmed reservations whose
                check-in date has already passed to <strong>Checked-In</strong> and mark
                the room as <strong>OC (Occupied Clean)</strong>.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                <Button
                  size="sm"
                  disabled={fixing}
                  onClick={() => handleForceCheckIn(['101', '103', '109', '110', '112'])}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
                >
                  {fixing ? 'Fixing…' : 'Fix Rooms 101, 103, 109, 110, 112'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={fixing}
                  onClick={() => handleForceCheckIn()}
                  className="text-xs h-8 border-amber-400 text-amber-700 hover:bg-amber-100"
                >
                  Fix ALL Overdue Confirmed ({overdueConfirmedCount})
                </Button>
              </div>
              {fixLog.length > 0 && (
                <div className="bg-white border rounded p-2 max-h-36 overflow-y-auto font-mono text-xs space-y-0.5">
                  {fixLog.map((line, i) => (
                    <div key={i} className={line.startsWith('✅') ? 'text-green-700' : line.startsWith('❌') ? 'text-red-700' : 'text-gray-600'}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Grid Content */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto relative"
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-30 shadow-md">
            <tr className="bg-white">
              <th className="p-3 border-b border-r bg-gray-100 min-w-[160px] text-left sticky left-0 z-30 font-bold text-gray-700">
                Room / Type
              </th>
              {dates.map(date => {
                const isToday = isSameDay(date, new Date());
                return (
                  <th 
                    key={date.toISOString()} 
                    className={`p-2 border-b border-r min-w-[80px] text-center text-xs transition-colors
                      ${isToday ? 'bg-blue-100 text-blue-800 ring-2 ring-blue-400 ring-inset' : 'bg-gray-50 text-gray-600'}`}
                  >
                    <div className="font-bold text-sm">{format(date, 'd')}</div>
                    <div className="uppercase tracking-tighter opacity-70 font-medium">{format(date, 'EEE')}</div>
                    <div className="text-[10px] opacity-50">{format(date, 'MMM')}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {gridData.map(({ room, cells }) => (
              <tr key={room.id} className="hover:bg-blue-50/30 group">
                <td className="p-3 border-r border-b font-medium sticky left-0 bg-white group-hover:bg-blue-50 transition-colors z-20 shadow-sm">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-gray-900">Room {room.number}</span>
                    <span className="text-[11px] text-gray-500 uppercase tracking-tight">{room.type}</span>
                  </div>
                </td>
                {cells.map((cell, idx) => (
                  <td 
                    key={idx} 
                    className={`p-0 border-r border-b transition-all duration-200 text-[11px] text-center align-middle relative h-14 ${getCellColor(cell.status)}`}
                    onClick={() => handleCellClick(cell, room)}
                  >
                    {cell.res && (
                      <div className="px-1 font-semibold leading-tight drop-shadow-sm">
                        <div className="truncate">{cell.res.guestName}</div>
                        <div className="text-[9px] opacity-75">{cell.res.status}</div>
                      </div>
                    )}
                    {isSameDay(cell.date, new Date()) && (
                      <div className="absolute inset-x-0 top-0 h-1 bg-blue-400/50 pointer-events-none" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Footer / Legend */}
      <div className="p-4 border-t bg-gray-50/80 backdrop-blur-sm text-xs flex items-center justify-between">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-50 border border-gray-200 rounded-sm"></div>
            <span className="font-medium text-gray-600">Vacant</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded-sm shadow-sm"></div>
            <span className="font-medium text-gray-600">Booked (Reservation)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded-sm shadow-sm"></div>
            <span className="font-medium text-gray-600">Occupied (In-House)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded-sm shadow-sm"></div>
            <span className="font-medium text-gray-600">Blocked</span>
          </div>
        </div>
        <div className="text-gray-400 font-medium">
          Click an entry to view details
        </div>
      </div>
    </div>
  );
};
