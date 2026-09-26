export interface WhepConnectionOptions {
  iceServers?: RTCIceServer[];
  timeoutMs?: number;
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
  const { iceServers = [{ urls: 'stun:stun.l.google.com:19302' }], timeoutMs = 8000, onConnectionStateChange } = options;

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

  // Wait for initial ICE candidates gathering or proceed with trickled offer
  let sessionLocation: string | null = null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`WHEP negotiation failed: HTTP ${response.status} ${response.statusText}`);
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
    throw new Error(err.name === 'AbortError' ? 'WHEP connection timed out' : err.message);
  }

  const close = () => {
    if (sessionLocation) {
      const deleteUrl = sessionLocation.startsWith('http')
        ? sessionLocation
        : new URL(sessionLocation, whepUrl).toString();
      fetch(deleteUrl, { method: 'DELETE' }).catch(() => {});
    }
    pc.close();
  };

  return {
    stream: mediaStream,
    peerConnection: pc,
    close,
  };
}
