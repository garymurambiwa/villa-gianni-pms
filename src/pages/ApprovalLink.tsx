import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import wf from '@/lib/approvalWorkflow';

const ApprovalLink: React.FC = () => {
  const { id, token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = React.useState<'idle'|'loading'|'done'|'error'>('idle');
  const [message, setMessage] = React.useState<string>('');

  const approve = async () => {
    if (!id) return;
    setStatus('loading'); setMessage('');
    try {
      // In real setups, token validates actor; for demo, use token or placeholder
      const actorId = String(token || 'admin_via_link');
      await wf.approveRequest(id, actorId);
      setStatus('done');
      setMessage('Approval completed successfully.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Approval failed.');
    }
  };

  const reject = async () => {
    if (!id) return;
    setStatus('loading'); setMessage('');
    try {
      const actorId = String(token || 'admin_via_link');
      await wf.rejectRequest(id, actorId);
      setStatus('done');
      setMessage('Request rejected.');
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message || 'Rejection failed.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="p-6 rounded-lg border bg-card shadow-md w-[420px]">
        <h1 className="text-xl font-semibold mb-3">Admin Approval</h1>
        <p className="text-sm text-card-foreground mb-4">Request ID: <code>{id}</code></p>
        {message && (
          <div className={`text-sm p-2 mb-3 rounded ${status==='error'?'bg-red-50 text-red-700':'bg-green-50 text-green-700'}`}>{message}</div>
        )}
        <div className="flex gap-2">
          <Button onClick={approve} disabled={status==='loading'}>Approve</Button>
          <Button variant="outline" onClick={reject} disabled={status==='loading'}>Reject</Button>
          <Button variant="ghost" onClick={()=> navigate('/')}>Back</Button>
        </div>
      </div>
    </div>
  );
};

export default ApprovalLink;
