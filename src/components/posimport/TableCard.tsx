import React from 'react';

interface Table {
  id: string;
  number: number;
  status: 'available' | 'occupied' | 'suspended';
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

  return (
    <div 
      className={`rounded-xl shadow-lg overflow-hidden cursor-pointer hover:shadow-2xl transition-all duration-200 transform hover:scale-105 border border-gray-200 relative ${selected ? 'ring-2 ring-purple-400' : ''}`}
      onClick={onClick}
    >
      {/* Selection checkbox */}
      {onSelectToggle && (
        <div className="absolute top-2 left-2 z-10">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => { e.stopPropagation(); onSelectToggle?.(); }}
            className="h-4 w-4 accent-purple-600"
            aria-label="Select table"
          />
        </div>
      )}

      {/* Action buttons overlay removed per request */}

      <div className={`${statusColors[table.status]} p-6`}>
        <div className="text-white text-center">
          <div className="text-4xl font-bold mb-2">{table.number}</div>
          <div className="text-sm font-semibold uppercase tracking-wide">{statusText[table.status]}</div>
        </div>
      </div>
      <div className="p-4 text-center bg-white">
        <div className="text-sm text-gray-600">
          {table.currentBill ? `$${table.currentBill.total.toFixed(2)}` : 'No active bill'}
        </div>
      </div>
    </div>
  );
});
