/**
 * Browser playback support for camera codecs.
 *
 * Recording works with any codec, but browsers only play H.264 reliably in live view.
 * H.265 (HEVC) plays in Safari and on some hardware, not in most Chrome/Firefox/Edge
 * installs. The fix on site is to set the camera's sub-stream to H.264: multi-camera
 * grids play the sub-stream while recordings keep the high-quality main stream.
 */

export function normalizeCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const c = codec.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c === 'H265' || c === 'HEVC') return 'H265';
  if (c === 'H264' || c === 'AVC') return 'H264';
  return codec;
}

export function codecLabel(codec: string | null | undefined): string {
  const c = normalizeCodec(codec);
  if (c === 'H265') return 'H.265';
  if (c === 'H264') return 'H.264';
  return c ?? 'Unknown';
}

/** True when browsers commonly cannot play this codec live */
export function isBrowserUnfriendlyCodec(codec: string | null | undefined): boolean {
  return normalizeCodec(codec) === 'H265';
}

/**
 * Codec of the stream live grids play: the sub-stream when the camera has one (null
 * while it has not been pulled yet: unknown is not a reason to warn), else the main stream.
 */
export function liveViewCodec(
  health: { videoCodec?: string | null; hasSubStream?: boolean; subVideoCodec?: string | null } | undefined
): string | null {
  if (!health) return null;
  if (health.hasSubStream || health.subVideoCodec) return health.subVideoCodec ?? null;
  return health.videoCodec ?? null;
}

export const H265_LIVE_HINT =
  'Live view uses an H.265 stream, which most browsers cannot play. Set the camera’s sub-stream to H.264 ' +
  '(camera web page: Video / Encoding / Sub Stream) and add it as the sub-stream. Recording is unaffected.';

export const H265_MAIN_HINT =
  'The main stream is H.265: grids use the H.264 sub-stream, but full-screen live view and recording playback ' +
  'need a browser that plays H.265 (Safari, or Chrome/Edge with hardware decoding). Set the main stream to H.264 ' +
  'if viewers use other browsers.';

/** Notes to show for a camera, most important first */
export function codecNotes(
  health: { videoCodec?: string | null; hasSubStream?: boolean; subVideoCodec?: string | null } | undefined
): string[] {
  if (isBrowserUnfriendlyCodec(liveViewCodec(health))) return [H265_LIVE_HINT];
  if (isBrowserUnfriendlyCodec(health?.videoCodec)) return [H265_MAIN_HINT];
  return [];
}

/** Picks the stream profile to use as sub-stream: prefer H.264 among non-main profiles */
export function pickSubProfile<T extends { rtspUri: string; isMainStream?: boolean; encoding?: string }>(
  profiles: T[],
  main: T | undefined
): T | undefined {
  const candidates = profiles.filter((p) => !p.isMainStream && p !== main);
  return candidates.find((p) => normalizeCodec(p.encoding) === 'H264') ?? candidates[0];
}
