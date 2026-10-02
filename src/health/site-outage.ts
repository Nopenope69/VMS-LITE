import { CameraHealthStatus } from './health.types.js';

/**
 * Site link outage detection.
 *
 * A central server pulls every site's cameras over a VPN or port forwards. When that
 * link drops, every camera at the site fails at once; one "site unreachable" alert is
 * the useful signal, not one alert per camera.
 *
 * A site is SUSPECTED down when it has at least MIN_CAMERAS_FOR_SITE_OUTAGE cameras
 * with a network check and the last TCP probe of every one of them failed. It is DOWN
 * once all of those cameras are OFFLINE (the per-camera 30s rule), and back UP as soon
 * as any of them answers again.
 */

export const MIN_CAMERAS_FOR_SITE_OUTAGE = 2;

export interface SiteCameraSample {
  cameraId: string;
  siteId: string | null;
  status: CameraHealthStatus;
  /** false when the camera has no host to probe (no network check) */
  networkChecked: boolean;
  /** last TCP probe failed */
  unreachable: boolean;
}

export type SiteLinkState = 'UP' | 'SUSPECTED' | 'DOWN';

export interface SiteOutageTransition {
  siteId: string;
  type: 'site.offline' | 'site.online';
  cameraIds: string[];
  /** site.online: how long the site was down */
  outageDurationMs: number | null;
}

export class SiteOutageDetector {
  private readonly downSince = new Map<string, number>();
  private readonly states = new Map<string, SiteLinkState>();

  /**
   * Evaluates one health cycle. Returns the site transitions to announce; the link
   * state of every site is available through getState() afterwards.
   */
  evaluate(samples: SiteCameraSample[], now = Date.now()): SiteOutageTransition[] {
    const bySite = new Map<string, SiteCameraSample[]>();
    for (const sample of samples) {
      if (!sample.siteId || !sample.networkChecked) continue;
      bySite.set(sample.siteId, [...(bySite.get(sample.siteId) ?? []), sample]);
    }

    const transitions: SiteOutageTransition[] = [];
    for (const [siteId, cameras] of bySite) {
      const eligible = cameras.length >= MIN_CAMERAS_FOR_SITE_OUTAGE;
      const allUnreachable = eligible && cameras.every((c) => c.unreachable);
      const allOffline = allUnreachable && cameras.every((c) => c.status === 'OFFLINE');
      const previous = this.states.get(siteId) ?? 'UP';
      const cameraIds = cameras.map((c) => c.cameraId);

      let next: SiteLinkState;
      if (previous === 'DOWN') {
        next = allUnreachable ? 'DOWN' : 'UP';
      } else {
        next = allOffline ? 'DOWN' : allUnreachable ? 'SUSPECTED' : 'UP';
      }

      if (next === 'DOWN' && previous !== 'DOWN') {
        this.downSince.set(siteId, now);
        transitions.push({ siteId, type: 'site.offline', cameraIds, outageDurationMs: null });
      } else if (previous === 'DOWN' && next !== 'DOWN') {
        const since = this.downSince.get(siteId);
        this.downSince.delete(siteId);
        transitions.push({
          siteId,
          type: 'site.online',
          cameraIds,
          outageDurationMs: since !== undefined ? now - since : null,
        });
      }
      this.states.set(siteId, next);
    }

    // Sites that no longer have eligible cameras (deleted, moved) are forgotten
    for (const siteId of [...this.states.keys()]) {
      if (!bySite.has(siteId)) {
        this.states.delete(siteId);
        this.downSince.delete(siteId);
      }
    }
    return transitions;
  }

  getState(siteId: string | null | undefined): SiteLinkState {
    return (siteId && this.states.get(siteId)) || 'UP';
  }

  /** Sites currently down, with the time they went down */
  getDownSites(): Array<{ siteId: string; since: string }> {
    return [...this.downSince.entries()].map(([siteId, since]) => ({
      siteId,
      since: new Date(since).toISOString(),
    }));
  }

  reset(): void {
    this.states.clear();
    this.downSince.clear();
  }
}
