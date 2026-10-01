#!/usr/bin/env node
/**
 * Vendor license tooling (run on a vendor machine, never on customer appliances).
 *
 *   node scripts/license-tool.mjs keygen [--out ~/.basic-vms/license-private.key]
 *       Creates an Ed25519 keypair. The private key is written to --out (mode 600);
 *       the public key is printed. Paste it into src/licensing/vendor-key.ts.
 *
 *   node scripts/license-tool.mjs issue --key <private.key> --edition core|extended|ai
 *       [--cameras 16] [--days 365 | --perpetual] [--instance <id>]
 *       Prints a signed token for the customer's BASIC_VMS_LICENSE.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as ed from '@noble/ed25519';

const CORE = ['core.live', 'core.record', 'core.playback', 'core.events', 'core.onvif', 'core.camera_health', 'extended.camera_health', 'core.email_alerts'];
const EXTENDED = [...CORE, 'extended.operator_role', 'extended.motion_zones', 'extended.ptz', 'extended.clip_export', 'extended.bookmarks', 'extended.whatsapp_alerts', 'extended.api_webhooks'];
const AI = [...EXTENDED, 'ai.person_detection', 'ai.vehicle_detection', 'ai.smart_search', 'ai.anpr', 'ai.face_matching'];
const EDITIONS = { core: CORE, extended: EXTENDED, ai: AI };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const [command] = process.argv.slice(2);

if (command === 'keygen') {
  const out = path.resolve(arg('out', path.join(os.homedir(), '.basic-vms', 'license-private.key')).replace(/^~/, os.homedir()));
  if (fs.existsSync(out)) {
    console.error(`Refusing to overwrite existing key: ${out}`);
    process.exit(1);
  }
  const privateKey = crypto.randomBytes(32);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(privateKey).toString('hex') + '\n', { mode: 0o600 });
  console.log(`Private key written to ${out} (keep it offline, back it up).`);
  console.log(`Public key (paste into src/licensing/vendor-key.ts):\n${Buffer.from(publicKey).toString('hex')}`);
} else if (command === 'issue') {
  const keyFile = arg('key');
  const edition = arg('edition', 'core');
  if (!keyFile || !EDITIONS[edition]) {
    console.error('Usage: issue --key <private.key> --edition core|extended|ai [--cameras N] [--days N | --perpetual] [--instance id]');
    process.exit(1);
  }
  const privateKey = fs.readFileSync(keyFile, 'utf8').trim();
  const now = new Date();
  const days = Number(arg('days', '365'));
  const payload = {
    product: 'basic-vms',
    edition,
    capabilities: EDITIONS[edition],
    cameraLimit: Number(arg('cameras', '16')),
    expiresAt: process.argv.includes('--perpetual') ? null : new Date(now.getTime() + days * 86400000).toISOString(),
    issuedAt: now.toISOString(),
    ...(arg('instance') ? { instanceId: arg('instance') } : {}),
  };
  const header = { alg: 'Ed25519', typ: 'VMS-LIC', ver: '1' };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = await ed.signAsync(new TextEncoder().encode(`${h}.${p}`), privateKey);
  console.log(`${h}.${p}.${Buffer.from(sig).toString('hex')}`);
} else {
  console.error('Commands: keygen | issue (see header of scripts/license-tool.mjs)');
  process.exit(1);
}
