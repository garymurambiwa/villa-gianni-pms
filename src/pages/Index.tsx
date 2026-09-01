
import React from 'react';
import AppLayout from '@/components/AppLayout';

// NOTE: The browser-side night-audit scheduler has been REMOVED. The night audit
// now has a SINGLE reference — the server-side cron in nightAuditRunner.cjs, fixed
// at 23:59 Africa/Harare for every property. Running it here as well caused
// duplicate/early runs (e.g. the 2026-07-14 mid-morning close), so the client no
// longer schedules or triggers audits.

const Index: React.FC = () => {
  return (
    <AppLayout />
  );
};

export default Index;
