import React from 'react';
import { useData } from '../../context/DataContext';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ORIGIN_REGIONS } from '@/data/regions';
import { Building2, BedDouble, LogIn, LogOut, DollarSign, TrendingUp, AlertCircle, Activity } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { rooms, reservations, dataError, lastUpdateTs } = useData();
  const [latencyExceeded, setLatencyExceeded] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const updateStartRef = React.useRef<number>(0);
  const [pulse, setPulse] = React.useState(false);

  // ----- Real-time Metrics Calculation -----
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // ── Industry-standard status normaliser (matches Availability Grid logic) ──
  const getStatusCategory = (status: string) => {
    const s = (status || '').toUpperCase();
    if (s === 'OC' || s === 'OCC' || s === 'OCCUPIED') return 'OCC'; // Occupied Clean
    if (s === 'OD') return 'OD';                                       // Occupied Dirty
    if (s === 'VD') return 'VD';                                       // Vacant Dirty
    if (s === 'VC' || s === 'VACANT' || s === 'AVAILABLE') return 'VC';// Vacant Clean
    if (s === 'OOO') return 'OOO';                                     // Out of Order
    if (s === 'OOS') return 'OOS';                                     // Out of Service
    return 'VC';
  };

  // Conference rooms are excluded from ALL rooms KPIs (occupancy, ADR, RevPAR) —
  // they book through the same system but must never distort accommodation stats.
  const kpiRooms = rooms.filter(r => !/conference/i.test(String((r as any).type || '')));

  // OCCUPIED = rooms physically occupied (OC + OD status on the rooms table).
  // This is the industry standard (Smith Travel Research / STR) — use room status,
  // not reservation count, so the dashboard stays in sync with the Availability Grid.
  const occupiedRooms = kpiRooms.filter(r => {
    const c = getStatusCategory(r.status);
    return c === 'OCC' || c === 'OD';
  }).length;

  // TOTAL AVAILABLE ROOMS = physical inventory minus permanently blocked (OOO/OOS).
  // Denominator for Occupancy %, ADR and RevPAR.
  const totalAvailableRooms = kpiRooms.filter(r => {
    const c = getStatusCategory(r.status);
    return c !== 'OOO' && c !== 'OOS';
  }).length;

  // OCCUPANCY RATE (industry standard): Occupied Rooms ÷ Total Available Rooms
  const occupancyRate = totalAvailableRooms > 0
    ? ((occupiedRooms / totalAvailableRooms) * 100).toFixed(1)
    : '0.0';

  // TODAY'S ARRIVALS / DEPARTURES from reservations
  // TODAY CHECK-INS: reservations that checked in today (status = checked-in or occupied)
  const todayCheckIns = reservations.filter((r: any) => {
    const ci = String(r.checkIn || r.check_in_date || '').slice(0, 10);
    return ci === todayStr && (r.status === 'checked-in' || r.status === 'occupied');
  }).length;
  // TODAY CHECK-OUTS: only reservations that have ACTUALLY checked out today
  // (status = 'checked-out' AND check_out_date = today). Confirmed/in-house reservations
  // with a future checkout date must NOT be counted — fixes the "2 checkouts 0 occupied" anomaly.
  const todayCheckOuts = reservations.filter((r: any) => {
    const co = String(r.checkOut || r.check_out_date || '').slice(0, 10);
    return co === todayStr && r.status === 'checked-out';
  }).length;

  // ADR (Average Daily Rate) = Sum of room rates for occupied rooms ÷ occupied rooms count.
  // Uses unique rooms (not duplicate reservations) to avoid inflating ADR.
  const occupiedRoomIds = new Set(
    reservations
      .filter((r: any) => r.status === 'checked-in' || r.status === 'occupied')
      .map((r: any) => r.room_id || r.roomId)
      .filter(Boolean)
  );
  const currentRevenue = rooms
    .filter((r: any) => occupiedRoomIds.has(r.id))
    .reduce((sum: number, r: any) => sum + (Number(r.rate) || 0), 0);

  const avgDailyRate = occupiedRooms > 0 ? currentRevenue / occupiedRooms : 0;

  // RevPAR (Revenue Per Available Room) = ADR × Occupancy % (or Total Revenue ÷ Total Rooms)
  const avgRoomRate = totalAvailableRooms > 0 ? currentRevenue / totalAvailableRooms : 0;

  const stats = [
    { label: 'Occupancy Rate', value: `${occupancyRate}%`, color: 'var(--hotel-primary)', icon: <TrendingUp className="w-5 h-5" /> },
    { label: 'Occupied Rooms', value: `${occupiedRooms}`, color: 'var(--hotel-primary)', icon: <BedDouble className="w-5 h-5" /> },
    { label: 'Today Check-Ins', value: todayCheckIns, color: 'var(--hotel-accent)', icon: <LogIn className="w-5 h-5" /> },
    { label: 'Today Check-Outs', value: todayCheckOuts, color: 'var(--hotel-accent)', icon: <LogOut className="w-5 h-5" /> },
    { label: 'ADR', value: `$${avgDailyRate.toFixed(2)}`, color: 'var(--hotel-gold)', icon: <DollarSign className="w-5 h-5" /> },
    { label: 'RevPAR', value: `$${avgRoomRate.toFixed(2)}`, color: 'var(--hotel-gold)', icon: <Building2 className="w-5 h-5" /> }
  ];

  // Count room statuses - normalize to standard codes
  const roomStatusCounts = React.useMemo(() => ({
    VC: rooms.filter(r => getStatusCategory(r.status) === 'VC').length,
    VD: rooms.filter(r => getStatusCategory(r.status) === 'VD').length,
    OCC: rooms.filter(r => getStatusCategory(r.status) === 'OCC').length,
    OD: rooms.filter(r => getStatusCategory(r.status) === 'OD').length,
    OOO: rooms.filter(r => getStatusCategory(r.status) === 'OOO').length,
    OOS: rooms.filter(r => getStatusCategory(r.status) === 'OOS').length
  }), [rooms]);
  React.useEffect(() => {
    updateStartRef.current = performance.now();
  }, [rooms, reservations]);
  React.useEffect(() => {
    const elapsed = performance.now() - updateStartRef.current;
    setLatencyExceeded(elapsed > 2000);
    const sumCounts = Object.values(roomStatusCounts).reduce((a, b) => a + b, 0);
    const occCalc = totalAvailableRooms > 0 ? (occupiedRooms / totalAvailableRooms) * 100 : 0;
    const occDisplayed = parseFloat(String(occupancyRate));
    const epsilon = 0.1;
    if (sumCounts !== rooms.length) {
      setValidationError('Room status summary does not match total rooms');
    } else if (Math.abs(occCalc - occDisplayed) > epsilon) {
      setValidationError('Occupancy rate is inconsistent with inputs');
    } else {
      setValidationError(null);
    }
  }, [occupancyRate, occupiedRooms, totalAvailableRooms, roomStatusCounts, rooms.length]);
  React.useEffect(() => {
    if (!lastUpdateTs) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1500);
    return () => clearTimeout(t);
  }, [lastUpdateTs]);

  // ----- Region Revenue Share (Pie) -----
  // Date range: default last 30 days
  const defaultStart = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);
  const [startDate, setStartDate] = React.useState<string>(defaultStart.toISOString().slice(0, 10));
  const [endDate, setEndDate] = React.useState<string>(today.toISOString().slice(0, 10));

  const parsedStart = new Date(startDate);
  const parsedEnd = new Date(endDate);

  const clampDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // Check if reservation overlaps with date range
  const isReservationInRange = (checkInISO: string, checkOutISO: string) => {
    const ci = clampDate(new Date(checkInISO));
    const co = clampDate(new Date(checkOutISO));
    const rangeStart = clampDate(parsedStart);
    const rangeEnd = clampDate(parsedEnd);
    // Check if reservation overlaps with range (reservation starts before range ends AND ends after range starts)
    return ci <= rangeEnd && co >= rangeStart;
  };

  // Calculate the number of nights within the date range for a reservation
  const getNightsInRange = (checkInISO: string, checkOutISO: string) => {
    const ci = clampDate(new Date(checkInISO));
    const co = clampDate(new Date(checkOutISO));
    const rangeStart = clampDate(parsedStart);
    const rangeEnd = clampDate(parsedEnd);

    // Calculate overlap start and end
    const overlapStart = ci > rangeStart ? ci : rangeStart;
    const overlapEnd = co < rangeEnd ? co : rangeEnd;

    const nights = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.floor(nights));
  };

  const regionRevenueMap = React.useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach(r => {
      if (!r.originRegion) return;
      if (!r.checkIn || !r.checkOut) return;
      if (!isReservationInRange(r.checkIn, r.checkOut)) return;

      // Calculate only the nights within the selected date range
      const nightsInRange = getNightsInRange(r.checkIn, r.checkOut);
      if (nightsInRange <= 0) return;

      const revenue = nightsInRange * (r.rate || 0);
      map.set(r.originRegion, (map.get(r.originRegion) || 0) + revenue);
    });
    return map;
  }, [reservations, startDate, endDate]);

  const pieData = React.useMemo(
    () => ORIGIN_REGIONS.map(region => ({ name: region, value: regionRevenueMap.get(region) || 0 })),
    [regionRevenueMap]
  );

  const pieColors: Record<string, string> = {
    'SADC': '#4f46e5',
    'EU': '#16a34a',
    'USA/Canada': '#f59e0b',
    'UK/Ireland': '#ef4444',
    'Asia-Pacific': '#0ea5e9',
    'Middle East': '#a855f7',
    'Latin America': '#f97316',
    'Domestic': '#22c55e',
    'Other': '#64748b',
  };

  const chartConfig = React.useMemo(
    () => Object.fromEntries(ORIGIN_REGIONS.map(r => [r, { label: r, color: pieColors[r] || '#94a3b8' }])),
    []
  );

  // ----- Revenue/RevPAR Trend -----
  const [metric, setMetric] = React.useState<'Revenue' | 'RevPAR'>('Revenue');
  const availableRoomsCount = React.useMemo(() => rooms.filter(r => r.status !== 'OOO' && r.status !== 'OOS').length || rooms.length, [rooms]);

  const eachDay = (start: Date, end: Date) => {
    const s = clampDate(start);
    const e = clampDate(end);
    const days: Date[] = [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  };

  const isActiveOnDay = (r: { checkIn: string; checkOut: string }, day: Date) => {
    const ci = clampDate(new Date(r.checkIn));
    const co = clampDate(new Date(r.checkOut));
    return day >= ci && day < co; // stay nights are from check-in inclusive to check-out exclusive
  };

  const trendData = React.useMemo(() => {
    const days = eachDay(parsedStart, parsedEnd);
    return days.map(day => {
      const point: Record<string, number | string> = { date: day.toISOString().slice(0, 10) };
      ORIGIN_REGIONS.forEach(region => {
        // Sum revenue for reservations active on this day for the region
        const dayRevenue = reservations.reduce((sum, r) => {
          if (r.originRegion !== region) return sum;
          if (!isActiveOnDay(r, day)) return sum;
          return sum + (r.rate || 0);
        }, 0);
        point[region] = metric === 'Revenue' ? dayRevenue : (availableRoomsCount ? dayRevenue / availableRoomsCount : 0);
      });
      return point;
    });
  }, [reservations, parsedStart, parsedEnd, metric, availableRoomsCount]);

  // ----- Recent Activity (Dynamic) -----
  const recentActivity = React.useMemo(() => {
    const activity = [];

    // Recent Check-Ins (today)
    reservations.filter(r => r.checkIn === todayStr).forEach(r => {
      activity.push({
        type: 'Check-In',
        label: r.status === 'checked-in' ? 'Guest Checked In' : 'Expected Arrival',
        desc: `Room ${r.roomType} - ${r.guestName}`,
        color: 'bg-green-50 border-green-500',
        ts: r.status === 'checked-in' ? 2 : 1 // prioritize checked-in
      });
    });

    // Recent Check-Outs (today)
    reservations.filter(r => r.checkOut === todayStr).forEach(r => {
      activity.push({
        type: 'Check-Out',
        label: r.status === 'checked-out' ? 'Guest Checked Out' : 'Expected Departure',
        desc: `Room ${r.roomType} - ${r.guestName}`,
        color: 'bg-orange-50 border-orange-500',
        ts: r.status === 'checked-out' ? 2 : 1
      });
    });

    // Recent Bookings (confirmed today)
    // We check if confirmedAt starts with todayStr
    reservations.filter(r => r.confirmedAt && r.confirmedAt.startsWith(todayStr)).forEach(r => {
      activity.push({
        type: 'Booking',
        label: 'New Reservation',
        desc: `${r.roomType} - ${r.guestName}`,
        color: 'bg-blue-50 border-blue-500',
        ts: 3 // prioritize new bookings
      });
    });

    // Sort by "timestamp" or just shuffle/prioritize. 
    // Since we don't have exact timestamps for check-in/out events easily accessible here (only dates),
    // we will just show a mix, capped at 5.
    return activity.slice(0, 5);
  }, [reservations, todayStr]);

  return (
    <div className="p-6 transition-colors duration-300 min-h-screen hotel-bg">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <h2
          className="text-3xl font-bold transition-colors duration-300 hotel-text"
        >
          Overview
        </h2>
        <div className="flex items-center gap-4">
          <div className="text-xs transition-colors hotel-text-muted">
            {lastUpdateTs ? `Data synced at ${new Date(lastUpdateTs).toLocaleTimeString()}` : 'Waiting for data'}
          </div>
          <div className="flex shrink-0">
            {/* Profile icon placeholder mimicking reference image */}
            <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden border-2 border-white shadow-sm flex items-center justify-center text-gray-500">
              <span className="font-semibold text-sm">AD</span>
            </div>
          </div>
        </div>
      </div>
      {(dataError || latencyExceeded || validationError) && (
        <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 ${dataError ? 'border-red-500 bg-red-50 text-red-700' : 'border-orange-500 bg-orange-50 text-orange-700'}`}>
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">
            {dataError ? `Real-time synchronization error: ${dataError}` : latencyExceeded ? 'Real-time update latency is unusually high (> 2s)' : validationError}
          </span>
        </div>
      )}

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {stats.map((stat, idx) => (
          <div
            key={idx}
            className="rounded-xl shadow-sm p-6 border transition-colors duration-300 relative overflow-hidden hotel-card-bg hotel-border"
          >
            <div className="flex justify-between items-start mb-4">
              <p className="text-sm font-semibold transition-colors uppercase tracking-wider hotel-text-muted">{stat.label}</p>
              <div className="p-2.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${stat.color} 15%, transparent)`, color: stat.color }}>
                {stat.icon}
              </div>
            </div>
            <div>
              <p
                className={`text-4xl font-extrabold transition-colors hotel-text ${stat.label === 'Occupancy Rate' && pulse ? 'animate-pulse' : ''}`}
              >
                {stat.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        {/* Left Main Content */}
        <div className="xl:col-span-2 space-y-6">

          <div className="rounded-xl shadow-sm p-6 border transition-colors duration-300 hotel-card-bg hotel-border">
            <h3 className="text-lg font-bold mb-4 transition-colors uppercase tracking-wide hotel-text-muted">Room Status Overview</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <tbody>
                  {Object.entries(roomStatusCounts).map(([status, count], idx) => (
                    <tr key={status} className="border-b transition-colors last:border-0 hotel-border">
                      <td className="py-3 font-semibold transition-colors w-1/3 hotel-text">{status}</td>
                      <td className="py-3 font-bold text-right transition-colors pr-2 hotel-primary-text">{count}</td>
                      <td className="py-3 w-1/2">
                        <div className="h-1.5 w-full rounded-full overflow-hidden hotel-border bg-gray-100">
                          <div className="h-full rounded-full hotel-primary-bg" style={{ width: `${totalAvailableRooms > 0 ? (count / totalAvailableRooms) * 100 : 0}%` }}></div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl shadow-sm p-6 border transition-colors duration-300 hotel-card-bg hotel-border">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold transition-colors uppercase tracking-wide hotel-text-muted">{metric} Trend Over Time</h3>
              <select
                id="metric-trend-select"
                title="Select metric for trend chart"
                className="text-sm border rounded px-3 py-1.5 transition-colors outline-none font-medium hotel-bg hotel-border hotel-text"
                value={metric}
                onChange={(e) => setMetric(e.target.value as 'Revenue' | 'RevPAR')}
              >
                <option value="Revenue">Revenue</option>
                <option value="RevPAR">RevPAR</option>
              </select>
            </div>
            <ChartContainer config={chartConfig} className="w-full h-80">
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--hotel-border)" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--hotel-text-muted)' }} dy={10} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--hotel-text-muted)' }} dx={-10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {ORIGIN_REGIONS.map(region => (
                    <Line key={region} type="monotone" dataKey={region} stroke={pieColors[region] || '#94a3b8'} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} strokeWidth={2.5} />
                  ))}
                  <ChartLegend content={<ChartLegendContent />} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </div>

        {/* Right Sidebar Content */}
        <div className="xl:col-span-1 space-y-6">
          <div
            className="rounded-xl shadow-sm p-6 border transition-colors duration-300 hotel-primary-bg"
          >
            <div className="flex items-center gap-2 mb-6">
              <Activity className="w-5 h-5 text-white/80" />
              <h3 className="text-lg font-bold uppercase tracking-wide text-white/90">Today's Activity</h3>
            </div>
            <div className="space-y-4">
              {recentActivity.length > 0 ? (
                recentActivity.map((item, idx) => (
                  <div
                    key={idx}
                    className="border-b border-white/20 pb-4 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-bold text-white mb-1">{item.label}</p>
                    <p className="text-xs text-white/80">{item.desc}</p>
                  </div>
                ))
              ) : (
                <p className="italic text-white/70">No activity recorded for today.</p>
              )}
            </div>
          </div>

          <div
            className="rounded-xl shadow-sm p-6 border transition-colors duration-300 hotel-accent-bg"
          >
            <h3 className="text-lg font-bold uppercase tracking-wide text-white/90 mb-4">Analytics Controls</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="start-date" className="text-xs font-semibold text-white/80 block mb-1">Start Date</label>
                <input
                  id="start-date"
                  type="date"
                  className="w-full border-0 rounded px-3 py-2 text-sm text-gray-900 shadow-inner"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="end-date" className="text-xs font-semibold text-white/80 block mb-1">End Date</label>
                <input
                  id="end-date"
                  type="date"
                  className="w-full border-0 rounded px-3 py-2 text-sm text-gray-900 shadow-inner"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl shadow-sm p-6 border transition-colors duration-300 hotel-card-bg hotel-border">
            <h3 className="text-sm font-bold mb-4 transition-colors uppercase tracking-wide text-center hotel-text-muted">Revenue Share</h3>
            <ChartContainer config={chartConfig} className="w-full h-48">
              <ResponsiveContainer>
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" labelKey="name" />} />
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={45}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={pieColors[entry.name] || '#94a3b8'} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
