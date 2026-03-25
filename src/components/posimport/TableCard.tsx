import React from 'react';
import { formatCurrency } from '@/lib/posIntegration';

interface Table {
  id: string;
  number: number;
  status: 'available' | 'occupied' | 'suspended';
  cost_center?: string;
  currentBill?: {
    total: number;
  };
}

interface TableCardProps {
  table: Table;
  onClick: () => void;
  onClearBill?: () => void;
  onToggleSuspend?: () => void;
  selected?: boolean;
  onSelectToggle?: () => void;
}

export const TableCard: React.FC<TableCardProps> = React.memo(({ table, onClick, onClearBill, onToggleSuspend, selected = false, onSelectToggle }) => {
  const statusColors: Record<Table['status'], string> = {
    available: 'bg-gradient-to-br from-green-400 to-emerald-500',
    occupied: 'bg-gradient-to-br from-red-400 to-pink-500',
    suspended: 'bg-gradient-to-br from-yellow-400 to-orange-500'
  };

  const statusText: Record<Table['status'], string> = {
    available: 'Available',
    occupied: 'Occupied',
    suspended: 'On Hold'
  };

  const costCenterColors: Record<string, string> = {
    'Main Restaurant': 'border-emerald-500',
    'Bar 1': 'border-blue-500',
    'Bar 2': 'border-indigo-500',
    'Lounge Restaurant': 'border-amber-500',
    'Room Service': 'border-purple-500',
    'default': 'border-gray-200'
  };

  const costCenterIndicator: Record<string, string> = {
    'Main Restaurant': 'bg-emerald-500',
    'Bar 1': 'bg-blue-500',
    'Bar 2': 'bg-indigo-500',
    'Lounge Restaurant': 'bg-amber-500',
    'Room Service': 'bg-purple-500',
    'default': 'bg-gray-400'
  };

  const borderColor = table.cost_center ? (costCenterColors[table.cost_center] || costCenterColors.default) : costCenterColors.default;
  const indicatorColor = table.cost_center ? (costCenterIndicator[table.cost_center] || costCenterIndicator.default) : costCenterIndicator.default;

  return (
    <div 
      className={`rounded-xl shadow-lg overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-200 transform hover:scale-105 border-2 ${borderColor} relative ${selected ? 'ring-2 ring-purple-400' : ''}`}
      onClick={onClick}
    >
      {/* Cost Centre Accent Bar */}
      <div className={`h-1.5 w-full ${indicatorColor}`} />

      {/* Selection checkbox */}
      {onSelectToggle && (
        <div className="absolute top-4 left-2 z-10">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onSelectToggle?.(); }}
            className="h-4 w-4 accent-purple-600"
            aria-label="Select table"
          />
        </div>
      )}

      <div className={`${statusColors[table.status]} p-6 relative`}>
        {table.cost_center && (
          <div className={`absolute top-0 right-0 px-3 py-1 text-[10px] font-bold rounded-bl-xl shadow-sm ${indicatorColor} text-white uppercase tracking-wider`}>
            {table.cost_center}
          </div>
        )}
        <div className="text-white text-center mt-2">
          <div className="text-4xl font-extrabold mb-1 drop-shadow-md">{table.number}</div>
          <div className="text-sm font-bold uppercase tracking-widest opacity-90">{statusText[table.status]}</div>
        </div>
      </div>
      <div className="p-4 text-center bg-white border-t border-gray-50">
        <div className="text-sm font-semibold text-gray-700">
          {table.currentBill ? formatCurrency(table.currentBill.total) : 'No active bill'}
        </div>
        {table.currentBill && (
          <div className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-tighter">
            Action Required
          </div>
        )}
      </div>
    </div>
  );
});
