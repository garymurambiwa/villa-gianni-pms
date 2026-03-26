import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Delete, Eraser } from 'lucide-react';

interface PINModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: any) => void;
  title?: string;
  verifyPin: (pin: string) => Promise<{ success: boolean; user?: any; error?: string }>;
}

export const PINModal: React.FC<PINModalProps> = ({ isOpen, onClose, onSuccess, title = "Enter POS PIN", verifyPin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pin.length === 6) {
      handleVerify();
    }
  }, [pin]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
      setError(null);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
    setError(null);
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await verifyPin(pin);
      if (res.success) {
        onSuccess(res.user);
        setPin('');
      } else {
        setError(res.error || 'Invalid PIN');
        setPin('');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md border border-slate-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-6 w-6" />
          </Button>
        </div>

        <div className="flex justify-center gap-3 mb-8">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={`w-12 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all duration-200 ${
                pin.length > i 
                  ? 'border-blue-500 bg-blue-50 text-blue-600 shadow-inner' 
                  : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            >
              {pin[i] ? '●' : ''}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-6 text-center text-sm font-medium animate-in slide-in-from-top-2 duration-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <Button
              key={num}
              variant="outline"
              size="lg"
              onClick={() => handleNumberClick(num.toString())}
              className="h-16 text-2xl font-medium rounded-xl hover:bg-slate-100 hover:text-blue-600 active:scale-95 transition-all"
            >
              {num}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="lg"
            onClick={handleClear}
            className="h-16 rounded-xl hover:bg-red-50 hover:text-red-600 group active:scale-95 transition-all"
          >
            <Eraser className="h-6 w-6 group-hover:scale-110 transition-transform" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => handleNumberClick('0')}
            className="h-16 text-2xl font-medium rounded-xl hover:bg-slate-100 hover:text-blue-600 active:scale-95 transition-all"
          >
            0
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={handleDelete}
            className="h-16 rounded-xl hover:bg-amber-50 hover:text-amber-600 group active:scale-95 transition-all"
          >
            <Delete className="h-6 w-6 group-hover:scale-110 transition-transform" />
          </Button>
        </div>

        <div className="mt-8 text-center text-slate-400 text-sm">
          Please enter your 6-digit security PIN to proceed
        </div>
      </div>
    </div>
  );
};
