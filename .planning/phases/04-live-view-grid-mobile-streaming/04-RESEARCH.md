# Phase 4: Live View Grid & Mobile Streaming - Research

**Researched:** 2026-09-24  
**Domain:** WebRTC (WHEP), HLS fallback streaming, MediaMTX media plane, React multi-camera live grid, and Coturn NAT traversal  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from ROADMAP.md & PROJECT.md)

### Locked Decisions
- **MediaMTX as streaming server**: MediaMTX publishes RTSP feeds as WebRTC (WHEP) on port 8889 and HLS on port 8888. The web frontend communicates with MediaMTX endpoints directly for media data and Fastify for control/metadata.
- **Low-latency WebRTC (WHEP)**: Default live view player must use WHEP (WebRTC HTTP Egress Protocol) for sub-500ms latency (`LIVE-01`).
- **HLS Fallback**: Must automatically fall back to HLS (`index.m3u8`) if WebRTC connection times out, fails ICE gathering, or is unsupported (`LIVE-02`).
- **Multi-Camera Grid**: React web frontend must provide responsive 1x1 (single), 2x2 (quad), and 3x3 (nine) grid layouts (`LIVE-03`).
- **Mobile Remote View & NAT Traversal**: Coturn STUN/TURN server configuration must provide NAT traversal for remote mobile browsers on cellular networks (`LIVE-04`).
- **Zero VigilOne Domain Entanglement**: Completely clean-room React UI and Fastify streaming routes.
- **Permissive Licensing**: 100% MIT or Apache-2.0 dependencies (React, Vite, Lucide React, Hls.js). Zero copyleft.

### Discretionary Decisions
- **Stream resolution switching**: In 2x2 and 3x3 grid layouts, use `subStreamPath` when available to conserve client CPU and network bandwidth; use `mainStreamPath` in 1x1 or fullscreen mode.
- **ICE Configuration API**: Backend endpoint `GET /api/streaming/config` supplies WebRTC endpoints, HLS endpoints, and configured `iceServers` (STUN/TURN).
- **Client App Scaffolding**: Embed lightweight Vite + React client app with production build bundled or proxied by Fastify.

### Deferred Ideas (OUT OF SCOPE)
- PTZ controls & presets (Package 2 Extended: EXT-03)
- Multi-monitor wall layouts (Package 2 Extended: EXT-08)
- AI bounding box stream overlays (Package 3 AI: AI-01)
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebRTC WHEP negotiation | Web Frontend | MediaMTX (WHEP :8889) | Standard browser `RTCPeerConnection` exchanges SDP offer/answer directly with MediaMTX WHEP endpoint |
| HLS Fallback playback | Web Frontend | MediaMTX (HLS :8888) | Fallback uses `hls.js` or native Safari HLS player targeting MediaMTX `.m3u8` |
| Grid state & layout | Web Frontend (React) | LocalStorage / URL State | Grid configuration (1x1, 2x2, 3x3) and tile-to-camera assignments managed in client state |
| ICE Servers & Stream Config | Fastify API | Environment / Coturn | `GET /api/streaming/config` supplies STUN/TURN servers and base media URLs |
| NAT Traversal (STUN/TURN) | Coturn | MediaMTX & Browser | Handles reflexive and relay candidates for remote mobile clients |
</architectural_responsibility_map>

<research_summary>
## Research Summary

### 1. WebRTC WHEP Protocol (LIVE-01)
WHEP (WebRTC HTTP Egress Protocol) is an IETF draft standard supported natively by MediaMTX.
- **Endpoint**: `POST http://<mediamtx-host>:8889/<path>/whep`
- **Negotiation Flow**:
  1. Frontend instantiates `const pc = new RTCPeerConnection({ iceServers })`.
  2. Adds video and audio transceivers: `pc.addTransceiver('video', { direction: 'recvonly' })` and `pc.addTransceiver('audio', { direction: 'recvonly' })`.
  3. Creates SDP offer: `const offer = await pc.createOffer()`.
  4. Sets local description: `await pc.setLocalDescription(offer)`.
  5. Sends HTTP POST with headers `Content-Type: application/sdp` and body `offer.sdp`.
  6. MediaMTX returns HTTP 201 Created with `Content-Type: application/sdp` containing the SDP answer, plus a `Location` header URL used for session teardown via HTTP `DELETE`.
  7. Frontend sets remote description: `await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })`.
  8. Incoming media track is received via `pc.ontrack = (event) => { videoElement.srcObject = event.streams[0]; }`.
  9. Sub-500ms latency is achieved without transcoding overhead.

### 2. HLS Fallback Engine (LIVE-02)
When WebRTC connection fails (ICE connection timeout, corporate firewall blocking UDP, or non-WebRTC browser):
- **Endpoint**: `http://<mediamtx-host>:8888/<path>/index.m3u8`
- **Fallback Logic**:
  - Detect failure on `pc.oniceconnectionstatechange` (`failed` or `disconnected` after 5000ms timeout) or if WHEP HTTP POST fails.
  - Gracefully tear down RTCPeerConnection and switch the tile mode to `'hls'`.
  - In Safari (iOS / macOS): set `video.src = hlsUrl`.
  - In Chrome / Firefox: attach `Hls` from `hls.js` (`const hls = new Hls(); hls.loadSource(hlsUrl); hls.attachMedia(video);`).

### 3. Responsive Multi-Camera Grid (LIVE-03)
CCTV monitoring requires high visual clarity and fast switching between layouts:
- **Modes**:
  - `1x1`: Single focused camera (large viewport, Main Stream high resolution).
  - `2x2`: 4 camera streams in a 2-column, 2-row layout.
  - `3x3`: 9 camera streams in a 3-column, 3-row layout.
- **Tile Controls**:
  - Live indicator badge (green pulsing dot + "LIVE").
  - Protocol indicator badge ("WebRTC" in green or "HLS" in yellow).
  - Stream toggle ("Main" vs "Sub").
  - Mute/Unmute audio button (browser autoplay policy requires muted start).
  - Fullscreen / Solo maximize button.
- **Bandwidth & CPU Optimization**:
  - When in 2x2 or 3x3 layout, default to camera `subStreamPath` if available to prevent browser GPU decode exhaustion.
  - When soloed/maximized to 1x1, switch to `mainStreamPath`.

### 4. NAT Traversal & Coturn (LIVE-04)
For remote access from mobile devices outside the local LAN:
- **Coturn STUN/TURN**:
  - Provides STUN server on port 3478 (RFC 5389) and TURN relay on port 3478 / 5349.
  - MediaMTX configured with `webrtcAdditionalHosts` or STUN/TURN servers.
  - Fastify streaming route `GET /api/streaming/config` delivers the ICE server list to client `RTCPeerConnection`.
</research_summary>

<threat_model>
## Threat Model & Mitigations

| Threat ID | Severity | Description | Mitigation Strategy |
|-----------|----------|-------------|---------------------|
| **T-04-01** | High | Unauthorized access to live camera feeds and streaming configuration | `GET /api/streaming/config` requires JWT authentication. MediaMTX paths can be configured with read credentials or secured within trusted network boundary. |
| **T-04-02** | Medium | TURN server credential abuse by external attackers | Use short-lived time-limited TURN credentials (HMAC-SHA1 with expiration timestamp) or restrict TURN credentials to authenticated users. |
| **T-04-03** | High | Client denial of service / GPU crash via excessive concurrent 4K WebRTC streams | Limit max grid to 3x3 (9 tiles); automatically enforce Sub Stream for multi-camera tiles; clean up unmounted WebRTC peer connections. |
| **T-04-04** | Medium | XSS via malicious camera names in live grid tile headers | Sanitize camera names in React JSX rendering; use text nodes without `dangerouslySetInnerHTML`. |
</threat_model>
