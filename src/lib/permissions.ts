export type Role = string | undefined | null;

export const normalizeRole = (role: Role) => String(role || '').toLowerCase();

export const isAdmin = (role: Role) => normalizeRole(role) === 'admin';
export const isManager = (role: Role) => ['admin', 'manager', 'supervisor'].includes(normalizeRole(role));

// Core RBAC actions
export const canAccessPOS = (role: Role) => ['admin', 'manager', 'supervisor', 'posmanager', 'cashier', 'barman'].includes(normalizeRole(role));
export const canProcessTransactions = (role: Role) => ['admin', 'manager', 'supervisor', 'cashier'].includes(normalizeRole(role));
export const canAccessInventoryManagement = (role: Role) => ['admin', 'manager', 'supervisor', 'posmanager', 'barman'].includes(normalizeRole(role));
export const canAccessReporting = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canManageStaff = (role: Role) => ['admin', 'supervisor'].includes(normalizeRole(role));
export const canOverrideTransactions = (role: Role) => ['admin', 'supervisor', 'manager'].includes(normalizeRole(role));
export const canAccessDashboards = (role: Role) => ['admin', 'manager', 'supervisor', 'frontdesk', 'cashier'].includes(normalizeRole(role));

// POS management permissions
export const canManagePOS = (role: Role) => isManager(role);
export const canEditStockItem = (role: Role) => isManager(role);
export const canFixStockItem = (role: Role) => isManager(role);
export const canDeleteStockItem = (role: Role) => isManager(role);
export const canImportStockCSV = (role: Role) => isManager(role);
export const canExportIssuesCSV = (role: Role) => isManager(role);

// Public actions
export const canExportStockCSV = (_role: Role) => true;
export const canDownloadTemplate = (_role: Role) => true;

// Reporting visibility permissions
export const canViewFlashReport = (role: Role) => ['admin', 'manager', 'supervisor', 'frontdesk', 'auditor'].includes(normalizeRole(role));
export const canViewPOSReconciliation = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor', 'posmanager'].includes(normalizeRole(role));
export const canViewPLReport = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canViewAgedARReport = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canViewInventoryCOGSReport = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor', 'posmanager'].includes(normalizeRole(role));
export const canViewTrialBalance = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canViewArrivalsDepartures = (role: Role) => ['admin', 'manager', 'supervisor', 'frontdesk', 'auditor'].includes(normalizeRole(role));
export const canViewHighBalance = (role: Role) => ['admin', 'manager', 'supervisor', 'frontdesk', 'auditor'].includes(normalizeRole(role));
export const canViewProcurementVariance = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canViewFixedAssetRecon = (role: Role) => ['admin', 'manager', 'supervisor', 'auditor'].includes(normalizeRole(role));
export const canAccessTransactionClearing = (role: Role) => ['admin'].includes(normalizeRole(role));

export const canViewReport = (reportType: string, role: Role) => {
  const t = String(reportType || '').toLowerCase();
  switch (t) {
    case 'flash': return canViewFlashReport(role);
    case 'pos-recon': return canViewPOSReconciliation(role);
    case 'pl': return canViewPLReport(role);
    case 'aged-ar': return canViewAgedARReport(role);
    case 'inventory-cogs': return canViewInventoryCOGSReport(role);
    case 'trial-balance': return canViewTrialBalance(role);
    case 'arrivals-departures': return canViewArrivalsDepartures(role);
    case 'high-balance': return canViewHighBalance(role);
    case 'proc-variance': return canViewProcurementVariance(role);
    case 'fa-recon': return canViewFixedAssetRecon(role);
    default: return true;
  }
};
