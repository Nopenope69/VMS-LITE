import * as ed from '@noble/ed25519';
import { createSignedLicenseToken } from '../../src/licensing/verifier.js';
import { EXTENDED_CAPABILITIES } from '../../src/licensing/types.js';

/** Licensing options for a 32-camera Extended install (evaluation allows 2 cameras). */
export async function extendedLicense() {
  const priv = ed.utils.randomPrivateKey();
  const publicKeyHex = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('hex');
  const licenseToken = await createSignedLicenseToken(
    {
      product: 'basic-vms',
      edition: 'extended',
      capabilities: [...EXTENDED_CAPABILITIES],
      cameraLimit: 32,
      expiresAt: null,
      issuedAt: new Date().toISOString(),
    },
    Buffer.from(priv).toString('hex')
  );
  return { licenseToken, publicKeyHex, fallbackToEvaluation: false };
}
