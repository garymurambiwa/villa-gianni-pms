import { v4 as uuidv4 } from 'uuid';
import { 
  Version, 
  VersionedEntity, 
  VersionData, 
  RestoreOptions, 
  VersionDiff, 
  DiffChange 
} from '../types/versionControl';

// In-memory storage for versions (in a real app, this would use a database)
const versionStore: Record<string, VersionedEntity<any>> = {};

/**
 * Creates a new version for an entity
 */
export const createVersion = <T>(
  entityId: string,
  entityType: string,
  data: T,
  description: string,
  createdBy: string,
  isBackup: boolean = false,
  tags: string[] = []
): Version => {
  const versionId = uuidv4();
  const timestamp = new Date().toISOString();
  
  const version: Version = {
    id: versionId,
    timestamp,
    description,
    createdBy,
    tags,
    isBackup
  };
  
  // Get or create versioned entity
  if (!versionStore[entityId]) {
    versionStore[entityId] = {
      entityId,
      entityType,
      currentVersion: versionId,
      versions: {}
    };
  }
  
  // Add new version
  versionStore[entityId].versions[versionId] = {
    version,
    data: JSON.parse(JSON.stringify(data)) // Deep clone to prevent reference issues
  };
  
  // Update current version
  versionStore[entityId].currentVersion = versionId;
  
  return version;
};

/**
 * Creates a backup version of an entity
 */
export const createBackup = <T>(
  entityId: string,
  entityType: string,
  data: T,
  createdBy: string,
  description: string = 'Automatic backup'
): Version => {
  return createVersion(
    entityId,
    entityType,
    data,
    description,
    createdBy,
    true // isBackup = true
  );
};

/**
 * Gets all versions for an entity
 */
export const getVersions = (entityId: string): Version[] => {
  if (!versionStore[entityId]) {
    return [];
  }
  
  return Object.values(versionStore[entityId].versions)
    .map(versionData => versionData.version)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

/**
 * Gets a specific version of an entity
 */
export const getVersion = <T>(entityId: string, versionId: string): T | null => {
  if (!versionStore[entityId] || !versionStore[entityId].versions[versionId]) {
    return null;
  }
  
  return JSON.parse(JSON.stringify(versionStore[entityId].versions[versionId].data));
};

/**
 * Gets the current version of an entity
 */
export const getCurrentVersion = <T>(entityId: string): T | null => {
  if (!versionStore[entityId]) {
    return null;
  }
  
  const currentVersionId = versionStore[entityId].currentVersion;
  return getVersion(entityId, currentVersionId);
};

/**
 * Restores an entity to a specific version
 */
export const restoreVersion = <T>(
  entityId: string, 
  versionId: string,
  options: RestoreOptions = { selective: false }
): boolean => {
  if (!versionStore[entityId] || !versionStore[entityId].versions[versionId]) {
    return false;
  }
  
  if (!options.selective) {
    // Full restore
    versionStore[entityId].currentVersion = versionId;
    return true;
  } else {
    // Selective restore
    const targetVersion = versionStore[entityId].versions[versionId].data;
    const currentVersionId = versionStore[entityId].currentVersion;
    const currentVersion = versionStore[entityId].versions[currentVersionId].data;
    
    // Create a new version with selective changes
    const newData = { ...currentVersion };
    
    if (options.entities && options.entities.length > 0) {
      // Restore only specific entities
      options.entities.forEach(path => {
        const value = getNestedProperty(targetVersion, path);
        if (value !== undefined) {
          setNestedProperty(newData, path, value);
        }
      });
    }
    
    // Create a new version with the selectively restored data
    const newVersionId = uuidv4();
    const timestamp = new Date().toISOString();
    
    const newVersion: Version = {
      id: newVersionId,
      timestamp,
      description: `Selective restore from version ${versionId}`,
      createdBy: 'system',
      isBackup: false
    };
    
    versionStore[entityId].versions[newVersionId] = {
      version: newVersion,
      data: newData
    };
    
    versionStore[entityId].currentVersion = newVersionId;
    return true;
  }
};

/**
 * Compares two versions of an entity
 */
export const compareVersions = <T>(
  entityId: string,
  versionAId: string,
  versionBId: string
): VersionDiff | null => {
  if (
    !versionStore[entityId] || 
    !versionStore[entityId].versions[versionAId] ||
    !versionStore[entityId].versions[versionBId]
  ) {
    return null;
  }
  
  const versionA = versionStore[entityId].versions[versionAId].data;
  const versionB = versionStore[entityId].versions[versionBId].data;
  
  const changes: DiffChange[] = compareObjects(versionA, versionB);
  
  return {
    versionA: versionAId,
    versionB: versionBId,
    changes
  };
};

/**
 * Deletes a specific version
 */
export const deleteVersion = (entityId: string, versionId: string): boolean => {
  if (
    !versionStore[entityId] || 
    !versionStore[entityId].versions[versionId] ||
    versionStore[entityId].currentVersion === versionId
  ) {
    return false;
  }
  
  delete versionStore[entityId].versions[versionId];
  return true;
};

/**
 * Adds tags to a version
 */
export const tagVersion = (
  entityId: string,
  versionId: string,
  tags: string[]
): boolean => {
  if (!versionStore[entityId] || !versionStore[entityId].versions[versionId]) {
    return false;
  }
  
  const version = versionStore[entityId].versions[versionId].version;
  version.tags = [...new Set([...(version.tags || []), ...tags])];
  
  return true;
};

// Helper functions

/**
 * Compares two objects and returns the differences
 */
const compareObjects = (objA: any, objB: any, path: string = ''): DiffChange[] => {
  const changes: DiffChange[] = [];
  
  // Check properties in objA
  for (const key in objA) {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (!(key in objB)) {
      // Property removed in objB
      changes.push({
        path: currentPath,
        oldValue: objA[key],
        newValue: undefined,
        changeType: 'removed'
      });
      continue;
    }
    
    if (typeof objA[key] === 'object' && objA[key] !== null && 
        typeof objB[key] === 'object' && objB[key] !== null) {
      // Recursively compare nested objects
      changes.push(...compareObjects(objA[key], objB[key], currentPath));
    } else if (objA[key] !== objB[key]) {
      // Values are different
      changes.push({
        path: currentPath,
        oldValue: objA[key],
        newValue: objB[key],
        changeType: 'modified'
      });
    }
  }
  
  // Check for properties in objB that are not in objA
  for (const key in objB) {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (!(key in objA)) {
      // Property added in objB
      changes.push({
        path: currentPath,
        oldValue: undefined,
        newValue: objB[key],
        changeType: 'added'
      });
    }
  }
  
  return changes;
};

/**
 * Gets a nested property from an object using a dot-notation path
 */
const getNestedProperty = (obj: any, path: string): any => {
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
};

/**
 * Sets a nested property on an object using a dot-notation path
 */
const setNestedProperty = (obj: any, path: string, value: any): void => {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  
  current[parts[parts.length - 1]] = value;
};