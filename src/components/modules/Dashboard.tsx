import React from 'react';
import { useData } from '../../context/DataContext';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ORIGIN_REGIONS } from '@/data/regions';

export const Dashboard: React.FC = () => {
  const { rooms, reservations, dataError, lastUpdateTs } = useData();
  const [latencyExceeded, setLatencyExceeded] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const updateStartRef = React.useRef<number>(0);
  const [pulse, setPulse] = React.useState(false);

  // ----- Real-time Metrics Calculation -----
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // 1. Occupied Rooms
  const getStatusCategory = (status: string) => {
    const s = (status || '').toUpperCase();
    if (s === 'VC' || s === 'VACANT' || s === 'AVAILABLE') return 'VC';
    if (s === 'VD') return 'VD';
    if (s === 'OCC' || s === 'OC' || s === 'OCCUPIED') return 'OCC';
    if (s === 'OD') return 'OD';
    if (s === 'OOO') return 'OOO';
    if (s === 'OOS') return 'OOS';
    return 'VC';
  };
  const occupiedRooms = rooms.filter(r => {
    const c = getStatusCategory(r.status);
    return c === 'OCC' || c === 'OD';
  }).length;

  // Total Available Rooms (Total Inventory excluding Out of Order/Service)
  // Used as denominator for Occupancy Rate and ARR
  const totalAvailableRooms = rooms.filter(r => {
    const c = getStatusCategory(r.status);
    return c !== 'OOO' && c !== 'OOS';
  }).length;

  // 1. Occupancy Rate = (Occupied Rooms / Total Available Rooms) * 100
  const occupancyRate = totalAvailableRooms > 0 
    ? ((occupiedRooms / totalAvailableRooms) * 100).toFixed(1) 
    : '0.0';

  // 3. Today's Check-Ins: Number of reservations checking in today
  const todayCheckIns = reservations.filter(r => r.checkIn === todayStr).length;

  // 4. Today's Check-Outs: Number of reservations checking out today
  const todayCheckOuts = reservations.filter(r => r.checkOut === todayStr).length;

  // Calculate Total Room Revenue for today (sum of rates for currently checked-in reservations)
  // We use 'checked-in' status to identify currently generating revenue
  const currentRevenue = reservations
    .filter(r => r.status === 'checked-in')
    .reduce((sum, r) => sum + (r.rate || 0), 0);

  // 5. ADR (Average Daily Rate) = Total Room Revenue / Number of Rooms Sold (Occupied Rooms)
  // Handle division by zero to prevent $Infinity display
  const avgDailyRate = occupiedRooms > 0 && currentRevenue > 0 ? currentRevenue / occupiedRooms : 0;

  // 6. ARR (Average Room Rate) = Total Room Revenue / Total Available Rooms
  const avgRoomRate = totalAvailableRooms > 0 ? currentRevenue / totalAvailableRooms : 0;

  const stats = [
    { label: 'Occupancy Rate', value: `${occupancyRate}%`, color: 'bg-blue-500' },
    { label: 'Occupied Rooms', value: `${occupiedRooms}`, color: 'bg-green-500' },
    { label: 'Today Check-Ins', value: todayCheckIns, color: 'bg-purple-500' },
    { label: 'Today Check-Outs', value: todayCheckOuts, color: 'bg-orange-500' },
    { label: 'ADR', value: `$${avgDailyRate.toFixed(2)}`, color: 'bg-indigo-500' },
    { label: 'ARR', value: `$${avgRoomRate.toFixed(2)}`, color: 'bg-pink-500' }
  ];

  // Count room statuses - normalize to standard codes
  const roomStatusCounts = {
    VC: rooms.filter(r => getStatusCategory(r.status) === 'VC').length,
    VD: rooms.filter(r => getStatusCategory(r.status) === 'VD').length,
    OCC: rooms.filter(r => getStatusCategory(r.status) === 'OCC').length,
    OD: rooms.filter(r => getStatusCategory(r.status) === 'OD').length,
    OOO: rooms.filter(r => getStatusCategory(r.status) === 'OOO').length,
    OOS: rooms.filter(r => getStatusCategory(r.status) === 'OOS').length
  };
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
  const inRange = (checkInISO: string) => {
    const ci = clampDate(new Date(checkInISO));
    return ci >= clampDate(parsedStart) && ci <= clampDate(parsedEnd);
  };

  const daysBetween = (aISO: string, bISO: string) => {
    const a = clampDate(new Date(aISO));
    const b = clampDate(new Date(bISO));
    const diff = (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.floor(diff));
  };

  const regionRevenueMap = React.useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach(r => {
      if (!r.originRegion) return;
      if (!inRange(r.checkIn)) return;
      const nights = daysBetween(r.checkIn, r.checkOut);
      const revenue = (nights || 1) * (r.rate || 0);
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
    <div className="p-6">
      <h2 className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b px-6 -mx-6 text-3xl font-bold text-gray-800 mb-6 py-3">Dashboard Overview</h2>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">{lastUpdateTs ? `Updated ${new Date(lastUpdateTs).toLocaleTimeString()}` : 'Waiting for data'}</div>
        {(dataError || latencyExceeded || validationError) && (
          <div className={`p-2 rounded border ${dataError ? 'border-red-500 bg-red-50' : latencyExceeded ? 'border-yellow-500 bg-yellow-50' : 'border-orange-500 bg-orange-50'}`}>
            <span className="text-xs text-gray-800">
              {dataError ? `Real-time data issue: ${dataError}` : latencyExceeded ? 'Real-time update latency exceeded 2s' : validationError}
            </span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white rounded-xl shadow-lg p-6 border-l-4" style={{ borderColor: stat.color.replace('bg-', '') }}>
            <p className="text-gray-600 text-sm font-medium mb-2">{stat.label}</p>
            <p className={`text-3xl font-bold text-gray-800 ${stat.label === 'Occupancy Rate' && pulse ? 'animate-pulse' : ''}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Room Status Summary</h3>
          <div className="space-y-3">
            {Object.entries(roomStatusCounts).map(([status, count]) => (
              <div key={status} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="font-medium text-gray-700">{status}</span>
                <span className="text-2xl font-bold text-blue-600">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Today's Activity</h3>
          <div className="space-y-3">
            {recentActivity.length > 0 ? (
              recentActivity.map((item, idx) => (
                <div key={idx} className={`p-3 border-l-4 rounded ${item.color}`}>
                  <p className="text-sm font-medium text-gray-700">{item.label}</p>
                  <p className="text-xs text-gray-500">{item.desc}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-500 italic">No activity recorded for today.</p>
            )}
          </div>
        </div>
      </div>

      {/* Region Filters */}
      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Analytics Filters</h3>
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm text-gray-700">
            Start Date
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-gray-700">
            End Date
            <input
              type="date"
              className="ml-2 border rounded px-2 py-1"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-gray-700">
            Metric
            <select
              className="ml-2 border rounded px-2 py-1"
              value={metric}
              onChange={(e) => setMetric(e.target.value as 'Revenue' | 'RevPAR')}
            >
              <option value="Revenue">Revenue</option>
              <option value="RevPAR">RevPAR</option>
            </select>
          </label>
        </div>
      </div>

      {/* Revenue Share by Region */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Revenue Share by Region</h3>
          <ChartContainer config={chartConfig} className="w-full h-80">
            <ResponsiveContainer>
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" labelKey="name" />} />
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={120}
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={pieColors[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="name" />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </div>

      {/* Revenue/RevPAR Trend by Region */}
      <div className="grid grid-cols-1 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">{metric} Trend by Region</h3>
          <ChartContainer config={chartConfig} className="w-full h-96">
            <ResponsiveContainer>
              <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {ORIGIN_REGIONS.map(region => (
                  <Line key={region} type="monotone" dataKey={region} stroke={pieColors[region] || '#94a3b8'} dot={false} strokeWidth={2} />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>
      </div>
    </div>
  );
};
