/**
 * Human-readable timestamps for alerts, evidence bundles and handover documents.
 *
 * They use the appliance timezone: TZ (set in .env, also used to evaluate recording
 * schedules), else the host's zone, else UTC. The zone is always printed ("IST",
 * "GMT+4", "UTC") so a reader in another region knows what the time means.
 */

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function applianceTimeZone(): string {
  const configured = process.env.TZ?.trim();
  if (configured && isValidTimeZone(configured)) return configured;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** e.g. "25 Sept 2026, 13:45:22 IST" */
export function formatLocalTimestamp(date: Date = new Date(), timeZone: string = applianceTimeZone()): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: zone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

/**
 * Applies the timezone chosen in the first-boot wizard to this process: alert and
 * report timestamps and recording schedules then follow it. Returns false (and
 * changes nothing) for an unknown zone.
 */
export function applyApplianceTimeZone(timeZone: string | null | undefined): boolean {
  const zone = timeZone?.trim();
  if (!zone || !isValidTimeZone(zone)) return false;
  process.env.TZ = zone;
  return true;
}

export { isValidTimeZone };
