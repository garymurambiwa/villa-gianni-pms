import React from 'react';
import { Button } from '@/components/ui/button';

export type ViewOption = 'xl' | 'md' | 'sm' | 'list';

interface ViewSelectorProps {
  value: ViewOption;
  onChange: (v: ViewOption) => void;
  storageKey?: string;
}

const labels: Record<ViewOption, string> = {
  xl: 'Extra Large',
  md: 'Medium',
  sm: 'Small',
  list: 'Detailed List',
};

export const ViewSelector: React.FC<ViewSelectorProps> = ({ value, onChange, storageKey = 'corepms_rooms_view' }) => {
  const setValue = (v: ViewOption) => {
    try { localStorage.setItem(storageKey, v); } catch {}
    onChange(v);
  };

  return (
    <div role="radiogroup" aria-label="View selector" className="flex flex-wrap items-center gap-2">
      {(Object.keys(labels) as ViewOption[]).map(opt => (
        <Button
          key={opt}
          type="button"
          variant={value === opt ? 'default' : 'outline'}
          className={value === opt ? 'bg-blue-600 text-white' : ''}
          aria-pressed={value === opt}
          aria-checked={value === opt}
          role="radio"
          onClick={() => setValue(opt)}
        >
          {labels[opt]}
        </Button>
      ))}
    </div>
  );
};

export default ViewSelector;

