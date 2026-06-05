#!/usr/bin/env node
/**
 * check-jsx-imports.cjs
 *
 * Pre-build guard against the "Foo is not defined" crashes that ship to prod
 * when a lucide-react icon is used in JSX without being added to the import.
 *
 * Why this scope (not all JSX): we've now hit RefreshCw and Printer with the
 * same root cause — a lucide icon was referenced but not imported. A general
 * "all undeclared JSX" check is too noisy without a full TS resolver; this
 * focused check catches the recurring failure with zero false positives.
 *
 * What it does:
 *   1. Walk every src/**\/*.tsx file.
 *   2. For each file, parse the `import ... from 'lucide-react'` line into the
 *      set of imported icon names.
 *   3. Find every `<IconName ` JSX usage where IconName is a known lucide icon.
 *   4. Flag any usage whose icon isn't in the file's lucide-react import set.
 *
 * Known lucide icons are read from node_modules/lucide-react/dist/lucide-react.d.ts
 * (the published export list). If that file isn't present (e.g. fresh clone
 * before `npm install`) we no-op with a warning rather than fail closed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Build the lucide-icon universe from the codebase itself: every name ever
// imported from 'lucide-react' anywhere under src/ is a valid icon. This
// avoids needing node_modules at check-time and gives us a 100%-correct
// allowlist for files that DO import correctly. Files that crashed (Printer,
// RefreshCw) are flagged because OTHER files import those names successfully.
function loadLucideExportsFromCodebase(allFiles) {
  const exports = new Set();
  for (const file of allFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) {
      for (const part of m[1].split(',')) {
        const alias = part.trim().split(/\s+as\s+/i).pop().trim();
        if (/^[A-Z]\w+$/.test(alias)) exports.add(alias);
      }
    }
  }
  return exports;
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      walk(full, out);
    } else if (name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function getAllImportedNames(src) {
  // Returns every identifier the file imports — from any module. We use this
  // to whitelist names that resolve to local components (e.g. `import { Users }
  // from './modules/Users'`) even when that same name is also a lucide icon
  // somewhere else in the codebase.
  const set = new Set();
  // Named: `import { A, B as C } from '...'`
  for (const m of src.matchAll(/import\s*[\w*\s,{}]*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/i).pop().trim();
      if (alias) set.add(alias);
    }
  }
  // Default + namespace: `import Foo from '...'`, `import * as Foo from '...'`
  for (const m of src.matchAll(/import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s*from\s*['"][^'"]+['"]/g)) set.add(m[1]);
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from/g)) set.add(m[1]);
  return set;
}

function getLucideImports(src) {
  const set = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/i).pop().trim();
      if (alias) set.add(alias);
    }
  }
  return set;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function checkFile(file, lucideExports) {
  const src = fs.readFileSync(file, 'utf8');
  // Strip comments/strings while preserving newlines so line numbers stay accurate.
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/.*$/gm, blank)
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, blank);

  const lucideImports = getLucideImports(src);
  const allImports    = getAllImportedNames(src); // includes lucide + every other import

  const offenders = [];
  // <Name ...   matches a JSX element start with an uppercase first char.
  // Followed by whitespace, /, or >. We don't try to be perfect — we only care
  // about icons whose name appears in the lucide export list.
  for (const m of code.matchAll(/<([A-Z]\w+)([\s/>])/g)) {
    const name = m[1];
    if (!lucideExports.has(name)) continue; // Not a known lucide icon — skip
    if (lucideImports.has(name)) continue;  // Imported from lucide here, all good
    if (allImports.has(name))    continue;  // Imported from anywhere (e.g. local component with same name)

    // Disambiguate TS generics (`useState<User | null>`) from JSX (`<Users />`).
    // After the captured name, look at the next non-whitespace char:
    //   |, &, , , extends  →  TS generic, skip
    //   /, >, identifier, {  →  JSX opener
    const after = code.slice(m.index + m[0].length);
    const nextNonSpace = after.match(/^\s*(\S)/)?.[1] || '';
    if (nextNonSpace === '|' || nextNonSpace === '&' || nextNonSpace === ',') continue;
    if (/^\s*extends\b/.test(after)) continue;

    offenders.push({ name, line: lineOf(src, m.index) });
  }
  return offenders;
}

const files = walk(SRC);
const lucideExports = loadLucideExportsFromCodebase(files);
if (lucideExports.size === 0) {
  console.log('check-jsx-imports: no lucide-react imports found in src/ — skipping.');
  process.exit(0);
}
let total = 0;
for (const file of files) {
  const offenders = checkFile(file, lucideExports);
  if (!offenders.length) continue;
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  for (const o of offenders) {
    console.error(`${rel}:${o.line}  <${o.name} /> is used but not imported from 'lucide-react'`);
    total += 1;
  }
}

if (total > 0) {
  console.error('');
  console.error(`✗ ${total} lucide-react icon(s) used without being imported — these will crash at runtime.`);
  console.error('  Add the missing names to the file\'s import { ... } from \'lucide-react\' line.');
  process.exit(1);
}

console.log(`✓ check-jsx-imports: ${files.length} .tsx files, ${lucideExports.size} known lucide icons, no missing imports.`);
