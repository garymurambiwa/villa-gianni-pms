/**
 * Shared CSV Utilities
 * Standardized date formatting and helpers for all CSV exports.
 */

/**
 * Format a date/datetime value to DDMMYYYY-HHMMSS for CSV export.
 * Timezone: Africa/Johannesburg (GMT+2).
 *
 * @param dateInput - ISO string, Date object, or epoch timestamp
 * @returns Formatted string like "28022026-113622"
 */
export const formatDateForCSV = (dateInput: string | Date | number): string => {
    try {
        const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);

        // Convert to Africa/Johannesburg timezone
        const parts = new Intl.DateTimeFormat('en-ZA', {
            timeZone: 'Africa/Johannesburg',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(d);

        const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
        const day = get('day');
        const month = get('month');
        const year = get('year');
        const hour = get('hour');
        const minute = get('minute');
        const second = get('second');

        return `${day}${month}${year}-${hour}${minute}${second}`;
    } catch {
        return String(dateInput);
    }
};

/**
 * Format a date value to DD/MM/YYYY for CSV display (date-only, no time).
 */
export const formatDateOnlyForCSV = (dateInput: string | Date | number): string => {
    try {
        const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);

        const parts = new Intl.DateTimeFormat('en-ZA', {
            timeZone: 'Africa/Johannesburg',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(d);

        const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
        return `${get('day')}/${get('month')}/${get('year')}`;
    } catch {
        return String(dateInput);
    }
};

/**
 * Escape a CSV cell value — wraps in double quotes and escapes internal quotes.
 */
export const escapeCSV = (v: any): string => {
    return '"' + String(v ?? '').replace(/"/g, '""') + '"';
};

/**
 * Generate a sequential display ID from an index (1-based).
 * Format: "TXN-0001", "TXN-0002", etc.
 */
export const toDisplayId = (index: number, prefix = 'TXN'): string => {
    return `${prefix}-${String(index).padStart(4, '0')}`;
};
