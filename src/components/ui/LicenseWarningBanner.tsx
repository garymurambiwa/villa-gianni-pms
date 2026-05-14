import React, { useState, useEffect } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { AlertTriangle, Clock } from 'lucide-react';

const LicenseWarningBanner: React.FC = () => {
    const { settings } = useSettings();
    const [timeLeft, setTimeLeft] = useState<string | null>(null);
    const [isUrgent, setIsUrgent] = useState(false);
    const [isExpired, setIsExpired] = useState(false);

    useEffect(() => {
        if (!settings.license_expiry) {
            setTimeLeft(null);
            return;
        }

        const deadline = new Date(settings.license_expiry).getTime();
        
        const updateTimer = () => {
            const now = new Date().getTime();
            const distance = deadline - now;

            if (distance <= 0) {
                setTimeLeft("EXPIRED - ACCESS RESTRICTION PENDING");
                setIsUrgent(true);
                setIsExpired(true);
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            setIsUrgent(days < 3);
            
            const timerStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
            setTimeLeft(timerStr);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [settings.license_expiry]);

    if (settings.license_warning_enabled !== true || !timeLeft) return null;

    return (
        <div className={`fixed top-0 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-2xl px-4 pt-2 transition-all duration-500 animate-in fade-in slide-in-from-top-4`}>
            <div className={`
                relative flex items-center justify-between gap-4 px-6 py-3 rounded-b-xl shadow-2xl border-x border-b
                ${isExpired 
                    ? 'bg-red-600 border-red-700 text-white' 
                    : isUrgent 
                        ? 'bg-amber-500 border-amber-600 text-white' 
                        : 'bg-slate-800 border-slate-700 text-slate-100'}
            `}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isUrgent ? 'bg-white/20' : 'bg-slate-700'}`}>
                        <AlertTriangle className={`w-5 h-5 ${isUrgent ? 'text-white' : 'text-amber-400'}`} />
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                            {isExpired ? 'System Alert' : 'License Fee Notice'}
                        </div>
                        <div className="text-sm font-bold flex items-center gap-2">
                            {isExpired ? 'Administrative Lockout Imminent' : 'Payment Due In:'}
                            {!isExpired && (
                                <span className="font-mono bg-black/20 px-2 py-0.5 rounded text-base">
                                    {timeLeft}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {isExpired && (
                    <div className="font-mono text-lg font-black animate-pulse">
                        LOCKED
                    </div>
                )}

                <div className="hidden sm:flex items-center gap-2 text-[10px] font-medium bg-white/10 px-3 py-1.5 rounded-full">
                    <Clock className="w-3 h-3" />
                    Ref: SYS-LIC-9091A
                </div>
                
                {/* Decorative glow effect for urgency */}
                {isUrgent && (
                    <div className={`absolute inset-0 rounded-b-xl -z-10 blur-xl opacity-50 ${isExpired ? 'bg-red-500' : 'bg-amber-400'}`} />
                )}
            </div>
        </div>
    );
};

export default LicenseWarningBanner;
