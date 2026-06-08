import React, { useEffect, useRef, useState } from 'react';
import { HOTEL_NAME } from '../../lib/brand';
import { Button } from '@/components/ui/button';
import {
  FileText, Printer, RefreshCw, ChevronDown, ChevronRight,
  Calendar, Moon, BarChart2, Hotel, Coffee, CheckCircle2, Download
} from 'lucide-react';

const API = '';

interface ReportEntry { date: string; files: string[] }

const FILE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  'front_office_report.txt':    { label: 'Front Office',    icon: <Hotel size={15}   />, color: '#2563eb' },
  'fnb_report.txt':             { label: 'Food & Beverage', icon: <Coffee size={15}  />, color: '#d97706' },
  'reconciliation_report.txt':  { label: 'Reconciliation',  icon: <BarChart2 size={15}/>, color: '#7c3aed' },
  'full_report.json':           { label: 'Full JSON',       icon: <FileText size={15}/>, color: '#6b7280' },
};

const NightAuditReports: React.FC = () => {
  const [reports, setReports]       = useState<ReportEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<Record<string, boolean>>({});
  const [selected, setSelected]     = useState<{ date: string; file: string } | null>(null);
  const [content, setContent]       = useState<string>('');
  const [contentLoading, setContentLoading] = useState(false);
  const [hotelName, setHotelName]   = useState(HOTEL_NAME);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/api/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT value FROM app_settings WHERE key = 'hotelName'` })
    }).then(r => r.json()).then(d => {
      if (d.ok && d.rows[0]?.value) setHotelName(d.rows[0].value);
    }).catch(() => {});

    fetchReports();
  }, []);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/night-audit/reports`);
      const d = await r.json();
      if (d.ok) {
        setReports(d.reports || []);
        // Auto-expand the most recent date
        if (d.reports?.length) {
          setExpanded({ [d.reports[0].date]: true });
        }
      }
    } catch {}
    setLoading(false);
  };

  const openFile = async (date: string, file: string) => {
    setSelected({ date, file });
    setContent('');
    setContentLoading(true);
    try {
      const r = await fetch(`${API}/api/night-audit/reports/${date}/${file}`);
      const text = await r.text();
      setContent(text);
    } catch (e: any) {
      setContent('Error loading file: ' + e.message);
    }
    setContentLoading(false);
  };

  const toggleDate = (date: string) =>
    setExpanded(e => ({ ...e, [date]: !e[date] }));

  const handlePrint = () => {
    if (!printRef.current || !selected) return;
    const meta   = FILE_META[selected.file] || { label: selected.file, color: '#111' };
    const isJson = selected.file.endsWith('.json');

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;

    const body = isJson
      ? `<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all">${escapeHtml(content)}</pre>`
      : `<pre style="font-family:'Courier New',monospace;font-size:12px;white-space:pre-wrap;line-height:1.6">${escapeHtml(content)}</pre>`;

    win.document.write(`<!DOCTYPE html><html><head>
      <title>${hotelName} – Night Audit ${selected.date} – ${meta.label}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; padding: 20px 28px; color: #111; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start;
                  border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
        .hotel { font-size: 22px; font-weight: 800; letter-spacing: 0.04em; }
        .badge { background: ${meta.color}; color: #fff; font-size: 11px; font-weight: 700;
                 padding: 3px 10px; border-radius: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
        .meta { font-size: 11px; color: #555; margin-top: 4px; }
        .footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 10px;
                  font-size: 10px; color: #999; text-align: center; }
        @media print {
          body { padding: 10px 16px; }
          .no-print { display: none !important; }
        }
      </style>
    </head><body>
      <div class="header">
        <div>
          <div class="hotel">${escapeHtml(hotelName)}</div>
          <div class="meta">Night Audit Report &nbsp;|&nbsp; Business Date: ${selected.date}</div>
        </div>
        <div style="text-align:right">
          <div class="badge">${meta.label}</div>
          <div class="meta" style="margin-top:6px">Printed: ${new Date().toLocaleString('en-ZW', { timeZone: 'Africa/Harare' })}</div>
        </div>
      </div>
      ${body}
      <div class="footer">
        ${hotelName} &nbsp;·&nbsp; Night Audit System &nbsp;·&nbsp; CONFIDENTIAL
      </div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800);};<\/script>
    </body></html>`);
    win.document.close();
  };

  const handleDownload = () => {
    if (!selected || !content) return;
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${hotelName.replace(/\s+/g, '_')}_NightAudit_${selected.date}_${selected.file}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isJson = selected?.file.endsWith('.json');

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 600, gap: 0, background: '#f8fafc', borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }}>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <div style={{ width: 240, flexShrink: 0, background: '#0f172a', color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Moon size={18} color="#fbbf24" />
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.03em' }}>Audit Reports</span>
          </div>
          <button onClick={fetchReports}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8',
                     background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading && <div style={{ padding: '16px', fontSize: 12, color: '#64748b' }}>Loading…</div>}
          {!loading && reports.length === 0 && (
            <div style={{ padding: '16px', fontSize: 12, color: '#64748b' }}>No reports yet</div>
          )}
          {reports.map(r => (
            <div key={r.date}>
              {/* Date header */}
              <button onClick={() => toggleDate(r.date)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                         background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1',
                         fontSize: 12, fontWeight: 600, letterSpacing: '0.04em' }}>
                {expanded[r.date] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Calendar size={12} color="#fbbf24" style={{ flexShrink: 0 }} />
                {r.date}
              </button>

              {/* Files */}
              {expanded[r.date] && r.files.map(file => {
                const meta   = FILE_META[file] || { label: file, color: '#6b7280', icon: <FileText size={13} /> };
                const active = selected?.date === r.date && selected?.file === file;
                return (
                  <button key={file} onClick={() => openFile(r.date, file)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 16px 6px 32px', background: active ? 'rgba(255,255,255,0.08)' : 'none',
                      border: 'none', cursor: 'pointer', fontSize: 12,
                      color: active ? '#fff' : '#94a3b8',
                      borderLeft: active ? `3px solid ${meta.color}` : '3px solid transparent',
                      transition: 'all 0.15s',
                    }}>
                    <span style={{ color: meta.color, flexShrink: 0 }}>{meta.icon}</span>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Content pane ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {selected ? (
              <>
                <span style={{ color: (FILE_META[selected.file] || {}).color || '#111' }}>
                  {(FILE_META[selected.file] || { icon: <FileText size={16} /> }).icon}
                </span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {(FILE_META[selected.file] || { label: selected.file }).label}
                </span>
                <span style={{ fontSize: 12, color: '#64748b' }}>— {selected.date}</span>
              </>
            ) : (
              <span style={{ color: '#94a3b8', fontSize: 13 }}>Select a report from the list</span>
            )}
          </div>

          {selected && content && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline" size="sm" onClick={handleDownload}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <Download size={13} /> Download
              </Button>
              <Button size="sm" onClick={handlePrint}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12,
                         background: '#0f172a', color: '#fff' }}>
                <Printer size={13} /> Print
              </Button>
            </div>
          )}
        </div>

        {/* Body */}
        <div ref={printRef} style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          height: '100%', color: '#94a3b8', gap: 12 }}>
              <Moon size={48} color="#e2e8f0" />
              <p style={{ fontSize: 14 }}>Select a date and report file to view</p>
            </div>
          )}

          {selected && contentLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', marginTop: 40,
                          justifyContent: 'center' }}>
              <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Loading report…
              <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {selected && !contentLoading && content && (
            isJson ? (
              <pre style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
                            background: '#1e293b', color: '#e2e8f0', padding: 20,
                            borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all' }}>
                {formatJson(content)}
              </pre>
            ) : (
              <pre style={{ fontFamily: '"Courier New", monospace', fontSize: 13, lineHeight: 1.8,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1e293b',
                            background: '#fff', padding: 0 }}>
                {content}
              </pre>
            )
          )}
        </div>

        {/* Status bar */}
        {selected && !contentLoading && content && (
          <div style={{ padding: '6px 16px', background: '#f1f5f9', borderTop: '1px solid #e2e8f0',
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
            <CheckCircle2 size={11} color="#22c55e" />
            {content.split('\n').length} lines &nbsp;·&nbsp; {(content.length / 1024).toFixed(1)} KB
            &nbsp;·&nbsp; {hotelName} Night Audit — CONFIDENTIAL
          </div>
        )}
      </div>
    </div>
  );
};

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatJson(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

export default NightAuditReports;
