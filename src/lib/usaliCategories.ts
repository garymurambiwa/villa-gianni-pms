/**
 * USALI (Uniform System of Accounts for the Lodging Industry)
 * Department and expense category definitions.
 *
 * Structure:
 *   Operating Departments → line items (Revenue + Expenses)
 *   Undistributed Departments → expense-only line items
 *   Fixed Charges → non-operating expenses
 */

// ---------------------------------------------------------------------------
// Operating Departments (Revenue-generating)
// ---------------------------------------------------------------------------
export const OPERATING_DEPARTMENTS = [
    'Rooms',
    'Food & Beverage',
    'Spa',
    'Other Operated Departments',
] as const;

export type OperatingDepartment = typeof OPERATING_DEPARTMENTS[number];

// ---------------------------------------------------------------------------
// Undistributed Operating Expenses (Support departments, no direct revenue)
// ---------------------------------------------------------------------------
export const UNDISTRIBUTED_DEPARTMENTS = [
    'Administrative & General',
    'Sales & Marketing',
    'Property Operations & Maintenance',
    'Utilities',
    'Information & Telecom',
] as const;

export type UndistributedDepartment = typeof UNDISTRIBUTED_DEPARTMENTS[number];

// ---------------------------------------------------------------------------
// Fixed Charges (Non-operating)
// ---------------------------------------------------------------------------
export const FIXED_CHARGES = [
    'Management Fees',
    'Rent / Lease',
    'Property Taxes',
    'Insurance',
    'Interest Expense',
    'Depreciation & Amortisation',
] as const;

export type FixedCharge = typeof FIXED_CHARGES[number];

// ---------------------------------------------------------------------------
// All departments (flat list for dropdown selectors)
// ---------------------------------------------------------------------------
export const ALL_DEPARTMENTS = [
    ...OPERATING_DEPARTMENTS,
    ...UNDISTRIBUTED_DEPARTMENTS,
] as const;

// ---------------------------------------------------------------------------
// Expense Line Items per Department
// ---------------------------------------------------------------------------
export interface ExpenseLineItem {
    id: string;
    label: string;
    department: string;
    /** USALI line category: COGS, Payroll, Other Expense */
    usaliCategory: 'COGS' | 'Payroll' | 'Other Expense';
}

export const EXPENSE_LINE_ITEMS: ExpenseLineItem[] = [
    // --- Rooms ---
    { id: 'rooms-payroll', label: 'Payroll & Related', department: 'Rooms', usaliCategory: 'Payroll' },
    { id: 'rooms-laundry', label: 'Laundry & Linen', department: 'Rooms', usaliCategory: 'Other Expense' },
    { id: 'rooms-guest-supplies', label: 'Guest Supplies', department: 'Rooms', usaliCategory: 'Other Expense' },
    { id: 'rooms-cleaning', label: 'Cleaning Supplies', department: 'Rooms', usaliCategory: 'Other Expense' },
    { id: 'rooms-commissions', label: 'Commissions', department: 'Rooms', usaliCategory: 'Other Expense' },
    { id: 'rooms-other', label: 'Other Room Expenses', department: 'Rooms', usaliCategory: 'Other Expense' },

    // --- Food & Beverage ---
    { id: 'fb-cogs-food', label: 'Cost of Food Sold', department: 'Food & Beverage', usaliCategory: 'COGS' },
    { id: 'fb-cogs-beverage', label: 'Cost of Beverage Sold', department: 'Food & Beverage', usaliCategory: 'COGS' },
    { id: 'fb-payroll', label: 'Payroll & Related', department: 'Food & Beverage', usaliCategory: 'Payroll' },
    { id: 'fb-kitchen-supplies', label: 'Kitchen Supplies', department: 'Food & Beverage', usaliCategory: 'Other Expense' },
    { id: 'fb-paper-supplies', label: 'Paper & Disposable Supplies', department: 'Food & Beverage', usaliCategory: 'Other Expense' },
    { id: 'fb-music-entertain', label: 'Music & Entertainment', department: 'Food & Beverage', usaliCategory: 'Other Expense' },
    { id: 'fb-other', label: 'Other F&B Expenses', department: 'Food & Beverage', usaliCategory: 'Other Expense' },

    // --- Spa ---
    { id: 'spa-cogs', label: 'Cost of Products Sold', department: 'Spa', usaliCategory: 'COGS' },
    { id: 'spa-payroll', label: 'Payroll & Related', department: 'Spa', usaliCategory: 'Payroll' },
    { id: 'spa-supplies', label: 'Spa Supplies', department: 'Spa', usaliCategory: 'Other Expense' },
    { id: 'spa-other', label: 'Other Spa Expenses', department: 'Spa', usaliCategory: 'Other Expense' },

    // --- Other Operated Departments ---
    { id: 'other-cogs', label: 'Cost of Goods Sold', department: 'Other Operated Departments', usaliCategory: 'COGS' },
    { id: 'other-payroll', label: 'Payroll & Related', department: 'Other Operated Departments', usaliCategory: 'Payroll' },
    { id: 'other-expenses', label: 'Other Expenses', department: 'Other Operated Departments', usaliCategory: 'Other Expense' },

    // --- Administrative & General ---
    { id: 'ag-payroll', label: 'Payroll & Related', department: 'Administrative & General', usaliCategory: 'Payroll' },
    { id: 'ag-professional', label: 'Professional Fees', department: 'Administrative & General', usaliCategory: 'Other Expense' },
    { id: 'ag-office', label: 'Office Supplies', department: 'Administrative & General', usaliCategory: 'Other Expense' },
    { id: 'ag-credit-card-comm', label: 'Credit Card Commissions', department: 'Administrative & General', usaliCategory: 'Other Expense' },
    { id: 'ag-insurance', label: 'Insurance (Operating)', department: 'Administrative & General', usaliCategory: 'Other Expense' },
    { id: 'ag-other', label: 'Other A&G Expenses', department: 'Administrative & General', usaliCategory: 'Other Expense' },

    // --- Sales & Marketing ---
    { id: 'sm-payroll', label: 'Payroll & Related', department: 'Sales & Marketing', usaliCategory: 'Payroll' },
    { id: 'sm-advertising', label: 'Advertising & Digital', department: 'Sales & Marketing', usaliCategory: 'Other Expense' },
    { id: 'sm-loyalty', label: 'Loyalty Programme', department: 'Sales & Marketing', usaliCategory: 'Other Expense' },
    { id: 'sm-travel', label: 'Travel & Trade Shows', department: 'Sales & Marketing', usaliCategory: 'Other Expense' },
    { id: 'sm-other', label: 'Other S&M Expenses', department: 'Sales & Marketing', usaliCategory: 'Other Expense' },

    // --- Property Operations & Maintenance ---
    { id: 'pom-payroll', label: 'Payroll & Related', department: 'Property Operations & Maintenance', usaliCategory: 'Payroll' },
    { id: 'pom-building', label: 'Building Maintenance', department: 'Property Operations & Maintenance', usaliCategory: 'Other Expense' },
    { id: 'pom-equipment', label: 'Equipment Maintenance', department: 'Property Operations & Maintenance', usaliCategory: 'Other Expense' },
    { id: 'pom-grounds', label: 'Grounds & Landscaping', department: 'Property Operations & Maintenance', usaliCategory: 'Other Expense' },
    { id: 'pom-swimming-pool', label: 'Swimming Pool', department: 'Property Operations & Maintenance', usaliCategory: 'Other Expense' },
    { id: 'pom-other', label: 'Other POM Expenses', department: 'Property Operations & Maintenance', usaliCategory: 'Other Expense' },

    // --- Utilities ---
    { id: 'util-electricity', label: 'Electricity', department: 'Utilities', usaliCategory: 'Other Expense' },
    { id: 'util-water-sewer', label: 'Water & Sewer', department: 'Utilities', usaliCategory: 'Other Expense' },
    { id: 'util-gas', label: 'Gas', department: 'Utilities', usaliCategory: 'Other Expense' },
    { id: 'util-refuse', label: 'Refuse & Waste Removal', department: 'Utilities', usaliCategory: 'Other Expense' },
    { id: 'util-other', label: 'Other Utilities', department: 'Utilities', usaliCategory: 'Other Expense' },

    // --- Information & Telecom ---
    { id: 'it-payroll', label: 'Payroll & Related', department: 'Information & Telecom', usaliCategory: 'Payroll' },
    { id: 'it-internet', label: 'Internet & Network', department: 'Information & Telecom', usaliCategory: 'Other Expense' },
    { id: 'it-software', label: 'Software & Licences', department: 'Information & Telecom', usaliCategory: 'Other Expense' },
    { id: 'it-telecom', label: 'Telephone & Postage', department: 'Information & Telecom', usaliCategory: 'Other Expense' },
    { id: 'it-other', label: 'Other IT Expenses', department: 'Information & Telecom', usaliCategory: 'Other Expense' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map legacy department names to USALI equivalents */
export const LEGACY_DEPARTMENT_MAP: Record<string, string> = {
    'Administration': 'Administrative & General',
    'F&B': 'Food & Beverage',
    'Food': 'Food & Beverage',
    'Beverage': 'Food & Beverage',
    'Sales': 'Sales & Marketing',
    'Sales & Marketing': 'Sales & Marketing',
    'Marketing': 'Sales & Marketing',
    'Maintenance': 'Property Operations & Maintenance',
    'POM': 'Property Operations & Maintenance',
    'IT': 'Information & Telecom',
    'Telecom': 'Information & Telecom',
    'Other': 'Other Operated Departments',
    // Pass-through for already-correct names
    'Rooms': 'Rooms',
    'Food & Beverage': 'Food & Beverage',
    'Spa': 'Spa',
    'Other Operated Departments': 'Other Operated Departments',
    'Administrative & General': 'Administrative & General',
    'Property Operations & Maintenance': 'Property Operations & Maintenance',
    'Utilities': 'Utilities',
    'Information & Telecom': 'Information & Telecom',
};

/** Normalise any department string to a USALI department */
export function normaliseToUSALI(dept: string): string {
    return LEGACY_DEPARTMENT_MAP[dept] || dept;
}

/** Get line items for a specific department */
export function getLineItemsForDepartment(dept: string): ExpenseLineItem[] {
    return EXPENSE_LINE_ITEMS.filter(li => li.department === dept);
}

/** Is this an operating (revenue-generating) department? */
export function isOperating(dept: string): boolean {
    return (OPERATING_DEPARTMENTS as readonly string[]).includes(dept);
}

/** Is this an undistributed department? */
export function isUndistributed(dept: string): boolean {
    return (UNDISTRIBUTED_DEPARTMENTS as readonly string[]).includes(dept);
}
