import React, { useState } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Version, VersionDiff } from '../../types/versionControl';
import { compareVersions } from '../../lib/versionControlService';

interface VersionHistoryDetailProps {
  entityId: string;
  version: Version;
  onRestore: () => void;
  onCompare: () => void;
  onDelete: () => void;
}

const VersionHistoryDetail: React.FC<VersionHistoryDetailProps> = ({
  entityId,
  version,
  onRestore,
  onCompare,
  onDelete
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [diffWithCurrent, setDiffWithCurrent] = useState<VersionDiff | null>(null);

  const handleViewDiff = () => {
    // Compare with current version
    try {
      const diff = compareVersions(entityId, version.id, 'current');
      setDiffWithCurrent(diff);
      setShowDetails(true);
    } catch (error) {
      console.error('Failed to compare versions:', error);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  };

  const getChangeTypeColor = (changeType: string) => {
    switch (changeType) {
      case 'added': return 'bg-green-100 text-green-800';
      case 'removed': return 'bg-red-100 text-red-800';
      case 'modified': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="w-full mb-4">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">
              Version {version.id.substring(0, 8)}
              {version.isBackup && (
                <Badge className="ml-2 bg-blue-500">Backup</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {formatTimestamp(version.timestamp)}
            </CardDescription>
          </div>
          <Badge variant={version.tags?.includes('current') ? 'default' : 'outline'}>
            {version.tags?.includes('current') ? 'Current' : 'Historical'}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="mb-4">
          <h4 className="text-sm font-medium mb-1">Description</h4>
          <p className="text-sm text-gray-700">{version.description || 'No description provided'}</p>
        </div>
        
        <div className="mb-4">
          <h4 className="text-sm font-medium mb-1">Created By</h4>
          <p className="text-sm text-gray-700">{version.createdBy}</p>
        </div>
        
        {version.tags && version.tags.length > 0 && (
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-1">Tags</h4>
            <div className="flex flex-wrap gap-1">
              {version.tags.map((tag, index) => (
                <Badge key={index} variant="outline">{tag}</Badge>
              ))}
            </div>
          </div>
        )}
        
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleViewDiff}
          className="mt-2"
        >
          {showDetails ? 'Hide Details' : 'View Changes'}
        </Button>
        
        {showDetails && diffWithCurrent && (
          <Accordion type="single" collapsible className="mt-4">
            <AccordionItem value="changes">
              <AccordionTrigger>Changes ({diffWithCurrent.changes.length})</AccordionTrigger>
              <AccordionContent>
                {diffWithCurrent.changes.length === 0 ? (
                  <p className="text-sm text-gray-500">No changes detected</p>
                ) : (
                  <div className="space-y-2">
                    {diffWithCurrent.changes.map((change, index) => (
                      <div key={index} className="p-2 rounded border">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">{change.path}</span>
                          <span className={`text-xs px-2 py-1 rounded ${getChangeTypeColor(change.changeType)}`}>
                            {change.changeType}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="font-medium mb-1">Previous</div>
                            <pre className="bg-gray-50 p-2 rounded overflow-x-auto">
                              {JSON.stringify(change.oldValue, null, 2) || 'undefined'}
                            </pre>
                          </div>
                          <div>
                            <div className="font-medium mb-1">Current</div>
                            <pre className="bg-gray-50 p-2 rounded overflow-x-auto">
                              {JSON.stringify(change.newValue, null, 2) || 'undefined'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between">
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={onCompare}>
            Compare
          </Button>
          <Button variant="outline" size="sm" onClick={onRestore}>
            Restore
          </Button>
        </div>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
};

export default VersionHistoryDetail;