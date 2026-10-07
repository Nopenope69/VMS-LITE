import crypto from 'node:crypto';
import { MediaMtxClient, mediaMtxClient as defaultMediaMtx } from './mediamtx.client.js';

/**
 * Camera Media Paths: the one owner of how cameras map onto MediaMTX paths.
 *
 * - Naming: a camera's main path is stored on the camera; its sub-stream path is the
 *   stored sub path, or `<main>_sub`. Onboarding previews are `preview_<random>`.
 * - Desired state: main path always on (`sourceOnDemand: false`) with the record flag
 *   the recording schedule asks for; sub path on demand, never recorded.
 * - Browser URLs: always through the authenticated proxy under /api/media.
 * - Reconcile: MediaMTX does not persist API-added paths, so every scheduler tick puts
 *   each camera's paths back to the desired state and sweeps paths no camera owns.
 */

export const PREVIEW_PREFIX = 'preview_';
const PREVIEW_TTL_MS = 10 * 60 * 1000;
export const WHEP_BASE = '/api/media/whep';
export const HLS_BASE = '/api/media/hls';

export interface CameraPaths {
  mediaMtxPath: string;
  rtspUrl?: string | null;
  subMediaMtxPath?: string | null;
  subStreamUrl?: string | null;
}

export function subPathName(mainPath: string): string {
  return `${mainPath}_sub`;
}

export function isPreviewPath(name: string): boolean {
  return name.startsWith(PREVIEW_PREFIX);
}

/** The sub-stream path of a camera with a sub-stream, else null. */
export function subPathOf(camera: CameraPaths): string | null {
  if (camera.subMediaMtxPath) return camera.subMediaMtxPath;
  return camera.subStreamUrl ? subPathName(camera.mediaMtxPath) : null;
}

export const whepUrl = (path: string) => `${WHEP_BASE}/${path}/whep`;
export const hlsUrl = (path: string) => `${HLS_BASE}/${path}/index.m3u8`;

/** Proxy URLs the browser uses for a camera's live streams. */
export function streamUrls(camera: CameraPaths) {
  const sub = subPathOf(camera);
  return {
    mediaMtxPath: camera.mediaMtxPath,
    subStreamPath: sub,
    whepUrl: whepUrl(camera.mediaMtxPath),
    subStreamWhepUrl: sub ? whepUrl(sub) : null,
    hlsUrl: hlsUrl(camera.mediaMtxPath),
    subStreamHlsUrl: sub ? hlsUrl(sub) : null,
  };
}

/** Previews this process opened (shared by every instance); others with the prefix are stale. */
const livePreviews = new Set<string>();

export class CameraMediaPaths {
  /** Paths found without an owner on the previous sweep (removed if still orphaned). */
  private orphanCandidates = new Set<string>();

  constructor(private readonly mediaMtx: MediaMtxClient = defaultMediaMtx) {}

  /** Configures a new camera's paths; throws (after undoing them) if MediaMTX refuses. */
  async provision(camera: CameraPaths & { rtspUrl: string }, record: boolean): Promise<void> {
    try {
      if (!(await this.mediaMtx.setPath(camera.mediaMtxPath, { source: camera.rtspUrl, sourceOnDemand: false, record }))) {
        throw new Error(`Failed to configure main stream path in media plane: ${camera.mediaMtxPath}`);
      }
      const sub = subPathOf(camera);
      if (sub && camera.subStreamUrl) {
        if (!(await this.mediaMtx.setPath(sub, { source: camera.subStreamUrl, sourceOnDemand: true, record: false }))) {
          throw new Error(`Failed to configure sub-stream path in media plane: ${sub}`);
        }
      }
    } catch (err) {
      await this.remove(camera);
      throw err;
    }
  }

  async remove(camera: CameraPaths): Promise<void> {
    const sub = subPathOf(camera);
    if (sub) await this.mediaMtx.removePath(sub).catch(() => {});
    await this.mediaMtx.removePath(camera.mediaMtxPath).catch(() => {});
  }

  /** Puts one camera's paths back to the desired state (idempotent). */
  async reconcile(camera: CameraPaths, record: boolean, recordChanged: boolean): Promise<void> {
    if (!camera.rtspUrl) {
      // Source unknown (legacy callers): only drive the record flag on transitions
      if (recordChanged) await this.mediaMtx.patchPath(camera.mediaMtxPath, { record });
      return;
    }

    const main = await this.mediaMtx.getPath(camera.mediaMtxPath);
    if (!main || main.conf?.source !== this.mediaMtx.sanitizeRtspUrl(camera.rtspUrl)) {
      await this.mediaMtx.addPath(camera.mediaMtxPath, camera.rtspUrl, { sourceOnDemand: false, record });
    } else if (main.conf?.record !== record) {
      await this.mediaMtx.patchPath(camera.mediaMtxPath, { record });
    }

    const sub = subPathOf(camera);
    if (sub && camera.subStreamUrl) {
      const current = await this.mediaMtx.getPath(sub);
      if (!current || current.conf?.source !== this.mediaMtx.sanitizeRtspUrl(camera.subStreamUrl)) {
        await this.mediaMtx.addPath(sub, camera.subStreamUrl, { sourceOnDemand: true, record: false });
      }
    }
  }

  /**
   * Removes paths that belong to no camera and are not a live preview. A path must be
   * orphaned on two consecutive sweeps, so one created just before its camera is
   * saved survives. Returns the removed path names.
   */
  async sweepOrphans(cameras: CameraPaths[]): Promise<string[]> {
    const owned = new Set(cameras.flatMap((c) => [c.mediaMtxPath, subPathOf(c)].filter(Boolean) as string[]));
    const orphans = (await this.mediaMtx.listPaths())
      .map((p) => decodeURIComponent(p.name))
      .filter((name) => !owned.has(name) && !livePreviews.has(name));

    const removed: string[] = [];
    for (const name of orphans) {
      if (this.orphanCandidates.has(name)) {
        await this.mediaMtx.removePath(name).catch(() => {});
        removed.push(name);
      }
    }
    this.orphanCandidates = new Set(orphans.filter((name) => !removed.includes(name)));
    return removed;
  }

  /** Opens a temporary preview of an RTSP source; it closes itself after 10 minutes. */
  async openPreview(rtspUrl: string): Promise<{ pathName: string; whepUrl: string }> {
    const pathName = `${PREVIEW_PREFIX}${crypto.randomBytes(4).toString('hex')}`;
    await this.mediaMtx.addPath(pathName, rtspUrl, { record: false });
    livePreviews.add(pathName);
    const expiry = setTimeout(() => {
      this.closePreview(pathName).catch(() => {});
    }, PREVIEW_TTL_MS);
    expiry.unref?.();
    return { pathName, whepUrl: whepUrl(pathName) };
  }

  async closePreview(pathName: string): Promise<void> {
    if (!pathName || !isPreviewPath(pathName)) return;
    livePreviews.delete(pathName);
    await this.mediaMtx.removePath(pathName).catch(() => {});
  }

  async isReady(pathName: string): Promise<boolean> {
    const state = await this.mediaMtx.getPath(pathName).catch(() => null);
    return Boolean(state?.ready);
  }
}

export const cameraMediaPaths = new CameraMediaPaths();
