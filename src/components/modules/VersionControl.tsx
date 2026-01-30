import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '../ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '../ui/dialog';
import { useToast } from '../../hooks/use-toast';
import { Version } from '../../types/versionControl';
import { 
  getVersions, 
  getCurrentVersion, 
  restoreVersion, 
  createVersion, 
  compareVersions, 
  deleteVersion, 
  tagVersion 
} from '../../lib/versionControlService';
import { 
  createEntityBackup, 
  scheduleAutomaticBackups, 
  stopAutomaticBackups, 
  getBackupSchedule, 
  updateBackupSchedule 
} from '../../lib/backupUtils';

// Mock data for demonstration
const MOCK_ENTITIES = [
  { id: 'folio-1', type: 'folio', name: 'Guest Folio - John Smith' },
  { id: 'reservation-1', type: 'reservation', name: 'Reservation #12345' },
  { id: 'inventory-1', type: 'inventory', name: 'Room Inventory' }
];

const VersionControl: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('history');
  const [selectedEntity, setSelectedEntity] = useState(MOCK_ENTITIES[0]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [comparisonVersion, setComparisonVersion] = useState<Version | null>(null);
  const [backupDescription, setBackupDescription] = useState('');
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [selectiveRestore, setSelectiveRestore] = useState(false);
  const [backupInterval, setBackupInterval] = useState(60); // minutes
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);

  // Load versions when entity changes
  useEffect(() => {
    if (selectedEntity) {
      const entityVersions = getVersions(selectedEntity.id);
      setVersions(entityVersions);
      setSelectedVersion(null);
      setComparisonVersion(null);
      
      // Check if auto backup is enabled
      const schedule = getBackupSchedule(selectedEntity.id);
      if (schedule) {
        setAutoBackupEnabled(schedule.enabled);
        setBackupInterval(schedule.intervalMinutes);
      } else {
        setAutoBackupEnabled(false);
        setBackupInterval(60);
      }
    }
  }, [selectedEntity]);

  // Create a manual backup
  const handleCreateBackup = () => {
    if (!selectedEntity) return;
    
    // In a real app, we would get the actual data
    const mockData = { id: selectedEntity.id, name: selectedEntity.name, timestamp: new Date().toISOString() };
    
    try {
      createEntityBackup(
        selectedEntity.id,
        selectedEntity.type,
        mockData,
        'current-user', // In a real app, get from auth context
        backupDescription || 'Manual backup'
      );
      
      // Refresh versions
      const entityVersions = getVersions(selectedEntity.id);
      setVersions(entityVersions);
      
      toast({
        title: 'Backup created',
        description: 'A new backup version has been created successfully.',
      });
      
      setBackupDescription('');
    } catch (error) {
      toast({
        title: 'Backup failed',
        description: 'There was an error creating the backup.',
        variant: 'destructive'
      });
    }
  };

  // Toggle automatic backups
  const handleToggleAutoBackup = () => {
    if (!selectedEntity) return;
    
    if (!autoBackupEnabled) {
      // Enable auto backup
      scheduleAutomaticBackups(
        selectedEntity.id,
        selectedEntity.type,
        backupInterval,
        'current-user' // In a real app, get from auth context
      );
      setAutoBackupEnabled(true);
      
      toast({
        title: 'Automatic backups enabled',
        description: `Backups will be created every ${backupInterval} minutes.`,
      });
    } else {
      // Disable auto backup
      stopAutomaticBackups(selectedEntity.id);
      setAutoBackupEnabled(false);
      
      toast({
        title: 'Automatic backups disabled',
        description: 'Automatic backups have been turned off.',
      });
    }
  };

  // Update backup interval
  const handleUpdateBackupInterval = () => {
    if (!selectedEntity || !autoBackupEnabled) return;
    
    updateBackupSchedule(selectedEntity.id, { intervalMinutes: backupInterval });
    
    toast({
      title: 'Backup schedule updated',
      description: `Backups will now be created every ${backupInterval} minutes.`,
    });
  };

  // Restore a version
  const handleRestoreVersion = () => {
    if (!selectedEntity || !selectedVersion) return;
    
    try {
      restoreVersion(selectedEntity.id, selectedVersion.id, { selective: selectiveRestore });
      
      toast({
        title: 'Version restored',
        description: `Successfully restored to version from ${new Date(selectedVersion.timestamp).toLocaleString()}.`,
      });
      
      setShowRestoreDialog(false);
    } catch (error) {
      toast({
        title: 'Restore failed',
        description: 'There was an error restoring the version.',
        variant: 'destructive'
      });
    }
  };

  // Compare versions
  const handleCompareVersions = () => {
    if (!selectedEntity || !selectedVersion || !comparisonVersion) return;
    
    const result = compareVersions(
      selectedEntity.id,
      selectedVersion.id,
      comparisonVersion.id
    );
    
    setComparisonResult(result);
    setActiveTab('compare');
  };

  // Delete a version
  const handleDeleteVersion = (version: Version) => {
    if (!selectedEntity) return;
    
    try {
      deleteVersion(selectedEntity.id, version.id);
      
      // Refresh versions
      const entityVersions = getVersions(selectedEntity.id);
      setVersions(entityVersions);
      
      if (selectedVersion?.id === version.id) {
        setSelectedVersion(null);
      }
      
      if (comparisonVersion?.id === version.id) {
        setComparisonVersion(null);
      }
      
      toast({
        title: 'Version deleted',
        description: 'The selected version has been deleted.',
      });
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: 'There was an error deleting the version.',
        variant: 'destructive'
      });
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Version Control System</h1>
      
      <div className="flex mb-4 space-x-4">
        <div className="w-1/3">
          <Label htmlFor="entity-select">Select Entity</Label>
          <select
            id="entity-select"
            className="w-full p-2 border rounded"
            value={selectedEntity.id}
            onChange={(e) => {
              const entity = MOCK_ENTITIES.find(entity => entity.id === e.target.value);
              if (entity) setSelectedEntity(entity);
            }}
          >
            {MOCK_ENTITIES.map(entity => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="history">Version History</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="restore">Restore</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>
        
        <TabsContent value="history" className="p-4 border rounded-md mt-2">
          <h2 className="text-xl font-semibold mb-4">Version History</h2>
          
          {versions.length === 0 ? (
            <p>No versions found for this entity.</p>
          ) : (
            <Table>
              <TableCaption>Version history for {selectedEntity.name}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map(version => (
                  <TableRow 
                    key={version.id}
                    className={selectedVersion?.id === version.id ? 'bg-muted' : ''}
                  >
                    <TableCell>{version.id.substring(0, 8)}...</TableCell>
                    <TableCell>{new Date(version.timestamp).toLocaleString()}</TableCell>
                    <TableCell>{version.description}</TableCell>
                    <TableCell>{version.createdBy}</TableCell>
                    <TableCell>{version.isBackup ? 'Backup' : 'Change'}</TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedVersion(version)}
                        >
                          Select
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => handleDeleteVersion(version)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          
          {selectedVersion && (
            <div className="mt-4 p-4 border rounded-md">
              <h3 className="text-lg font-semibold">Selected Version</h3>
              <p>ID: {selectedVersion.id}</p>
              <p>Date: {new Date(selectedVersion.timestamp).toLocaleString()}</p>
              <p>Description: {selectedVersion.description}</p>
              
              <div className="flex space-x-2 mt-4">
                <Button onClick={() => setShowRestoreDialog(true)}>
                  Restore This Version
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setActiveTab('compare')}
                  disabled={!selectedVersion}
                >
                  Compare With Another Version
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="backup" className="p-4 border rounded-md mt-2">
          <h2 className="text-xl font-semibold mb-4">Create Backup</h2>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="backup-description">Backup Description</Label>
              <Input
                id="backup-description"
                value={backupDescription}
                onChange={(e) => setBackupDescription(e.target.value)}
                placeholder="Enter a description for this backup"
              />
            </div>
            
            <Button onClick={handleCreateBackup}>
              Create Manual Backup
            </Button>
            
            <div className="border-t pt-4 mt-6">
              <h3 className="text-lg font-semibold mb-2">Automatic Backups</h3>
              
              <div className="flex items-center space-x-2 mb-4">
                <Checkbox
                  id="auto-backup"
                  checked={autoBackupEnabled}
                  onCheckedChange={() => handleToggleAutoBackup()}
                />
                <Label htmlFor="auto-backup">Enable automatic backups</Label>
              </div>
              
              {autoBackupEnabled && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="backup-interval">Backup Interval (minutes)</Label>
                    <div className="flex space-x-2">
                      <Input
                        id="backup-interval"
                        type="number"
                        min={5}
                        value={backupInterval}
                        onChange={(e) => setBackupInterval(parseInt(e.target.value))}
                      />
                      <Button onClick={handleUpdateBackupInterval}>
                        Update
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="restore" className="p-4 border rounded-md mt-2">
          <h2 className="text-xl font-semibold mb-4">Restore Version</h2>
          
          {versions.length === 0 ? (
            <p>No versions available to restore.</p>
          ) : (
            <>
              <p className="mb-4">Select a version from the Version History tab to restore.</p>
              
              {selectedVersion ? (
                <div className="p-4 border rounded-md">
                  <h3 className="text-lg font-semibold">Selected Version</h3>
                  <p>ID: {selectedVersion.id}</p>
                  <p>Date: {new Date(selectedVersion.timestamp).toLocaleString()}</p>
                  <p>Description: {selectedVersion.description}</p>
                  
                  <Button 
                    className="mt-4"
                    onClick={() => setShowRestoreDialog(true)}
                  >
                    Restore This Version
                  </Button>
                </div>
              ) : (
                <p>No version selected. Please select a version from the Version History tab.</p>
              )}
            </>
          )}
        </TabsContent>
        
        <TabsContent value="compare" className="p-4 border rounded-md mt-2">
          <h2 className="text-xl font-semibold mb-4">Compare Versions</h2>
          
          {versions.length < 2 ? (
            <p>Need at least two versions to compare.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Version A</Label>
                  <select
                    className="w-full p-2 border rounded"
                    value={selectedVersion?.id || ''}
                    onChange={(e) => {
                      const version = versions.find(v => v.id === e.target.value);
                      if (version) setSelectedVersion(version);
                    }}
                  >
                    <option value="">Select a version</option>
                    {versions.map(version => (
                      <option key={version.id} value={version.id}>
                        {new Date(version.timestamp).toLocaleString()} - {version.description}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <Label>Version B</Label>
                  <select
                    className="w-full p-2 border rounded"
                    value={comparisonVersion?.id || ''}
                    onChange={(e) => {
                      const version = versions.find(v => v.id === e.target.value);
                      if (version) setComparisonVersion(version);
                    }}
                  >
                    <option value="">Select a version</option>
                    {versions.map(version => (
                      <option key={version.id} value={version.id}>
                        {new Date(version.timestamp).toLocaleString()} - {version.description}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <Button
                onClick={handleCompareVersions}
                disabled={!selectedVersion || !comparisonVersion}
              >
                Compare Versions
              </Button>
              
              {comparisonResult && (
                <div className="mt-4 p-4 border rounded-md">
                  <h3 className="text-lg font-semibold mb-2">Comparison Results</h3>
                  
                  {comparisonResult.changes.length === 0 ? (
                    <p>No differences found between these versions.</p>
                  ) : (
                    <Table>
                      <TableCaption>Changes between versions</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead>Change Type</TableHead>
                          <TableHead>Old Value</TableHead>
                          <TableHead>New Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comparisonResult.changes.map((change: any, index: number) => (
                          <TableRow key={index}>
                            <TableCell>{change.path}</TableCell>
                            <TableCell>
                              <span className={
                                change.changeType === 'added' ? 'text-green-500' :
                                change.changeType === 'removed' ? 'text-red-500' :
                                'text-amber-500'
                              }>
                                {change.changeType}
                              </span>
                            </TableCell>
                            <TableCell>{JSON.stringify(change.oldValue)}</TableCell>
                            <TableCell>{JSON.stringify(change.newValue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Restore Confirmation Dialog */}
      <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Version</DialogTitle>
            <DialogDescription>
              Are you sure you want to restore to this version? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="selective-restore"
                checked={selectiveRestore}
                onCheckedChange={(checked) => setSelectiveRestore(!!checked)}
              />
              <Label htmlFor="selective-restore">
                Selective restore (only restore specific parts)
              </Label>
            </div>
            
            {selectiveRestore && (
              <div className="mt-4 p-2 border rounded-md">
                <p className="text-sm text-muted-foreground">
                  In a real implementation, you would be able to select specific
                  fields or sections to restore.
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRestoreDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRestoreVersion}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default VersionControl;