import React from 'react';

interface LoadingSpinnerProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ label = 'Loading…', size = 'md', className = '' }) => {
  const spinnerSize = sizeMap[size] || sizeMap.md;
  return (
    <div className={`flex items-center gap-3 text-muted-foreground ${className}`} role="status" aria-live="polite" aria-busy="true">
      <svg className={`animate-spin ${spinnerSize} text-primary`} viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
};

export default LoadingSpinner;
