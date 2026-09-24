import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD',
  'ISC',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
]);

const PROHIBITED_KEYWORDS = ['GPL', 'AGPL', 'LGPL', 'SSPL', 'MPL', 'CPAL', 'PROPRIETARY'];

function isPermissive(licenseStr) {
  if (!licenseStr) return false;
  const clean = licenseStr.replace(/[()]/g, '').trim();

  // If compound (e.g. "MIT OR Apache-2.0"), check if components are allowed
  const orParts = clean.split(/\s+OR\s+/i);
  for (const part of orParts) {
    const trimmed = part.trim();
    if (ALLOWED_LICENSES.has(trimmed)) {
      return true;
    }
  }

  // Check AND parts
  const andParts = clean.split(/\s+AND\s+/i);
  if (andParts.length > 1 && andParts.every((p) => ALLOWED_LICENSES.has(p.trim()))) {
    return true;
  }

  return ALLOWED_LICENSES.has(clean);
}

function hasCopyleft(licenseStr) {
  if (!licenseStr) return false;
  const upper = licenseStr.toUpperCase();
  return PROHIBITED_KEYWORDS.some((kw) => upper.includes(kw));
}

function runAudit() {
  console.log('====================================================');
  console.log('  Basic VMS: Automated License Compliance Audit     ');
  console.log('====================================================');

  const lockPath = path.join(rootDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.error('[-] Error: package-lock.json not found');
    process.exit(1);
  }

  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const packages = lockData.packages || {};

  const productionPackages = [];
  const violations = [];

  for (const [pkgKey, info] of Object.entries(packages)) {
    if (!pkgKey) continue; // skip root entry
    if (info.dev === true) continue; // skip development dependencies

    const pkgName = pkgKey.replace(/^node_modules\//, '');
    let license = info.license;

    // If lockfile doesn't list license, check package.json directly
    const pkgJsonPath = path.join(rootDir, pkgKey, 'package.json');
    if (!license && fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        license = pkgJson.license || (pkgJson.licenses && pkgJson.licenses[0]?.type);
      } catch {
        // ignore
      }
    }

    const licenseStr = typeof license === 'object' ? license?.type || 'UNKNOWN' : license || 'UNKNOWN';

    if (hasCopyleft(licenseStr) || !isPermissive(licenseStr)) {
      violations.push({
        name: pkgName,
        version: info.version,
        license: licenseStr,
      });
    }

    productionPackages.push({
      name: pkgName,
      version: info.version,
      license: licenseStr,
      path: pkgKey,
    });
  }

  console.log(`[+] Total production packages scanned: ${productionPackages.length}`);

  if (violations.length > 0) {
    console.error('\n[-] LICENSE COMPLIANCE FAILURE: Non-permissive dependencies detected:');
    for (const v of violations) {
      console.error(`    - ${v.name}@${v.version} [License: ${v.license}]`);
    }
    console.error('\nViolations must be removed to preserve 100% permissive licensing architecture.');
    process.exit(1);
  }

  console.log('[+] 100% Permissive Licensing Verified! All production packages pass audit.');

  // Generate release inventory and notices (DEP-03)
  const licensesDir = path.join(rootDir, 'third_party', 'licenses');
  const noticesDir = path.join(rootDir, 'third_party', 'notices');
  fs.mkdirSync(licensesDir, { recursive: true });
  fs.mkdirSync(noticesDir, { recursive: true });

  let noticesMarkdown = `# Third-Party Software Notices & Licenses

This document contains licensing notices and acknowledgements for open-source software packages bundled with Basic VMS (Package 1: Core).

**Compliance Statement:**
All production third-party packages included in Basic VMS are distributed under verified permissive licenses (MIT, Apache-2.0, BSD, ISC).
Basic VMS contains zero viral copyleft (GPL, AGPL, LGPL) dependencies.

## Production Package Inventory

| Package | Version | License |
| :--- | :--- | :--- |
`;

  // Sort alphabetically
  productionPackages.sort((a, b) => a.name.localeCompare(b.name));

  for (const pkg of productionPackages) {
    noticesMarkdown += `| \`${pkg.name}\` | \`${pkg.version}\` | **${pkg.license}** |\n`;

    // Attempt to extract license text if present
    const pkgDir = path.join(rootDir, pkg.path);
    const candidateFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.txt'];
    for (const file of candidateFiles) {
      const fullPath = path.join(pkgDir, file);
      if (fs.existsSync(fullPath)) {
        const sanitizedPkgName = pkg.name.replace(/\//g, '__');
        const destFile = path.join(licensesDir, `${sanitizedPkgName}.txt`);
        fs.copyFileSync(fullPath, destFile);
        break;
      }
    }
  }

  noticesMarkdown += `\n---\n*Generated by Basic VMS Automated License Auditor on ${new Date().toISOString()}*\n`;

  fs.writeFileSync(path.join(noticesDir, 'THIRD_PARTY_NOTICES.md'), noticesMarkdown, 'utf8');
  console.log(`[+] Generated third-party inventory: third_party/notices/THIRD_PARTY_NOTICES.md`);
  console.log(`[+] Extracted license texts to: third_party/licenses/\n`);
}

runAudit();
