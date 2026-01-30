const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const postgresDir = path.join(__dirname, '..', 'resources', 'postgres');

if (!fs.existsSync(postgresDir)) {
    console.error(`PostgreSQL directory not found: ${postgresDir}`);
    process.exit(1);
}

console.log(`Pruning PostgreSQL at: ${postgresDir}`);

const toDelete = [
    'include',        // C Headers
    'share/doc',      // Documentation
    'share/man',      // Man pages
    'lib/pgxs',       // Extension development
    'symbols',        // Debug symbols (if any)
];

const binToKeep = [
    'postgres.exe',
    'initdb.exe',
    'pg_ctl.exe',
    'psql.exe',
    'pg_isready.exe',
    'pg_resetwal.exe',
    'libpq.dll',      // Essential DLLs
    'libcrypto-3-x64.dll',
    'libssl-3-x64.dll',
    'libiconv-2.dll',
    'libintl-9.dll',
    'libxml2.dll',
    'zlib1.dll',
];

// 1. Delete unnecessary directories
toDelete.forEach(p => {
    const fullPath = path.join(postgresDir, p);
    if (fs.existsSync(fullPath)) {
        console.log(`Deleting: ${p}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
    }
});

// 2. Prune 'bin' directory to keep only essentials
const binDir = path.join(postgresDir, 'bin');
if (fs.existsSync(binDir)) {
    const files = fs.readdirSync(binDir);
    files.forEach(file => {
        if (!binToKeep.includes(file.toLowerCase())) {
            console.log(`Removing non-essential bin: ${file}`);
            fs.rmSync(path.join(binDir, file), { force: true });
        }
    });
}

// 3. Prune 'share/locale' - keep only English or common ones if needed, 
// for now keeping it as is or removing if very large.
// Actually locales are usually small but many. 
// We'll keep them to avoid i18n issues unless we see they are huge.

console.log('PostgreSQL pruning complete.');
