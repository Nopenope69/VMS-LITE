import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function generateSbom() {
  console.log('====================================================');
  console.log('  Basic VMS: Automated CycloneDX SBOM Generator     ');
  console.log('====================================================');

  const pkgJsonPath = path.join(rootDir, 'package.json');
  const lockJsonPath = path.join(rootDir, 'package-lock.json');

  const rootPkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const lockData = JSON.parse(fs.readFileSync(lockJsonPath, 'utf8'));
  const packages = lockData.packages || {};

  const components = [];
  const serialNumber = `urn:uuid:${crypto.randomUUID()}`;

  for (const [pkgKey, info] of Object.entries(packages)) {
    if (!pkgKey) continue; // skip root
    if (info.dev === true) continue; // skip devDependencies

    const pkgName = pkgKey.replace(/^node_modules\//, '');
    const version = info.version || '0.0.0';
    const license = info.license || 'MIT';

    const purl = `pkg:npm/${encodeURIComponent(pkgName)}@${version}`;

    components.push({
      type: 'library',
      'bom-ref': purl,
      name: pkgName,
      version: version,
      purl: purl,
      licenses: [
        {
          license: {
            id: typeof license === 'string' ? license : 'MIT',
          },
        },
      ],
      properties: [
        {
          name: 'basic-vms:dependency-scope',
          value: 'production',
        },
      ],
    });
  }

  // Sort components by name
  components.sort((a, b) => a.name.localeCompare(b.name));

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'Basic VMS Engineering',
          name: 'basic-vms-sbom-generator',
          version: '1.0.0',
        },
      ],
      component: {
        type: 'application',
        'bom-ref': `pkg:npm/${rootPkg.name}@${rootPkg.version}`,
        name: rootPkg.name,
        version: rootPkg.version,
        description: rootPkg.description,
        licenses: [
          {
            license: {
              id: rootPkg.license || 'MIT',
            },
          },
        ],
      },
    },
    components: components,
  };

  const outputPath = path.join(rootDir, 'sbom.json');
  fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2), 'utf8');

  console.log(`[+] Total SBOM components generated: ${components.length}`);
  console.log(`[+] CycloneDX 1.5 SBOM written to: sbom.json`);

  // Also write to dist/ if dist exists
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'sbom.json'), JSON.stringify(sbom, null, 2), 'utf8');
    console.log(`[+] CycloneDX 1.5 SBOM copied to: dist/sbom.json`);
  }
}

generateSbom();
