import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { Version, VersionDiff } from '../../types/versionControl';
import { compareVersions } from '../../lib/versionControlService';

interface SelectiveRestorePanelProps {
  entityId: string;
  version: Version;
  onRestore: (paths: string[]) => void;
  onCancel: () => void;
}

const SelectiveRestorePanel: React.FC<SelectiveRestorePanelProps> = ({
  entityId,
  version,
  onRestore,
  onCancel
}) => {
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Load diff on component mount
  React.useEffect(() => {
    const loadDiff = async () => {
      try {
        const result = compareVersions(entityId, version.id, 'current');
        setDiff(result);
        // By default, select all paths
        setSelectedPaths(result.changes.map(change => change.path));
      } catch (error) {
        console.error('Failed to load version differences:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDiff();
  }, [entityId, version.id]);

  const handleTogglePath = (path: string) => {
    setSelectedPaths(prev => 
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  const handleToggleAll = () => {
    if (!diff) return;
    
    if (selectedPaths.length === diff.changes.length) {
      // Deselect all
      setSelectedPaths([]);
    } else {
      // Select all
      setSelectedPaths(diff.changes.map(change => change.path));
    }
  };

  const handleRestore = () => {
    onRestore(selectedPaths);
  };

  if (loading) {
    return <div className="p-4 text-center">Loading changes...</div>;
  }

  if (!diff || diff.changes.length === 0) {
    return (
      <div className="p-4">
        <p>No changes detected between this version and the current version.</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold mb-4">Selective Restore</h3>
      <p className="mb-4">
        Select which changes you want to restore from version {version.id.substring(0, 8)}
      </p>
      
      <div className="mb-4 flex items-center">
        <Checkbox 
          id="select-all"
          checked={selectedPaths.length === diff.changes.length}
          onCheckedChange={handleToggleAll}
        />
        <Label htmlFor="select-all" className="ml-2">
          Select All Changes
        </Label>
      </div>
      
      <div className="space-y-3 max-h-96 overflow-y-auto p-2">
        {diff.changes.map((change, index) => (
          <Card key={index}>
            <CardContent className="p-3">
              <div className="flex items-start">
                <Checkbox 
                  id={`change-${index}`}
                  checked={selectedPaths.includes(change.path)}
                  onCheckedChange={() => handleTogglePath(change.path)}
                  className="mt-1"
                />
                <div className="ml-2 flex-1">
                  <Label htmlFor={`change-${index}`} className="font-medium">
                    {change.path}
                  </Label>
                  <div className="text-xs text-muted-foreground mt-1">
                    {change.changeType === 'added' && 'Added in current version'}
                    {change.changeType === 'removed' && 'Removed in current version'}
                    {change.changeType === 'modified' && 'Modified since this version'}
                  </div>
                  
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="font-medium mb-1">Version Value</div>
                      <pre className="bg-gray-50 p-2 rounded overflow-x-auto text-xs">
                        {JSON.stringify(change.oldValue, null, 2) || 'undefined'}
                      </pre>
                    </div>
                    <div>
                      <div className="font-medium mb-1">Current Value</div>
                      <pre className="bg-gray-50 p-2 rounded overflow-x-auto text-xs">
                        {JSON.stringify(change.newValue, null, 2) || 'undefined'}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="mt-6 flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          onClick={handleRestore}
          disabled={selectedPaths.length === 0}
        >
          Restore Selected ({selectedPaths.length})
        </Button>
      </div>
    </div>
  );
};

export default SelectiveRestorePanel;