#!/usr/bin/env node

import readline from 'readline';
import process from 'process';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// ENVIRONMENT & DB INITIALIZATION
// ============================================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || process.env.VITE_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============================================================================
// SYSTEM ADMINISTRATOR CONFIGURATION (FALLBACKS)
// ============================================================================
let CONFIG = {
    // Fallback deadline if DB fetch fails
    deadline: new Date('2026-05-15T00:00:00Z').getTime(),
    
    // Billing and support contact information
    billingEmail: "billing@villagianni.com",
    billingPhone: "+263 24 2335324",
    referenceId: "SYS-LIC-9091A",
    
    // Refresh interval in milliseconds
    refreshInterval: 1000,
    autoExitSeconds: 0 
};

// ============================================================================
// DATA FETCHING
// ============================================================================
async function syncDeadlineFromDB() {
    try {
        const res = await pool.query("SELECT value FROM app_settings WHERE key = 'license_expiry'");
        if (res.rows.length > 0 && res.rows[0].value) {
            const dbDate = new Date(res.rows[0].value);
            if (!isNaN(dbDate.getTime())) {
                CONFIG.deadline = dbDate.getTime();
            }
        }
    } catch (e) {
        // Silently fallback to hardcoded deadline if DB is unavailable
    }
}

// Initial sync
await syncDeadlineFromDB();
// Sync every 30 seconds in case sysadmin updates it via UI
setInterval(syncDeadlineFromDB, 30000);

// ============================================================================
// ANSI ESCAPE CODES FOR HIGH VISIBILITY
// ============================================================================
const COLORS = {
    red: '\x1b[38;5;196m',
    darkRed: '\x1b[38;5;124m',
    yellow: '\x1b[38;5;226m',
    white: '\x1b[38;5;231m',
    gray: '\x1b[38;5;244m',
    bgRed: '\x1b[48;5;196m',
    bgDarkRed: '\x1b[48;5;52m',
    bold: '\x1b[1m',
    blink: '\x1b[5m',
    reset: '\x1b[0m'
};

// ============================================================================
// TERMINAL UTILITIES
// ============================================================================
function getTerminalWidth() {
    return process.stdout.columns || 80;
}

function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function centerText(text, width) {
    const plainText = stripAnsi(text);
    if (plainText.length >= width) return text;
    const padding = Math.floor((width - plainText.length) / 2);
    return ' '.repeat(padding) + text;
}

// ============================================================================
// UI COMPONENTS
// ============================================================================
function drawDivider(width, char = '═') {
    return COLORS.darkRed + char.repeat(width) + COLORS.reset;
}

function drawHeader(width) {
    const asciiArt = [
        " __        __  _    ____  _   _ ___ _   _  ____ ",
        " \\ \\      / / / \\  |  _ \\| \\ | |_ _| \\ | |/ ___|",
        "  \\ \\ /\\ / / / _ \\ | |_) |  \\| || ||  \\| | |  _ ",
        "   \\ V  V / / ___ \\|  _ <| |\\  || || |\\  | |_| |",
        "    \\_/\\_/ /_/   \\_\\_| \\_\\_| \\_|___|_| \\_|\\____|"
    ];

    let output = '';
    output += drawDivider(width, '█') + '\n\n';
    
    asciiArt.forEach(line => {
        output += centerText(COLORS.red + COLORS.bold + line + COLORS.reset, width) + '\n';
    });
    
    output += '\n' + drawDivider(width, '─') + '\n\n';
    
    const title = " SYSTEM ACCESS RESTRICTION PENDING ";
    output += centerText(COLORS.bgRed + COLORS.white + COLORS.bold + title + COLORS.reset, width) + '\n\n';
    
    const statement1 = "Access to this enterprise system is strictly contingent upon the settlement";
    const statement2 = "of outstanding licensing fees. Continued failure to resolve this balance will";
    const statement3 = "result in immediate system lockout and suspension of all administrative privileges.";
    
    output += centerText(COLORS.white + statement1 + COLORS.reset, width) + '\n';
    output += centerText(COLORS.white + statement2 + COLORS.reset, width) + '\n';
    output += centerText(COLORS.white + statement3 + COLORS.reset, width) + '\n\n';
    
    output += drawDivider(width, '─') + '\n\n';
    
    return output;
}

function drawCountdown(width) {
    const now = new Date().getTime();
    const distance = CONFIG.deadline - now;

    let output = '';
    
    if (distance <= 0) {
        const expiredText = " EXPIRED: ADMINISTRATIVE LOCKOUT ACTIVE ";
        output += centerText(COLORS.bgRed + COLORS.white + COLORS.bold + COLORS.blink + expiredText + COLORS.reset, width) + '\n\n';
    } else {
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        const dStr = days.toString().padStart(2, '0');
        const hStr = hours.toString().padStart(2, '0');
        const mStr = minutes.toString().padStart(2, '0');
        const sStr = seconds.toString().padStart(2, '0');

        let timerColor = COLORS.white;
        if (days < 3) timerColor = COLORS.yellow;
        if (days < 1) timerColor = COLORS.red;

        const timerTitle = "TIME REMAINING UNTIL ENFORCEMENT";
        output += centerText(COLORS.gray + COLORS.bold + timerTitle + COLORS.reset, width) + '\n\n';

        const timerStr = `${dStr} DAYS  :  ${hStr} HRS  :  ${mStr} MIN  :  ${sStr} SEC`;
        output += centerText(timerColor + COLORS.bold + timerStr + COLORS.reset, width) + '\n\n';
    }
    
    return output;
}

function drawFooter(width) {
    let output = drawDivider(width, '─') + '\n\n';
    
    output += centerText(COLORS.white + "To resolve this matter and restore full operational status, please contact:" + COLORS.reset, width) + '\n';
    output += centerText(COLORS.yellow + COLORS.bold + `Email: ${CONFIG.billingEmail}  |  Phone: ${CONFIG.billingPhone}` + COLORS.reset, width) + '\n';
    output += centerText(COLORS.gray + `Reference ID: ${CONFIG.referenceId}` + COLORS.reset, width) + '\n\n';
    
    output += drawDivider(width, '█') + '\n';
    
    return output;
}

// ============================================================================
// MAIN RENDER LOOP
// ============================================================================
let iterations = 0;

function render() {
    const width = getTerminalWidth();
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    process.stdout.write('\n');
    
    let screen = drawHeader(width);
    screen += drawCountdown(width);
    screen += drawFooter(width);
    
    process.stdout.write(screen);
    
    if (CONFIG.autoExitSeconds > 0) {
        iterations++;
        if (iterations >= (CONFIG.autoExitSeconds * 1000) / CONFIG.refreshInterval) {
            process.stdout.write('\n\n');
            console.log(COLORS.gray + "Proceeding to terminal..." + COLORS.reset);
            process.exit(0);
        }
    }
}

// Ensure clean exit
process.on('SIGINT', () => {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    console.log(COLORS.red + COLORS.bold + "System warning interrupted. Proceeding with restricted access..." + COLORS.reset);
    process.exit(0);
});

// Hide cursor
process.stdout.write('\x1B[?25l');
process.on('exit', () => {
    process.stdout.write('\x1B[?25h');
    pool.end();
});

render();
setInterval(render, CONFIG.refreshInterval);
