import React from 'react';
import { useNightAuditLock } from '@/hooks/useNightAuditLock';

const STEPS: Record<string, string> = {
  starting:                          'Initialising…',
  'Closing open POS shifts':         'Closing POS shifts',
  'Voiding stale POS orders':        'Clearing stale orders',
  'Posting room charges':            'Posting room charges',
  'Aggregating POS revenue':         'Aggregating revenue',
  'Processing city ledger transfers':'City ledger transfers',
  'Reconciling totals':              'Reconciling totals',
  'Recording audit run to database': 'Saving audit record',
  'Rolling over business date':      'Rolling business date',
  'Writing report files':            'Writing reports',
  complete:                          'Complete',
};

export const NightAuditLockOverlay: React.FC = () => {
  const { locked, step, progress } = useNightAuditLock();

  if (!locked && step !== 'complete') return null;

  const isComplete  = step === 'complete';
  const displayStep = (step && STEPS[step]) || step || 'Processing…';

  return (
    <div
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          99999,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        background:      isComplete
          ? 'rgba(5, 46, 22, 0.96)'
          : 'rgba(7, 10, 25, 0.97)',
        backdropFilter:  'blur(6px)',
        userSelect:      'none',
        transition:      'background 0.4s ease',
      }}
    >
      {/* Pulsing ring */}
      {!isComplete && (
        <div style={{
          width: 120, height: 120,
          borderRadius: '50%',
          border: '3px solid rgba(251,191,36,0.25)',
          position: 'absolute',
          animation: 'na-pulse 2s ease-in-out infinite',
        }} />
      )}

      {/* Icon */}
      <div style={{
        fontSize: 56,
        marginBottom: 24,
        filter: isComplete ? 'drop-shadow(0 0 12px #22c55e)' : 'drop-shadow(0 0 12px #f59e0b)',
      }}>
        {isComplete ? '✓' : '🌙'}
      </div>

      {/* Title */}
      <h1 style={{
        color:          isComplete ? '#86efac' : '#fbbf24',
        fontSize:       '2rem',
        fontWeight:     800,
        letterSpacing:  '0.15em',
        textAlign:      'center',
        margin:         '0 0 8px',
        textShadow:     isComplete
          ? '0 0 20px rgba(134,239,172,0.5)'
          : '0 0 20px rgba(251,191,36,0.5)',
      }}>
        {isComplete ? 'NIGHT AUDIT COMPLETE' : 'NIGHT AUDIT IN PROCESS'}
      </h1>

      {/* Subtitle */}
      <p style={{
        color:       'rgba(255,255,255,0.55)',
        fontSize:    '0.9rem',
        letterSpacing: '0.08em',
        margin:      '0 0 32px',
        textAlign:   'center',
      }}>
        {isComplete
          ? 'System is ready for the new business day'
          : 'All operations are temporarily suspended — please wait'}
      </p>

      {/* Progress bar */}
      <div style={{
        width:        340,
        height:       6,
        borderRadius: 3,
        background:   'rgba(255,255,255,0.12)',
        overflow:     'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          height:     '100%',
          width:      `${progress}%`,
          borderRadius: 3,
          background:   isComplete
            ? 'linear-gradient(90deg,#22c55e,#86efac)'
            : 'linear-gradient(90deg,#f59e0b,#fbbf24)',
          transition:   'width 0.6s ease',
          boxShadow:    isComplete
            ? '0 0 8px rgba(34,197,94,0.6)'
            : '0 0 8px rgba(245,158,11,0.6)',
        }} />
      </div>

      {/* Step label */}
      <p style={{
        color:         isComplete ? '#86efac' : '#fbbf24',
        fontSize:      '0.8rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        opacity:       0.85,
      }}>
        {displayStep}{!isComplete && progress < 100 ? '…' : ''}
      </p>

      {/* CSS animation */}
      <style>{`
        @keyframes na-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.6; }
          50%       { transform: scale(1.15); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
};

export default NightAuditLockOverlay;
