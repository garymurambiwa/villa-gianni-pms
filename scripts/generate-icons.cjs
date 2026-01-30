const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
// Handle ESM default export for png-to-ico when required from CJS
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule && pngToIcoModule.default ? pngToIcoModule.default : pngToIcoModule;

const src = path.resolve(__dirname, '../build/logo.png');
const outDir = path.resolve(__dirname, '../build/icons');

async function ensureSource() {
  if (!fs.existsSync(src)) {
    console.error('Missing source image: build/logo.png');
    process.exit(1);
  }
}

async function generatePngSizes(sizes) {
  fs.mkdirSync(outDir, { recursive: true });
  const bg = { r: 0, g: 0, b: 0, alpha: 0 };
  const tasks = sizes.map((size) =>
    sharp(src)
      .resize(size, size, { fit: 'contain', background: bg })
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, `${size}.png`))
  );
  await Promise.all(tasks);
}

async function generateIco(sizes) {
  const pngPaths = sizes.map((s) => path.join(outDir, `${s}.png`));
  const buffer = await pngToIco(pngPaths);
  const icoPath = path.resolve(__dirname, '../build/icon.ico');
  fs.writeFileSync(icoPath, buffer);
  // Duplicate for NSIS assets
  fs.copyFileSync(icoPath, path.resolve(__dirname, '../build/installerIcon.ico'));
  fs.copyFileSync(icoPath, path.resolve(__dirname, '../build/installerHeaderIcon.ico'));
  fs.copyFileSync(icoPath, path.resolve(__dirname, '../build/uninstallerIcon.ico'));
}

async function main() {
  await ensureSource();
  const sizes = [16, 32, 48, 64, 128, 256];
  await generatePngSizes(sizes);
  await generateIco(sizes);
  console.log('Generated build/icon.ico and NSIS icon files.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
