import { createBackup, getCurrentVersion } from './versionControlService';

/**
 * Schedule for automatic backups
 */
export interface BackupSchedule {
  entityId: string;
  entityType: string;
  intervalMinutes: number;
  lastBackupTime?: string;
  enabled: boolean;
}

// In-memory storage for backup schedules
const backupSchedules: Record<string, BackupSchedule> = {};
const backupIntervals: Record<string, NodeJS.Timeout> = {};

/**
 * Creates a backup of the current state
 */
export const createEntityBackup = <T>(
  entityId: string,
  entityType: string,
  data: T,
  createdBy: string,
  description: string = 'Manual backup'
) => {
  return createBackup(entityId, entityType, data, createdBy, description);
};

/**
 * Schedules automatic backups for an entity
 */
export const scheduleAutomaticBackups = (
  entityId: string,
  entityType: string,
  intervalMinutes: number = 60,
  createdBy: string = 'system'
) => {
  // Clear any existing schedule
  if (backupIntervals[entityId]) {
    clearInterval(backupIntervals[entityId]);
  }
  
  // Create new schedule
  backupSchedules[entityId] = {
    entityId,
    entityType,
    intervalMinutes,
    lastBackupTime: new Date().toISOString(),
    enabled: true
  };
  
  // Set up interval
  const intervalMs = intervalMinutes * 60 * 1000;
  backupIntervals[entityId] = setInterval(() => {
    if (backupSchedules[entityId].enabled) {
      const currentData = getCurrentVersion(entityId);
      if (currentData) {
        createBackup(
          entityId,
          entityType,
          currentData,
          createdBy,
          `Automatic backup (${new Date().toLocaleString()})`
        );
        backupSchedules[entityId].lastBackupTime = new Date().toISOString();
      }
    }
  }, intervalMs);
  
  return backupSchedules[entityId];
};

/**
 * Stops automatic backups for an entity
 */
export const stopAutomaticBackups = (entityId: string) => {
  if (backupIntervals[entityId]) {
    clearInterval(backupIntervals[entityId]);
    delete backupIntervals[entityId];
    
    if (backupSchedules[entityId]) {
      backupSchedules[entityId].enabled = false;
    }
    
    return true;
  }
  
  return false;
};

/**
 * Gets the backup schedule for an entity
 */
export const getBackupSchedule = (entityId: string): BackupSchedule | null => {
  return backupSchedules[entityId] || null;
};

/**
 * Gets all backup schedules
 */
export const getAllBackupSchedules = (): BackupSchedule[] => {
  return Object.values(backupSchedules);
};

/**
 * Updates the backup schedule for an entity
 */
export const updateBackupSchedule = (
  entityId: string,
  updates: Partial<BackupSchedule>
): BackupSchedule | null => {
  if (!backupSchedules[entityId]) {
    return null;
  }
  
  const schedule = backupSchedules[entityId];
  const updatedSchedule = { ...schedule, ...updates };
  backupSchedules[entityId] = updatedSchedule;
  
  // If interval changed, reset the timer
  if (updates.intervalMinutes && updates.intervalMinutes !== schedule.intervalMinutes) {
    if (backupIntervals[entityId]) {
      clearInterval(backupIntervals[entityId]);
    }
    
    if (updatedSchedule.enabled) {
      const intervalMs = updatedSchedule.intervalMinutes * 60 * 1000;
      backupIntervals[entityId] = setInterval(() => {
        const currentData = getCurrentVersion(entityId);
        if (currentData) {
          createBackup(
            entityId,
            updatedSchedule.entityType,
            currentData,
            'system',
            `Automatic backup (${new Date().toLocaleString()})`
          );
          backupSchedules[entityId].lastBackupTime = new Date().toISOString();
        }
      }, intervalMs);
    }
  }
  
  return updatedSchedule;
};