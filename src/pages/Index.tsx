
import React from 'react';
import AppLayout from '@/components/AppLayout';
import { useNightAuditScheduler } from '@/hooks/useNightAuditScheduler';

const Index: React.FC = () => {
  // Schedule automatic Night Audit at 00:00 local time every night.
  // Runs silently in the background whenever the app session is open at midnight.
  useNightAuditScheduler({
    onStart:    (date) => console.log(`[AutoNightAudit] Auto-run started for ${date}`),
    onComplete: (date, result) => console.log(`[AutoNightAudit] Completed for ${date}`, result?.ok),
    onError:    (date, err)    => console.error(`[AutoNightAudit] Failed for ${date}`, err),
  });

  return (
    <AppLayout />
  );
};

export default Index;
