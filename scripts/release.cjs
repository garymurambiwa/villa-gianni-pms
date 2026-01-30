const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '0.3.0';
const RELEASE_DIR = path.resolve(__dirname, `../release_v${VERSION}`);

const DOCS = [
  { src: 'INSTALLATION.md', dest: 'INSTALLATION_MANUAL.md' },
  { src: 'RELEASE_NOTES.md', dest: 'RELEASE_NOTES.md' },
  { src: 'USER_MANUAL.md', dest: 'USER_MANUAL.md' }
];

function calculateChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

console.log(`Preparing release v${VERSION}...`);

if (!fs.existsSync(RELEASE_DIR)) {
  console.error(`Release directory ${RELEASE_DIR} does not exist. Run build first.`);
  process.exit(1);
}

// Copy Documentation
console.log('Copying documentation...');
DOCS.forEach(doc => {
  const srcPath = path.resolve(__dirname, `../${doc.src}`);
  const destPath = path.join(RELEASE_DIR, doc.dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`  ${doc.src} -> ${doc.dest}`);
  } else {
    console.warn(`  Warning: ${doc.src} not found.`);
  }
});

// Generate Checksums
console.log('Generating checksums...');
const checksums = [];
const files = fs.readdirSync(RELEASE_DIR);

files.forEach(file => {
  if (file.endsWith('.exe') || file.endsWith('.msi') || file.endsWith('.zip') || file.endsWith('.dmg') || file.endsWith('.AppImage') || file.endsWith('.deb') || file.endsWith('.rpm')) {
    const filePath = path.join(RELEASE_DIR, file);
    const hash = calculateChecksum(filePath);
    checksums.push(`${hash} *${file}`);
    console.log(`  ${file}: ${hash}`);
  }
});

fs.writeFileSync(path.join(RELEASE_DIR, 'SHA256SUMS.txt'), checksums.join('\n'));
console.log('SHA256SUMS.txt created.');

console.log(`Release v${VERSION} prepared successfully in ${RELEASE_DIR}`);
