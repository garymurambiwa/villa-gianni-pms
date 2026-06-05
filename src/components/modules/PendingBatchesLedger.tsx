import React, { useEffect, useState } from 'react';

type Status = 'PENDING' | 'POSTED' | 'IGNORED' | 'ALL';

interface Batch {
  id: string;
  origin_table: string;
  origin_id: string;
  description: string;
  debit_gl_account: string;
  credit_gl_account: string;
  amount: number;
  status: string;
  created_at: string;
}

export function PendingBatchesLedger() {
  const [rows, setRows] = useState<Batch[]>([]);
  const [filter, setFilter] = useState<Status>('PENDING');
  const [loading, setLoading] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [toast, setToast] = useState('');

  const load = async (st: Status) => {
    setLoading(true);
    try {
      if (st === 'ALL') {
        const [p, po, ig] = await Promise.all([
          fetch('/api/gl/pending-batches?status=PENDING').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=POSTED').then(r => r.json()),
          fetch('/api/gl/pending-batches?status=IGNORED').then(r => r.json()),
        ]);
        setRows([...(p.rows||[]), ...(po.rows||[]), ...(ig.rows||[])]);
      } else {
        const r = await fetch(`/api/gl/pending-batches?status=${st}`).then(r => r.json());
        setRows(r.rows || []);
      }
    } catch (e) {
      setToast('Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);

  const updateStatus = async (id: string, status: 'POSTED' | 'IGNORED') => {
    try {
      const r = await fetch(`/api/gl/pending-batches/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Update failed');
      load(filter);
      setToast(`Batch ${status.toLowerCase()}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  const flushAll = async () => {
    setFlushing(true);
    try {
      const r = await fetch('/api/gl/pending-batches/flush', { method: 'POST' }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Flush failed');
      setToast(`Flushed ${r.flushed} batch(es)${r.errors?.length ? ` — ${r.errors.length} error(s)` : ''}`);
      load(filter);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>GL Pending Batches</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['PENDING','POSTED','IGNORED','ALL'] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ padding: '4px 12px', background: filter === s ? '#2563eb' : '#e5e7eb',
                       color: filter === s ? '#fff' : '#111', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              {s}
            </button>
          ))}
          <button
            onClick={flushAll}
            disabled={flushing || filter !== 'PENDING'}
            style={{ padding: '4px 16px', background: '#16a34a', color: '#fff',
                     border: 'none', borderRadius: 4, cursor: 'pointer', opacity: flushing ? 0.6 : 1 }}
          >
            {flushing ? 'Flushing…' : 'Flush All Pending'}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef9c3', border: '1px solid #ca8a04',
                      borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
          {toast}
          <button onClick={() => setToast('')} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {loading ? <div>Loading…</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              {['Description','Debit Acct','Credit Acct','Amount','Status','Date','Actions'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>No batches</td></tr>
            ) : rows.map(b => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px' }}>{b.description || `${b.origin_table}/${b.origin_id}`}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{b.debit_gl_account}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{b.credit_gl_account}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>${Number(b.amount).toFixed(2)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11,
                    background: b.status==='PENDING'?'#fef9c3':b.status==='POSTED'?'#dcfce7':'#f3f4f6',
                    color: b.status==='PENDING'?'#854d0e':b.status==='POSTED'?'#166534':'#374151' }}>
                    {b.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                  {new Date(b.created_at).toLocaleDateString()}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {b.status === 'PENDING' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => updateStatus(b.id, 'POSTED')}
                        style={{ padding: '2px 8px', background: '#16a34a', color: '#fff',
                                 border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                        Post
                      </button>
                      <button onClick={() => updateStatus(b.id, 'IGNORED')}
                        style={{ padding: '2px 8px', background: '#6b7280', color: '#fff',
                                 border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>
                        Ignore
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
