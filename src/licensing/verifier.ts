import * as ed from '@noble/ed25519';
import { LicensePayload, LicensePayloadSchema } from './types.js';

export interface LicenseHeader {
  alg: 'Ed25519';
  typ: 'VMS-LIC';
  ver: '1';
}

export class LicenseVerificationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'LicenseVerificationError';
  }
}

/**
 * Verifies a compact 3-part Ed25519 signed license token:
 *   <headerB64url>.<payloadB64url>.<signatureHex>
 */
export async function verifyLicenseToken(
  token: string,
  publicKeyHex: string
): Promise<LicensePayload> {
  if (!token || typeof token !== 'string') {
    throw new LicenseVerificationError('License token is missing or empty', 'TOKEN_MISSING');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new LicenseVerificationError(
      'Malformed license token structure; expected 3 dot-separated parts',
      'MALFORMED_TOKEN'
    );
  }

  const [headerB64, payloadB64, signatureHex] = parts;

  // Verify header
  let header: LicenseHeader;
  try {
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    header = JSON.parse(headerJson);
  } catch (err) {
    throw new LicenseVerificationError('Invalid token header encoding', 'INVALID_HEADER');
  }

  if (header.alg !== 'Ed25519' || header.typ !== 'VMS-LIC') {
    throw new LicenseVerificationError(
      `Unsupported license algorithm or type: ${header.alg}/${header.typ}`,
      'UNSUPPORTED_ALGORITHM'
    );
  }

  // Cryptographic signature check
  const message = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(message);

  let isValid = false;
  try {
    isValid = await ed.verifyAsync(signatureHex, messageBytes, publicKeyHex);
  } catch (err) {
    throw new LicenseVerificationError(
      `Cryptographic verification failed: ${(err as Error).message}`,
      'VERIFICATION_EXCEPTION'
    );
  }

  if (!isValid) {
    throw new LicenseVerificationError(
      'Digital signature verification failed; token is forged or tampered',
      'INVALID_SIGNATURE'
    );
  }

  // Parse and schema-validate payload
  let rawPayload: unknown;
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    rawPayload = JSON.parse(payloadJson);
  } catch (err) {
    throw new LicenseVerificationError('Invalid token payload encoding', 'INVALID_PAYLOAD');
  }

  const parseResult = LicensePayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    throw new LicenseVerificationError(
      `License payload validation error: ${parseResult.error.message}`,
      'SCHEMA_VALIDATION_FAILED'
    );
  }

  return parseResult.data;
}

/**
 * Creates a signed license token (used for testing and license issuance).
 */
export async function createSignedLicenseToken(
  payload: LicensePayload,
  privateKeyHex: string
): Promise<string> {
  const header: LicenseHeader = {
    alg: 'Ed25519',
    typ: 'VMS-LIC',
    ver: '1',
  };

  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const message = `${headerB64}.${payloadB64}`;
  const messageBytes = new TextEncoder().encode(message);

  const signatureBytes = await ed.signAsync(messageBytes, privateKeyHex);
  const signatureHex = Buffer.from(signatureBytes).toString('hex');

  return `${headerB64}.${payloadB64}.${signatureHex}`;
}
