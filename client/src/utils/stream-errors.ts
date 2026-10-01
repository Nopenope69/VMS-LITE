/**
 * Why a live stream could not be shown. Kept separate from the player so the copy
 * shown to operators always matches the real cause: a browser that cannot decode
 * H.265 must not be reported as "camera offline".
 */
export type StreamFailureKind = 'unsupported_codec' | 'forbidden' | 'no_stream' | 'unreachable' | 'unknown';

export interface StreamFailure {
  kind: StreamFailureKind;
  detail?: string;
}

/** HTTP failure from the media proxy (WHEP signalling or HLS playlist). */
export class MediaHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message?: string
  ) {
    super(message ?? `HTTP ${status}${body ? `: ${body}` : ''}`);
    this.name = 'MediaHttpError';
  }
}

export function classifyHttpFailure(status: number, body = ''): StreamFailure {
  const text = body.toLowerCase();
  if (text.includes('codec')) return { kind: 'unsupported_codec', detail: body };
  if (status === 401 || status === 403) return { kind: 'forbidden' };
  // MediaMTX answers 404 when the path exists but the camera is not delivering video
  if (status === 404 || text.includes('no stream is available')) return { kind: 'no_stream' };
  if (status === 502 || status === 503 || status === 504) return { kind: 'unreachable' };
  return { kind: 'unknown', detail: body || `HTTP ${status}` };
}

export function classifyError(err: unknown): StreamFailure {
  if (err instanceof MediaHttpError) return classifyHttpFailure(err.status, err.body);
  const message = String((err as Error)?.message ?? err);
  if (/codec/i.test(message)) return { kind: 'unsupported_codec', detail: message };
  if (/timed out|failed to fetch|networkerror|load failed/i.test(message)) return { kind: 'unreachable' };
  return { kind: 'unknown', detail: message };
}

/** HTMLMediaElement error codes (MediaError.code). */
export function classifyMediaElementError(code: number | undefined): StreamFailure {
  // 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
  if (code === 3 || code === 4) return { kind: 'unsupported_codec' };
  if (code === 2) return { kind: 'unreachable' };
  return { kind: 'unknown' };
}

export const FAILURE_COPY: Record<StreamFailureKind, { title: string; hint: string }> = {
  unsupported_codec: {
    title: 'VIDEO FORMAT NOT SUPPORTED BY THIS BROWSER',
    hint: 'The camera is online but its codec (often H.265) cannot be played here. Use Chrome, Edge or Safari, or set the camera to H.264.',
  },
  forbidden: {
    title: 'NO PERMISSION FOR THIS CAMERA',
    hint: 'Ask an administrator to grant live view, or sign in again.',
  },
  no_stream: {
    title: 'NO SIGNAL - CAMERA NOT SENDING VIDEO',
    hint: 'Check the camera network cable, PoE power, or the link to the remote site.',
  },
  unreachable: {
    title: 'VIDEO SERVER UNREACHABLE',
    hint: 'The appliance media service did not respond. Check the connection to the server.',
  },
  unknown: {
    title: 'UNABLE TO PLAY VIDEO',
    hint: 'Retry, or check the camera and appliance status.',
  },
};
