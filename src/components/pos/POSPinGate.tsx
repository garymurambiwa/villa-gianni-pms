import React, { useState, useEffect, useCallback } from 'react';
import { Delete, Eraser, LogIn, User, ShieldCheck, Clock } from 'lucide-react';
import { hasPosPin, verifyPosPin, startPosSession, PosOperatorSession } from '@/lib/posPinService';
import { HOTEL_NAME } from '@/lib/brand';

interface StaffUser {
  id: string;
  name: string;
  username: string;
  role: string;
}

interface POSPinGateProps {
  users: StaffUser[];
  onAuthenticated: (session: PosOperatorSession) => void;
  outlet?: string;
}

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

export const POSPinGate: React.FC<POSPinGateProps> = ({ users, onAuthenticated, outlet }) => {
  const [step, setStep] = useState<'select' | 'pin'>('select');
  const [selectedUser, setSelectedUser] = useState<StaffUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [search, setSearch] = useState('');

  // Countdown timer for lockout
  useEffect(() => {
    if (!lockedUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setLockCountdown(0);
        setAttempts(0);
        setError(null);
      } else {
        setLockCountdown(remaining);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  // Auto-verify when 4 digits entered
  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      handleVerify();
    }
  }, [pin]);

  const isLocked = !!lockedUntil;

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectUser = (user: StaffUser) => {
    if (!hasPosPin(user.id)) {
      setError(`${user.name} does not have a POS PIN set. Ask an admin to configure it.`);
      return;
    }
    setSelectedUser(user);
    setStep('pin');
    setPin('');
    setError(null);
    setAttempts(0);
    setLockedUntil(null);
  };

  const handleNumberClick = useCallback((num: string) => {
    if (isLocked || pin.length >= PIN_LENGTH) return;
    setPin(p => p + num);
    setError(null);
  }, [isLocked, pin]);

  const handleDelete = () => setPin(p => p.slice(0, -1));
  const handleClear = () => { setPin(''); setError(null); };

  const handleVerify = () => {
    if (!selectedUser || isLocked) return;

    const ok = verifyPosPin(selectedUser.id, pin);

    if (ok) {
      const session = startPosSession({
        userId: selectedUser.id,
        userName: selectedUser.name,
        userRole: selectedUser.role,
        outlet,
      });
      onAuthenticated(session);
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setShake(true);
      setPin('');
      setTimeout(() => setShake(false), 600);

      if (newAttempts >= MAX_ATTEMPTS) {
        const until = new Date(Date.now() + LOCKOUT_SECONDS * 1000);
        setLockedUntil(until);
        setError(`Too many wrong attempts. Locked for ${LOCKOUT_SECONDS} seconds.`);
      } else {
        setError(`Incorrect PIN. ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} remaining.`);
      }
    }
  };

  // Keyboard support
  useEffect(() => {
    if (step !== 'pin') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleNumberClick(e.key);
      if (e.key === 'Backspace') handleDelete();
      if (e.key === 'Escape') { setStep('select'); setPin(''); setError(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, handleNumberClick]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: `radial-gradient(circle at 25% 25%, #6366f1 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)`
      }} />

      <div className="relative z-10 w-full max-w-sm px-4">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-900/50 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">POS Access</h1>
          <p className="text-slate-400 text-sm mt-1">
            {outlet ? `${outlet.charAt(0).toUpperCase() + outlet.slice(1)} Terminal` : 'Point of Sale'}
          </p>
        </div>

        {/* STEP 1: User Selection */}
        {step === 'select' && (
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-6">
            <p className="text-slate-300 text-sm text-center mb-4">Who is operating this terminal?</p>

            <input
              autoFocus
              type="text"
              placeholder="Search staff…"
              value={search}
              onChange={e => { setSearch(e.target.value); setError(null); }}
              className="w-full px-4 py-2.5 rounded-xl bg-white/10 text-white placeholder-slate-400 border border-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm mb-3"
            />

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {filteredUsers.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-4">No staff found</p>
              ) : (
                filteredUsers.map(u => (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 hover:border-indigo-400/50 transition-all group"
                  >
                    <div className="w-9 h-9 rounded-full bg-indigo-600/40 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-600/70 transition-colors">
                      <User className="w-4 h-4 text-indigo-200" />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{u.name}</p>
                      <p className="text-slate-400 text-xs truncate">{u.role}</p>
                    </div>
                    {hasPosPin(u.id) ? (
                      <span className="text-[10px] text-green-400 font-medium bg-green-400/10 px-2 py-0.5 rounded-full flex-shrink-0">PIN set</span>
                    ) : (
                      <span className="text-[10px] text-amber-400 font-medium bg-amber-400/10 px-2 py-0.5 rounded-full flex-shrink-0">No PIN</span>
                    )}
                  </button>
                ))
              )}
            </div>

            {error && (
              <div className="mt-3 bg-red-500/20 text-red-300 text-xs px-3 py-2 rounded-lg text-center">
                {error}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: PIN Entry */}
        {step === 'pin' && selectedUser && (
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-6">
            {/* Back + user info */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => { setStep('select'); setPin(''); setError(null); setSearch(''); }}
                className="text-slate-400 hover:text-white transition-colors text-xs underline underline-offset-2"
              >
                ← Back
              </button>
              <div className="flex-1 text-center">
                <p className="text-white font-semibold">{selectedUser.name}</p>
                <p className="text-slate-400 text-xs">{selectedUser.role}</p>
              </div>
              <div className="w-12" />
            </div>

            {/* PIN dots */}
            <div className={`flex justify-center gap-3 mb-5 ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <div
                  key={i}
                  className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center transition-all duration-150 ${
                    pin.length > i
                      ? 'border-indigo-400 bg-indigo-600/30 shadow-lg shadow-indigo-900/30'
                      : 'border-white/20 bg-white/5'
                  }`}
                >
                  {pin.length > i && <div className="w-3.5 h-3.5 rounded-full bg-indigo-300" />}
                </div>
              ))}
            </div>

            {/* Error / lockout */}
            {isLocked ? (
              <div className="flex items-center justify-center gap-2 bg-red-500/20 text-red-300 text-sm px-3 py-2.5 rounded-lg mb-4">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>Locked. Try again in <span className="font-bold">{lockCountdown}s</span></span>
              </div>
            ) : error ? (
              <div className="bg-red-500/20 text-red-300 text-xs px-3 py-2 rounded-lg mb-4 text-center">
                {error}
              </div>
            ) : (
              <p className="text-slate-400 text-xs text-center mb-4">Enter your 4-digit PIN</p>
            )}

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button
                  key={n}
                  disabled={isLocked}
                  onClick={() => handleNumberClick(String(n))}
                  className="h-14 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 hover:border-indigo-400/40"
                >
                  {n}
                </button>
              ))}
              {/* Clear */}
              <button
                disabled={isLocked}
                onClick={handleClear}
                className="h-14 rounded-xl bg-white/5 hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center border border-white/10"
              >
                <Eraser className="w-5 h-5 text-slate-400" />
              </button>
              {/* 0 */}
              <button
                disabled={isLocked}
                onClick={() => handleNumberClick('0')}
                className="h-14 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xl font-semibold transition-all disabled:opacity-40 border border-white/10 hover:border-indigo-400/40"
              >
                0
              </button>
              {/* Backspace */}
              <button
                disabled={isLocked}
                onClick={handleDelete}
                className="h-14 rounded-xl bg-white/5 hover:bg-amber-500/20 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center border border-white/10"
              >
                <Delete className="w-5 h-5 text-slate-400" />
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-slate-600 text-xs text-center mt-6">
          {HOTEL_NAME} PMS • POS Terminal • Access is logged
        </p>
      </div>

      {/* Keyframe for shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px); }
          30% { transform: translateX(8px); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-3px); }
          90% { transform: translateX(3px); }
        }
      `}</style>
    </div>
  );
};

export default POSPinGate;
