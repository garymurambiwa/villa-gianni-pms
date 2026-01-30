// Version control types for the COREDPMS system

export interface Version {
  id: string;
  timestamp: string;
  description: string;
  createdBy: string;
  tags?: string[];
  isBackup: boolean;
}

export interface VersionedEntity<T> {
  entityId: string;
  entityType: string;
  currentVersion: string;
  versions: Record<string, VersionData<T>>;
}

export interface VersionData<T> {
  version: Version;
  data: T;
}

export interface RestoreOptions {
  selective: boolean;
  entities?: string[];
  entityTypes?: string[];
}

export interface VersionDiff {
  versionA: string;
  versionB: string;
  changes: DiffChange[];
}

export interface DiffChange {
  path: string;
  oldValue: any;
  newValue: any;
  changeType: 'added' | 'removed' | 'modified';
}

export type VersionControlAction = 
  | 'create_backup' 
  | 'restore_version' 
  | 'selective_restore' 
  | 'delete_version' 
  | 'tag_version';