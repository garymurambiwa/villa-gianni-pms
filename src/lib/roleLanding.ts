// Role-based default landing module mapping
// Maps internal roles to the most relevant module key used by AppLayout.
// If a role is not found, falls back to 'dashboard'.

export const roleDefaultModule: Record<string, string> = {
  // Highest-level administration
  // Admin lands on user management for day-to-day operations
  admin: 'admin-management',

  // Front Office leadership
  manager: 'frontoffice',
  supervisor: 'frontoffice',
  frontdesk: 'frontoffice',

  // Cashiers and high-volume FO tasks
  cashier: 'reservations',

  // Accounting / Night audit focused
  auditor: 'night-audit',

  // FNB / POS management and operations
  posmanager: 'inventory',
  barman: 'pos',

  // Housekeeping and Rooms
  housekeeping: 'rooms',
  
  // Maintenance operations
  maintenance: 'maintenance',
};

export function getDefaultModuleForRole(role?: string | null): string {
  const key = String(role || '').toLowerCase();
  return roleDefaultModule[key] || 'dashboard';
}
