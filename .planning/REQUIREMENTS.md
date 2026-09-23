# Requirements: Basic VMS

**Defined:** 2026-09-24  
**Core Value:** Sub-30-minute installer deployment with reliable CP Plus parity (live view, scheduled recording, 24h timeline playback, native ONVIF motion alerts) built on permissively licensed infrastructure (MediaMTX) with zero VigilOne domain entanglement.

## v1 Requirements (Package 1: Core)

Requirements for initial release. Each maps to roadmap phases.

### Live Streaming & Media Plane

- [ ] **LIVE-01**: User can view live video stream from any configured camera via low-latency WebRTC (WHEP)
- [ ] **LIVE-02**: User can fallback to HLS live stream if WebRTC fails or client does not support WebRTC
- [ ] **LIVE-03**: User can view multiple cameras simultaneously in a responsive grid layout (1x1, 2x2, 3x3)
- [ ] **LIVE-04**: User can access live streams remotely from mobile browser via STUN/relay/coturn traversal

### Camera Discovery & Management

- [ ] **CAM-01**: Integrator can automatically discover IP cameras on the local network via ONVIF WS-Discovery probe
- [ ] **CAM-02**: Integrator can authenticate and onboard discovered ONVIF Profile T cameras with Profile S fallback
- [ ] **CAM-03**: Integrator can manually add RTSP camera streams when ONVIF discovery is unavailable
- [ ] **CAM-04**: System isolates all camera operations behind an internal `CameraProvider` adapter interface
- [ ] **CAM-05**: System automatically syncs camera streams with MediaMTX configuration paths

### Recording & Storage Management

- [ ] **REC-01**: System records video streams continuously in packet-preserving fMP4 segments without re-encoding
- [ ] **REC-02**: System supports scheduled recording windows per camera (e.g. business hours vs after-hours)
- [ ] **REC-03**: System captures segment completion events via MediaMTX `runOnRecordSegmentComplete` hook and records metadata into the PostgreSQL catalog
- [ ] **REC-04**: System monitors disk usage on the storage mount and emits storage warning/full events
- [ ] **REC-05**: System automatically purges the oldest recording segments when disk capacity threshold is exceeded (rollover)

### Playback & Timeline

- [ ] **PLAY-01**: User can view a 24-hour visual activity and recording timeline for any selected camera
- [ ] **PLAY-02**: User can scrub and seek to any point in the recorded timeline
- [ ] **PLAY-03**: System streams recorded video segments via MediaMTX playback server (`/list` and `/get` endpoints)
- [ ] **PLAY-04**: User can pause, resume, and step through recorded footage

### Event Framework & Motion Alerting

- [x] **EVT-01**: System maintains a unified `events` schema (`id`, `camera_id`, `timestamp`, `type`, `source`, `severity`, `metadata`)
- [x] **EVT-02**: System logs Core lifecycle events (`camera.online/offline`, `recording.started/stopped`, `storage.warning/full`)
- [ ] **EVT-03**: System subscribes to native camera motion events via ONVIF Profile T PullPoint / WS-BaseNotification
- [ ] **EVT-04**: System emits `motion.detected` events to the Core event bus upon receiving ONVIF motion alerts
- [ ] **EVT-05**: User receives real-time motion alert notifications in the web client via WebSocket stream

### Authentication, RBAC & Licensing

- [x] **AUTH-01**: System enforces single-site 2-role RBAC: Admin (full configuration and monitoring) and Viewer (monitoring only)
- [x] **AUTH-02**: System issues JWT session tokens upon login and persists session across browser reloads
- [x] **LIC-01**: System verifies offline Ed25519-signed license documents at boot (signature, product, edition, camera limits, expiration)
- [x] **LIC-02**: System resolves valid license into a Capability Registry (`capabilities.has(...)`)
- [x] **LIC-03**: System isolates module route namespaces and frontend bundles based on capability status (Package 1 Core by default)
- [x] **LIC-04**: System isolates licensing logic into a clean-room standalone module with zero VigilOne domain or tenant references

### Deployment & Packaging

- [ ] **DEP-01**: Integrator can execute a single-command installer to provision Node, MediaMTX, PostgreSQL, and Coturn
- [ ] **DEP-02**: Integrator can achieve first live view on customer hardware in under 30 minutes
- [ ] **DEP-03**: CI automatically generates release Software Bill of Materials (SBOM) and license inventory (`third_party/licenses/`, `third_party/notices/`)
- [ ] **DEP-04**: Release build verifies 100% permissive licensing compliance (MIT, Apache-2.0, BSD)

---

## v2 Requirements (Package 2: Extended)

Deferred to fast-follow release. Tracked but not in current Package 1 roadmap.

### Extended Capabilities

- **EXT-01**: Operator role with granular per-camera permissions
- **EXT-02**: Motion zones and exclusion masks
- **EXT-03**: PTZ control and camera presets
- **EXT-04**: Basic MP4 clip export (standard media export without evidentiary chain)
- **EXT-05**: Timeline bookmarks and annotations
- **EXT-06**: Camera health monitoring and latency diagnostics
- **EXT-07**: WhatsApp and SMS alert dispatch channels
- **EXT-08**: Basic external REST API and outgoing webhooks

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
| LIVE-01 | Phase 4 | Pending |
| LIVE-02 | Phase 4 | Pending |
| LIVE-03 | Phase 4 | Pending |
| LIVE-04 | Phase 4 | Pending |
| CAM-01 | Phase 2 | Pending |
| CAM-02 | Phase 2 | Pending |
| CAM-03 | Phase 2 | Pending |
| CAM-04 | Phase 2 | Pending |
| CAM-05 | Phase 2 | Pending |
| REC-01 | Phase 3 | Pending |
| REC-02 | Phase 3 | Pending |
| REC-03 | Phase 3 | Pending |
| REC-04 | Phase 3 | Pending |
| REC-05 | Phase 3 | Pending |
| PLAY-01 | Phase 5 | Pending |
| PLAY-02 | Phase 5 | Pending |
| PLAY-03 | Phase 5 | Pending |
| PLAY-04 | Phase 5 | Pending |
| EVT-01 | Phase 1 | Complete |
| EVT-02 | Phase 1 | Complete |
| EVT-03 | Phase 6 | Pending |
| EVT-04 | Phase 6 | Pending |
| EVT-05 | Phase 6 | Pending |
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| LIC-01 | Phase 1 | Complete |
| LIC-02 | Phase 1 | Complete |
| LIC-03 | Phase 1 | Complete |
| LIC-04 | Phase 1 | Complete |
| DEP-01 | Phase 7 | Pending |
| DEP-02 | Phase 7 | Pending |
| DEP-03 | Phase 7 | Pending |
| DEP-04 | Phase 7 | Pending |
| EXT-01 | Deferred | v2 Extended |
| EXT-02 | Deferred | v2 Extended |
| EXT-03 | Deferred | v2 Extended |
| EXT-04 | Deferred | v2 Extended |
| EXT-05 | Deferred | v2 Extended |
| EXT-06 | Deferred | v2 Extended |
| EXT-07 | Deferred | v2 Extended |
| EXT-08 | Deferred | v2 Extended |
| AI-01 | Deferred | v3 AI |
| AI-02 | Deferred | v3 AI |
| AI-03 | Deferred | v3 AI |
| AI-04 | Deferred | v3 AI |

**Coverage:**

- v1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-24*
*Last updated: 2026-09-24 after initial definition*
