import crypto from 'node:crypto';
import { SystemSettingsStore, systemSettingsStore } from '../settings/system-settings.store.js';

/** Placeholder secrets that have shipped in sample configs and must never sign real tokens. */
const KNOWN_PLACEHOLDERS = new Set([
  'super-secret-jwt-key-replace-in-production',
  'vms_jwt_secret_change_in_production',
  'dev-secret-basic-vms-super-secure',
  'change-me',
]);

const DEV_SECRET = 'dev-secret-basic-vms-super-secure';
const SETTINGS_KEY = 'auth.jwtSecret';

export function isUsableSecret(secret: string | undefined): secret is string {
  return Boolean(secret) && secret!.length >= 32 && !KNOWN_PLACEHOLDERS.has(secret!);
}

/**
 * Resolves the JWT signing secret.
 * - A strong JWT_SECRET from the environment always wins.
 * - Outside production, a fixed dev secret is used for convenience.
 * - In production without a usable secret, one is generated once and persisted in
 *   system_settings, so installs are secure by default and tokens survive restarts.
 */
export async function resolveJwtSecret(
  envSecret: string | undefined = process.env.JWT_SECRET,
  store: SystemSettingsStore = systemSettingsStore
): Promise<string> {
  if (isUsableSecret(envSecret)) {
    return envSecret;
  }
  if (process.env.NODE_ENV !== 'production') {
    return envSecret || DEV_SECRET;
  }

  if (envSecret) {
    console.warn('[Auth] JWT_SECRET is missing, too short (<32 chars) or a known placeholder; using a generated secret.');
  }
  const stored = await store.get<string | null>(SETTINGS_KEY, null);
  if (isUsableSecret(stored ?? undefined)) {
    return stored!;
  }
  const generated = crypto.randomBytes(48).toString('base64url');
  await store.set(SETTINGS_KEY, generated);
  return generated;
}
