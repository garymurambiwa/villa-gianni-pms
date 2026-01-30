import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import VersionDisplay from '@/components/ui/VersionDisplay';

export const FirstRunWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState<'welcome' | 'mode' | 'server-setup' | 'client-setup' | 'finish'>('welcome');
  const [mode, setMode] = useState<'server' | 'client' | null>(null);
  const [serverIp, setServerIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const { toast } = useToast();

  const handleModeSelect = (m: 'server' | 'client') => {
    setMode(m);
    if (m === 'server') {
      setStep('server-setup');
      checkLocalConnection();
    } else {
      setStep('client-setup');
    }
  };

  const checkLocalConnection = async () => {
    setTesting(true);
    try {
      const { connectionString } = await (window as any).native.db.getConnectionString();
      if (connectionString && (connectionString.includes('127.0.0.1') || connectionString.includes('localhost'))) {
         setTestResult({ ok: true, message: 'Local Database is running and ready.' });
      } else {
         // Try to connect anyway, maybe it is running but not yet fully reported or uses different string
         const res = await (window as any).native.db.testConnection();
         if (res.ok) {
           setTestResult({ ok: true, message: 'Local Database is running.' });
         } else {
           setTestResult({ ok: false, message: 'Local Database not detected. Ensure COREPMS is running.' });
         }
      }
    } catch (e: any) {
       setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleClientConnect = async () => {
    if (!serverIp) {
      toast({ title: "Validation Error", description: "Server IP is required", variant: "destructive" });
      return;
    }
    setTesting(true);
    // Default port 54320 for bundled DB
    const connStr = `postgresql://postgres:corepms_local@${serverIp}:54320/corepms_db`;
    try {
      const res = await (window as any).native.db.testConnection({ connectionString: connStr });
      if (res.ok) {
        setTestResult({ ok: true, message: `Connected to ${serverIp} successfully!` });
        await (window as any).native.db.setConnectionString(connStr);
      } else {
        setTestResult({ ok: false, message: res.error || 'Connection failed. Check firewall and IP.' });
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const finish = async () => {
    await (window as any).native.db.completeFirstRun();
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/90 flex items-center justify-center z-50 p-4 animate-in fade-in duration-300">
      <Card className="w-full max-w-md shadow-2xl border-indigo-200">
        <CardHeader className="bg-slate-50 rounded-t-lg border-b mb-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl text-indigo-700">Welcome to COREPMS</CardTitle>
              <CardDescription>Initial Setup Wizard</CardDescription>
            </div>
            <VersionDisplay className="mt-1 text-gray-600" />
          </div>
        </CardHeader>
        <CardContent>
          {step === 'welcome' && (
            <div className="space-y-4 py-4">
              <p className="text-lg">Thank you for installing COREPMS.</p>
              <p className="text-muted-foreground">We need to set up your database connection. This will only take a moment.</p>
            </div>
          )}

          {step === 'mode' && (
            <div className="grid grid-cols-1 gap-4 py-2">
              <Button variant="outline" className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-indigo-50 hover:border-indigo-300 transition-all" onClick={() => handleModeSelect('server')}>
                <span className="text-lg font-bold text-indigo-900">Main Server</span>
                <span className="text-xs text-muted-foreground font-normal text-center px-4">This computer will store the data. Choose this for single-computer setup.</span>
              </Button>
              <Button variant="outline" className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-indigo-50 hover:border-indigo-300 transition-all" onClick={() => handleModeSelect('client')}>
                <span className="text-lg font-bold text-indigo-900">Workstation Client</span>
                <span className="text-xs text-muted-foreground font-normal text-center px-4">Connect to an existing COREPMS server on the network.</span>
              </Button>
            </div>
          )}

          {step === 'server-setup' && (
            <div className="space-y-4">
              <p className="font-medium">Checking local database status...</p>
              {testing && <div className="flex justify-center py-4"><LoadingSpinner /></div>}
              {testResult && (
                <div className={`p-4 rounded-lg border flex items-start gap-3 ${testResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  <div className={`mt-1 w-2 h-2 rounded-full ${testResult.ok ? 'bg-green-600' : 'bg-red-600'}`} />
                  <div>{testResult.message}</div>
                </div>
              )}
              {testResult?.ok && (
                 <p className="text-sm text-muted-foreground mt-4 bg-slate-50 p-3 rounded border">
                   <strong>Tip:</strong> Other computers can connect to this server using your Local IP address.
                   Ensure port <strong>54320</strong> is allowed through your firewall.
                 </p>
              )}
            </div>
          )}

          {step === 'client-setup' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Server IP Address</Label>
                <Input 
                  placeholder="e.g. 192.168.1.100" 
                  value={serverIp} 
                  onChange={(e) => setServerIp(e.target.value)} 
                  className="text-lg font-mono"
                />
                <p className="text-xs text-muted-foreground">Enter the IP address of the computer running COREPMS Main Server.</p>
              </div>
              <Button onClick={handleClientConnect} disabled={testing} className="w-full h-12 text-lg">
                {testing ? 'Connecting...' : 'Test & Save Connection'}
              </Button>
              {testResult && (
                <div className={`p-4 rounded-lg border ${testResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {testResult.message}
                </div>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between border-t pt-4 bg-slate-50 rounded-b-lg">
           {step !== 'welcome' && (
             <Button variant="ghost" onClick={() => {
               if (step === 'mode') setStep('welcome');
               else if (step === 'server-setup' || step === 'client-setup') setStep('mode');
             }}>Back</Button>
           )}
           <div className="ml-auto">
             {step === 'welcome' && <Button onClick={() => setStep('mode')} size="lg">Get Started</Button>}
             {step === 'server-setup' && testResult?.ok && <Button onClick={finish} size="lg" className="bg-green-600 hover:bg-green-700">Finish Setup</Button>}
             {step === 'client-setup' && testResult?.ok && <Button onClick={finish} size="lg" className="bg-green-600 hover:bg-green-700">Finish Setup</Button>}
           </div>
        </CardFooter>
      </Card>
    </div>
  );
};
