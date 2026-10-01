import path from 'node:path';

/**
 * Absolute directory MediaMTX writes segments to (shared volume with the app).
 * RECORDING_STORAGE_PATH is accepted for older docker-compose files.
 */
export function getRecordingsRoot(override?: string): string {
  return path.resolve(
    override || process.env.RECORDINGS_PATH || process.env.RECORDING_STORAGE_PATH || '/var/recordings'
  );
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(root + path.sep);
}
