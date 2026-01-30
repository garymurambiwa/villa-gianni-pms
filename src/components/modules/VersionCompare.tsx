import React from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from '../ui/card';
import { Badge } from '../ui/badge';
import { VersionDiff } from '../../types/versionControl';

interface VersionCompareProps {
  diff: VersionDiff;
  versionAName: string;
  versionBName: string;
}

const VersionCompare: React.FC<VersionCompareProps> = ({
  diff,
  versionAName,
  versionBName
}) => {
  const getChangeTypeColor = (changeType: string) => {
    switch (changeType) {
      case 'added': return 'bg-green-100 text-green-800';
      case 'removed': return 'bg-red-100 text-red-800';
      case 'modified': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">
          Comparing {versionAName} with {versionBName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {diff.changes.length === 0 ? (
          <div className="p-4 text-center bg-gray-50 rounded-md">
            <p className="text-gray-500">No differences found between these versions.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {diff.changes.map((change, index) => (
              <div key={index} className="border rounded-md overflow-hidden">
                <div className="flex justify-between items-center p-3 bg-gray-50 border-b">
                  <span className="font-medium">{change.path}</span>
                  <Badge className={getChangeTypeColor(change.changeType)}>
                    {change.changeType}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 divide-x">
                  <div className="p-3">
                    <div className="text-xs text-gray-500 mb-1">Version A</div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(change.oldValue, null, 2) || 'undefined'}
                    </pre>
                  </div>
                  <div className="p-3">
                    <div className="text-xs text-gray-500 mb-1">Version B</div>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                      {JSON.stringify(change.newValue, null, 2) || 'undefined'}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VersionCompare;