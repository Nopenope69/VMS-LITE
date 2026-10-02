/**
 * Deep link into Recordings: /playback?cameraId=<id>&t=<ISO time>, as used by alert
 * e-mails ("Open 24h Timeline Playback"). Returns null for any other address.
 */
export interface PlaybackLink {
  cameraId: string | null;
  timestampMs: number | null;
}

export function parsePlaybackLink(pathname: string, search: string): PlaybackLink | null {
  if (pathname.replace(/\/+$/, '') !== '/playback') return null;
  const params = new URLSearchParams(search);
  const t = Date.parse(params.get('t') ?? '');
  return {
    cameraId: params.get('cameraId') || null,
    timestampMs: Number.isFinite(t) ? t : null,
  };
}
