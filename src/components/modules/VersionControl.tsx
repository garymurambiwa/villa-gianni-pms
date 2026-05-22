import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { toast } from 'sonner';
import { fetchApi } from '../../lib/apiService';

interface CodeVersion {
  id: number;
  label: string;
  deployment_id: string | null;
  deployment_url: string | null;
  created_at: string;
  created_by: string;
  notes: string | null;
}

const VersionControl: React.FC = () => {
  const [versions, setVersions] = useState<CodeVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CodeVersion | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<CodeVersion | null>(null);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi('/api/version/list');
      if (data.ok) setVersions(data.versions || []);
      else toast.error(data.error || 'Failed to load versions');
    } catch (e: any) {
      toast.error(e.message || 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const handleSaveSnapshot = async () => {
    setSaving(true);
    try {
      const data = await fetchApi('/api/version/snapshot', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim() || undefined, notes: notes.trim() || undefined, createdBy: 'staff' }),
      });
      if (data.ok) {
        toast.success(`Snapshot "${data.version.label}" saved successfully.`);
        setLabel('');
        setNotes('');
        loadVersions();
      } else {
        toast.error(data.error || 'Failed to save snapshot');
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save snapshot');
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (version: CodeVersion) => {
    setRestoring(version.id);
    setRestoreConfirm(null);
    try {
      const data = await fetchApi('/api/version/restore', {
        method: 'POST',
        body: JSON.stringify({ versionId: version.id }),
      });
      if (data.ok) {
        toast.success(data.message || `Restore initiated for "${version.label}".`);
      } else {
        toast.error(data.error || 'Restore failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Restore failed');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (version: CodeVersion) => {
    setDeleteConfirm(null);
    try {
      const data = await fetchApi(`/api/version/${version.id}`, { method: 'DELETE' });
      if (data.ok) {
        toast.success(`Snapshot "${version.label}" deleted.`);
        loadVersions();
      } else {
        toast.error(data.error || 'Delete failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Code Version Control</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Save a snapshot of the current working system. If something breaks after changes, restore any previous snapshot to roll the code back — your data is never affected.
        </p>
      </div>

      {/* Save snapshot panel */}
      <div className="border rounded-lg p-5 space-y-4 bg-card">
        <h2 className="font-semibold text-lg">Save Current Version</h2>
        <div className="space-y-2">
          <Label htmlFor="snap-label">Label (optional)</Label>
          <Input
            id="snap-label"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={`e.g. "Before price changes — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}"`}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="snap-notes">Notes (optional)</Label>
          <Input
            id="snap-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What's working well right now?"
          />
        </div>
        <Button onClick={handleSaveSnapshot} disabled={saving} className="w-full sm:w-auto">
          {saving ? 'Saving snapshot...' : 'Save Snapshot'}
        </Button>
      </div>

      {/* Version history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Saved Snapshots</h2>
          <Button variant="outline" size="sm" onClick={loadVersions} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        {loading && versions.length === 0 && (
          <p className="text-muted-foreground text-sm py-4">Loading...</p>
        )}

        {!loading && versions.length === 0 && (
          <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
            No snapshots saved yet. Press "Save Snapshot" above to record the current code version.
          </div>
        )}

        {versions.map((v, i) => (
          <div key={v.id} className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{v.label}</span>
                {i === 0 && (
                  <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">Latest</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {fmt(v.created_at)} · Saved by {v.created_by}
                {v.notes && <span> · {v.notes}</span>}
              </div>
              {v.deployment_url && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  Deployment: <span className="font-mono">{v.deployment_url}</span>
                </div>
              )}
              {!v.deployment_id && (
                <div className="text-xs text-amber-600 mt-0.5">No deployment ID — restore may not be available</div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRestoreConfirm(v)}
                disabled={restoring === v.id}
              >
                {restoring === v.id ? 'Restoring...' : 'Restore'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteConfirm(v)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Restore confirmation dialog */}
      <Dialog open={!!restoreConfirm} onOpenChange={() => setRestoreConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore "{restoreConfirm?.label}"?</DialogTitle>
            <DialogDescription>
              This will roll the site's code back to the snapshot saved on{' '}
              <strong>{restoreConfirm ? fmt(restoreConfirm.created_at) : ''}</strong>.
              <br /><br />
              All database data (reservations, transactions, guests, inventory) is kept exactly as it is — only the code changes.
              The site will be back online in about 30 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreConfirm(null)}>Cancel</Button>
            <Button onClick={() => restoreConfirm && handleRestore(restoreConfirm)}>
              Yes, Restore This Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete snapshot?</DialogTitle>
            <DialogDescription>
              Remove "{deleteConfirm?.label}" from the list. The actual deployment on Vercel is not deleted — you just won't be able to restore to this point from inside the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VersionControl;
