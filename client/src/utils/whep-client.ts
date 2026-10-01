import { MediaHttpError } from './stream-errors.js';

export interface WhepConnectionOptions {
  iceServers?: RTCIceServer[];
  timeoutMs?: number;
  /** JWT for the /api/media proxy; defaults to the stored session token. */
  authToken?: string | null;
  /** Max time to wait for ICE gathering before sending the offer. */
  iceGatheringTimeoutMs?: number;
  onConnectionStateChange?: (state: RTCIceConnectionState) => void;
}

export interface WhepSession {
  stream: MediaStream;
  peerConnection: RTCPeerConnection;
  close: () => void;
}

/**
 * Establishes a WebRTC WHEP (WebRTC HTTP Egress Protocol) playback session with MediaMTX (LIVE-01).
 */
export async function connectWhep(
  whepUrl: string,
  options: WhepConnectionOptions = {}
): Promise<WhepSession> {
  const {
    iceServers = [],
    timeoutMs = 8000,
    onConnectionStateChange,
    iceGatheringTimeoutMs = 1500,
  } = options;
  const authToken =
    options.authToken ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('vms_token') : null);
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const pc = new RTCPeerConnection({ iceServers });
  const mediaStream = new MediaStream();

  // Add receive-only transceivers for audio and video
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  // Attach incoming media tracks
  pc.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      event.streams[0].getTracks().forEach((track) => {
        if (!mediaStream.getTracks().find((t) => t.id === track.id)) {
          mediaStream.addTrack(track);
        }
      });
    } else if (event.track) {
      if (!mediaStream.getTracks().find((t) => t.id === event.track.id)) {
        mediaStream.addTrack(event.track);
      }
    }
  };

  if (onConnectionStateChange) {
    pc.oniceconnectionstatechange = () => {
      onConnectionStateChange(pc.iceConnectionState);
    };
  }

  // Create and set local SDP offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // No trickle ICE: wait (bounded) for candidate gathering so the offer carries our
  // host/srflx/relay candidates. Relay candidates are what make TURN work.
  await waitForIceGathering(pc, iceGatheringTimeoutMs);
  const offerSdp = pc.localDescription?.sdp ?? offer.sdp;

  let sessionLocation: string | null = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        ...authHeaders,
      },
      body: offerSdp,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Keep status + body: MediaMTX explains failures (e.g. "codecs not supported by client")
      const body = await response.text().catch(() => '');
      throw new MediaHttpError(response.status, body.slice(0, 300), `WHEP negotiation failed: HTTP ${response.status} ${body.slice(0, 120)}`);
    }

    sessionLocation = response.headers.get('Location') || response.headers.get('location');

    const answerSdp = await response.text();
    await pc.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    pc.close();
    if (err instanceof MediaHttpError) throw err;
    throw new Error(err.name === 'AbortError' ? 'WHEP connection timed out' : err.message);
  }

  const close = () => {
    if (sessionLocation) {
      // whepUrl is usually same-origin relative (/api/media/...), so resolve via the page
      const base = new URL(whepUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
      const deleteUrl = new URL(sessionLocation, base).toString();
      fetch(deleteUrl, { method: 'DELETE', headers: authHeaders }).catch(() => {});
    }
    pc.close();
  };

  return {
    stream: mediaStream,
    peerConnection: pc,
    close,
  };
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}
