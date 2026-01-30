import React from 'react';
import { cn } from '@/lib/utils';

interface VersionDisplayProps {
  className?: string;
}

const VersionDisplay: React.FC<VersionDisplayProps> = ({ className }) => {
  const version = __APP_VERSION__;
  const buildInfo = __APP_BUILD_INFO__;

  return (
    <div 
      className={cn("text-[10px] text-gray-500 font-mono select-none flex items-center gap-1", className)}
      aria-label={`Application Version ${version}`}
      title={`Version ${version}${buildInfo ? ` (${buildInfo})` : ''}`}
    >
      <span>v{version}</span>
      {buildInfo && <span className="opacity-75">-{buildInfo}</span>}
    </div>
  );
};

export default VersionDisplay;
