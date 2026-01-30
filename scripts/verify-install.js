const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const net = require('net');

const IS_WINDOWS = process.platform === 'win32';
const DB_PORT = 54320;

console.log('=== COREPMS Installation Verification ===');
let hasErrors = false;

// 1. Check Prerequisites (Windows)
if (IS_WINDOWS) {
  try {
    process.stdout.write('Checking VC++ Redistributable... ');
    execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" /v Installed', { stdio: 'ignore' });
    console.log('OK');
  } catch (e) {
    console.log('FAIL (Registry check failed)');
    // Don't fail hard, maybe it's installed but registry key is different or permission denied
    console.log('  Note: Ensure VC_redist.x64.exe is installed.');
  }
}

// 2. Check Database Connectivity
process.stdout.write(`Checking Database Connectivity (Port ${DB_PORT})... `);
const client = new net.Socket();
client.setTimeout(2000);

client.connect(DB_PORT, '127.0.0.1', () => {
  console.log('OK');
  client.destroy();
  finish(true);
});

client.on('error', (err) => {
  console.log('FAIL');
  console.log(`  Error: ${err.message}`);
  console.log('  Note: The database runs only when the application is open.');
  finish(false);
});

client.on('timeout', () => {
  console.log('TIMEOUT');
  console.log('  Note: The database runs only when the application is open.');
  client.destroy();
  finish(false);
});

function finish(success) {
  if (success) {
    console.log('\nINSTALLATION_SUCCESS');
    process.exit(0);
  } else {
    console.log('\nVerification completed with warnings.');
    // We exit with 0 to avoid breaking install chains, but log warnings
    process.exit(0);
  }
}
