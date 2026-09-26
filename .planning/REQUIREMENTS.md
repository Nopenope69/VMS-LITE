# Requirements: Basic VMS

**Defined:** 2026-09-24  
**Core Value:** Sub-30-minute installer deployment with reliable CP Plus parity (live view, scheduled recording, 24h timeline playback, native ONVIF motion alerts) built on permissively licensed infrastructure (MediaMTX) with zero VigilOne domain entanglement.

## v1 Requirements (Package 1: Core)

Requirements for initial release. Each maps to roadmap phases.

### Live Streaming & Media Plane

- [x] **LIVE-01**: User can view live video stream from any configured camera via low-latency WebRTC (WHEP)
- [x] **LIVE-02**: User can fallback to HLS live stream if WebRTC fails or client does not support WebRTC
- [x] **LIVE-03**: User can view multiple cameras simultaneously in a responsive grid layout (1x1, 2x2, 3x3)
- [x] **LIVE-04**: User can access live streams remotely from mobile browser via STUN/relay/coturn traversal

### Camera Discovery & Management

- [x] **CAM-01**: Integrator can automatically discover IP cameras on the local network via ONVIF WS-Discovery probe
- [x] **CAM-02**: Integrator can authenticate and onboard discovered ONVIF Profile T cameras with Profile S fallback
- [x] **CAM-03**: Integrator can manually add RTSP camera streams when ONVIF discovery is unavailable
- [x] **CAM-04**: System isolates all camera operations behind an internal `CameraProvider` adapter interface
- [x] **CAM-05**: System automatically syncs camera streams with MediaMTX configuration paths

### Recording & Storage Management

- [x] **REC-01**: System records video streams continuously in packet-preserving fMP4 segments without re-encoding
- [x] **REC-02**: System supports scheduled recording windows per camera (e.g. business hours vs after-hours)
- [x] **REC-03**: System captures segment completion events via MediaMTX `runOnRecordSegmentComplete` hook and records metadata into the PostgreSQL catalog
- [x] **REC-04**: System monitors disk usage on the storage mount and emits storage warning/full events
- [x] **REC-05**: System automatically purges the oldest recording segments when disk capacity threshold is exceeded (rollover)

### Playback & Timeline

- [x] **PLAY-01**: User can view a 24-hour visual activity and recording timeline for any selected camera
- [x] **PLAY-02**: User can scrub and seek to any point in the recorded timeline
- [x] **PLAY-03**: System streams recorded video segments via MediaMTX playback server (`/list` and `/get` endpoints)
- [x] **PLAY-04**: User can pause, resume, and step through recorded footage

### Event Framework & Motion Alerting

- [x] **EVT-01**: System maintains a unified `events` schema (`id`, `camera_id`, `timestamp`, `type`, `source`, `severity`, `metadata`)
- [x] **EVT-02**: System logs Core lifecycle events (`camera.online/offline`, `recording.started/stopped`, `storage.warning/full`)
- [x] **EVT-03**: System subscribes to native camera motion events via ONVIF Profile T PullPoint / WS-BaseNotification
- [x] **EVT-04**: System emits `motion.detected` events to the Core event bus upon receiving ONVIF motion alerts
- [x] **EVT-05**: User receives real-time motion alert notifications in the web client via WebSocket stream

### Authentication, RBAC & Licensing

- [x] **AUTH-01**: System enforces single-site 2-role RBAC: Admin (full configuration and monitoring) and Viewer (monitoring only)
- [x] **AUTH-02**: System issues JWT session tokens upon login and persists session across browser reloads
- [x] **LIC-01**: System verifies offline Ed25519-signed license documents at boot (signature, product, edition, camera limits, expiration)
- [x] **LIC-02**: System resolves valid license into a Capability Registry (`capabilities.has(...)`)
- [x] **LIC-03**: System isolates module route namespaces and frontend bundles based on capability status (Package 1 Core by default)
- [x] **LIC-04**: System isolates licensing logic into a clean-room standalone module with zero VigilOne domain or tenant references

### Deployment & Packaging

- [x] **DEP-01**: Integrator can execute a single-command installer to provision Node, MediaMTX, PostgreSQL, and Coturn
- [x] **DEP-02**: Integrator can achieve first live view on customer hardware in under 30 minutes
- [x] **DEP-03**: CI automatically generates release Software Bill of Materials (SBOM) and license inventory (`third_party/licenses/`, `third_party/notices/`)
- [x] **DEP-04**: Release build verifies 100% permissive licensing compliance (MIT, Apache-2.0, BSD)

---

## v2 Requirements (Package 2: Extended)

Active requirements for Milestone v2.0. Each maps directly to roadmap phases.

### Access Control & Operator Workflow
- [x] **EXT-01**: User can assign users the `OPERATOR` role with per-camera permission ACLs (live view, playback, PTZ, bookmarks), preventing unauthorized configuration changes while enabling shift monitoring. (Validated in Phase 8)

### Motion Masking & Spatial Filtering
- [ ] **EXT-02**: User can draw inclusion and exclusion polygon zones on camera feeds to filter out environmental false positives (swaying branches, traffic) using normalized ray-casting coordinate containment.

### Camera PTZ Controls
- [x] **EXT-03**: User can control ONVIF Profile S Pan-Tilt-Zoom cameras using an on-screen joystick pad, optical zoom controls, preset positions, and a 1.5-second server-side safety watchdog auto-stop. (Validated in Phase 9)

### Video Export & Watermarking
- [x] **EXT-04**: User can export recorded time ranges into standalone MP4 video files with optional burned-in timestamp OSD and camera watermark, served with SHA-256 integrity verification and automated 48-hour disk pruning. (Validated in Phase 10)

### Timeline Bookmarking
- [x] **EXT-05**: User can mark incident timestamps on the 24-hour playback timeline with title, description, and category tags, visible as color-coded pins with search and filtering. (Validated in Phase 10)

### Diagnostics & Telemetry
- [ ] **EXT-06**: System continuously tracks camera health, latency, RTSP packet drops, and MediaMTX stream bitrates, raising `camera.degraded` and `camera.offline` events upon failure.

### WhatsApp & SMS Alerting
- [ ] **EXT-07**: System can dispatch critical motion alert messages with snapshot links directly to WhatsApp / SMS recipients with token-bucket rate limiting and anti-spam cooldowns.

### Integrations & Webhooks
- [ ] **EXT-08**: System can dispatch HMAC-SHA256 signed outbound webhooks on system events to integrate with barrier gates, RFID turnstiles, and building management systems.

---

## Future Scope (Package 3: AI)

Deferred to Package 3. Requires separate detection service behind internal API.

### AI Capabilities

- **AI-01**: Object and person detection using ONNX Runtime / OpenVINO
- **AI-02**: Smart temporal search filtered by detected object class
- **AI-03**: Automatic Number Plate Recognition (ANPR)
- **AI-04**: Facial recognition and watchlist alerting

---

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-tenant organization hierarchy | Budget SMB/residential buyers run single-site systems; multi-tenancy adds needless architectural and authentication complexity. |
| Evidentiary export (Section 63 BSA certificate) | Differentiator for VigilOne enterprise compliance tier; basic MP4 clip export belongs in Package 2. |
| Computer vision / AI detection in base install | Consumes excessive CPU on low-cost hardware; Package 1 must ship with zero AI dependencies. |
| Multi-site federation | High distributed systems cost (WAN sync, clock skew, cross-site auth) inappropriate for standalone NVR tier. |
| Cloud / offsite archive | Local disk storage matches CP Plus baseline; cloud sync deferred. |
| Video re-encoding / transcoding | Burns CPU on budget hosts; MediaMTX packet-preserving segmenting is used instead. |

---

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIVE-01 | Phase 4 | Complete |
| LIVE-02 | Phase 4 | Complete |
| LIVE-03 | Phase 4 | Complete |
| LIVE-04 | Phase 4 | Complete |
| CAM-01 | Phase 2 | Complete |
| CAM-02 | Phase 2 | Complete |
| CAM-03 | Phase 2 | Complete |
| CAM-04 | Phase 2 | Complete |
| CAM-05 | Phase 2 | Complete |
| REC-01 | Phase 3 | Complete |
| REC-02 | Phase 3 | Complete |
| REC-03 | Phase 3 | Complete |
| REC-04 | Phase 3 | Complete |
| REC-05 | Phase 3 | Complete |
| PLAY-01 | Phase 5 | Complete |
| PLAY-02 | Phase 5 | Complete |
| PLAY-03 | Phase 5 | Complete |
| PLAY-04 | Phase 5 | Complete |
| EVT-01 | Phase 1 | Complete |
| EVT-02 | Phase 1 | Complete |
| EVT-03 | Phase 6 | Complete |
| EVT-04 | Phase 6 | Complete |
| EVT-05 | Phase 6 | Complete |
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| LIC-01 | Phase 1 | Complete |
| LIC-02 | Phase 1 | Complete |
| LIC-03 | Phase 1 | Complete |
| LIC-04 | Phase 1 | Complete |
| DEP-01 | Phase 7 | Complete |
| DEP-02 | Phase 7 | Complete |
| DEP-03 | Phase 7 | Complete |
| DEP-04 | Phase 7 | Complete |
| EXT-01 | Phase 8 | Complete |
| EXT-02 | Phase 11 | Planned |
| EXT-03 | Phase 9 | Complete |
| EXT-04 | Phase 10 | Planned |
| EXT-05 | Phase 10 | Planned |
| EXT-06 | Phase 12 | Planned |
| EXT-07 | Phase 12 | Planned |
| EXT-08 | Phase 12 | Planned |
| AI-01 | Deferred | v3 AI |
| AI-02 | Deferred | v3 AI |
| AI-03 | Deferred | v3 AI |
| AI-04 | Deferred | v3 AI |

**Coverage:**

- v1 Core requirements: 32 total (32 complete)
- v2 Extended requirements: 8 total (8 mapped to Phases 8-12)
- Mapped to phases: 40
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-24*
*Last updated: 2026-09-24 after initial definition*
