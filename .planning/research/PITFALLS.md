# Pitfalls Research: Package 2 (Extended)

**Domain:** Commercial Video Management System (VMS) Extended Capabilities
**Researched:** 2026-09-24
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Unbounded PTZ Movement & Camera Runaway

**What goes wrong:**
An operator clicks and holds the PTZ joystick in the web browser. If the browser tab is closed, WiFi disconnects, or the user releases the mouse while the cursor is outside the browser window, the camera receives the `ContinuousMove` command but never receives the `Stop` command. The camera spins continuously until it hits physical stops, strains the motor, or wraps internal wiring.

**Why it happens:**
Relying on client-side `mouseup` / `touchend` events to send the `Stop` command without server-side watchdog enforcement.

**How to avoid:**
1. Implement a server-side **PTZ Watchdog Timer**: Whenever a `ContinuousMove` is initiated, schedule an automatic `Stop` command after 1500ms.
2. Require the client UI to send a periodic keepalive (e.g., every 500ms) while the operator holds down the joystick. If no keepalive arrives, the server watchdog halts movement immediately.

**Warning signs:**
- Camera pans 360 degrees uninterrupted after user switches tabs.
- Motor noise or gear strain on physical PTZ units during testing.

**Phase to address:**
Phase addressing PTZ Control (`extended.ptz`).

---

### Pitfall 2: CPU Starvation from FFmpeg Video Re-Encoding

**What goes wrong:**
When an operator requests an MP4 clip export, the server starts re-encoding multiple minutes of H.264/H.265 video. On a budget 4-core NVR host (common in Indian SMB deployments), CPU spikes to 100%. Live WebRTC playback stutters, MediaMTX drops incoming RTSP frames, and database queries time out.

**Why it happens:**
Treating clip export as a monolithic re-encoding pipeline (`ffmpeg -i ... -c:v libx264`) rather than utilizing packet-preserving stream copy.

**How to avoid:**
1. Default to **Fast Export**: Use FFmpeg concat demuxer with stream copy (`-c copy`). Concatenating fMP4 segments with packet copy takes under 1 second and consumes ~0% CPU.
2. Only run transcode filters (`drawtext` OSD burn-in) when explicitly requested by the user, and cap concurrent re-encoding jobs to `1` with low process priority (`nice -n 10`).

**Warning signs:**
- Live grid WebRTC latency climbs from 300ms to >5000ms during an export job.
- CPU load average exceeds number of available cores.

**Phase to address:**
Phase addressing Server-Side Clip Export (`extended.clip_export`).

---

### Pitfall 3: WhatsApp Alert Flooding & Account Suspension

**What goes wrong:**
During a sudden event (heavy rain, stray animals, swaying foliage), a camera triggers 60 motion events in 2 minutes. The VMS fires 60 consecutive WhatsApp messages to the society security group. Meta's anti-spam algorithms flag the WhatsApp Business account, suspending outbound API access, or Twilio incurs massive usage bills.

**Why it happens:**
Directly linking the raw `motion.detected` event bus output to external messaging webhooks without an aggregation or cooldown layer.

**How to avoid:**
1. Implement a **Token Bucket Rate Limiter**: Maximum 1 WhatsApp alert per camera per 60 seconds (configurable up to 5 minutes).
2. During active cooldown, aggregate subsequent triggers into a single count (e.g., *"14 motion triggers detected in the last 5 minutes"*).
3. Provide an active hours schedule (e.g., only send WhatsApp alerts between 11:00 PM and 06:00 AM).

**Warning signs:**
- Rapid bursts of 429 Too Many Requests from Meta Cloud API.
- Customer complaints of spam notifications on their personal WhatsApp.

**Phase to address:**
Phase addressing External Alert Dispatch (`extended.whatsapp_alerts`).

---

### Pitfall 4: Storage Saturation from Unmanaged Export Artifacts

**What goes wrong:**
Operators export 30-minute incident clips for police or society meetings. The generated MP4 files (500MB - 2GB each) sit in a local directory indefinitely. Within weeks, the system disk reaches 100% capacity, PostgreSQL halts write operations, and video recording aborts.

**Why it happens:**
Assuming users will manually delete downloaded clips, and omitting export storage from the FIFO disk quota monitor.

**How to avoid:**
1. Store exports in a designated directory (`/var/lib/basic-vms/exports/`).
2. Enforce a strict 48-hour Time-To-Live (TTL) on all exported files via an automated hourly garbage collector.
3. Integrate export directory sizing into the `StorageController` FIFO rollover rules.

**Warning signs:**
- Disk usage on `/var/lib/basic-vms` steadily increases regardless of recording quota.

**Phase to address:**
Phase addressing Server-Side Clip Export (`extended.clip_export`).

---

### Pitfall 5: Coordinate Drift in Motion Zones Across Aspect Ratios

**What goes wrong:**
An operator draws a motion polygon over a live video stream in a 16:9 1080p preview. When viewed on a mobile device or if the sub-stream switches to 640x360 or 4:3, the polygon mask shifts off-target, masking the wrong area or allowing false positives through.

**Why it happens:**
Storing polygon vertices as absolute pixel coordinates (e.g., `x: 450, y: 320`) instead of normalized unit vectors (`0.000` to `1.000`).

**How to avoid:**
1. Store all polygon points strictly as normalized floats: `[ { x: 0.25, y: 0.40 }, ... ]`.
2. Scale coordinates to the rendering container dynamically in the React SVG canvas.
3. Normalize incoming ONVIF motion coordinate bounding boxes before passing to the Ray-Casting algorithm.

**Warning signs:**
- Polygon borders shift when resizing browser window or switching between desktop and mobile.

**Phase to address:**
Phase addressing Motion Zones & Masking (`extended.motion_zones`).

---

### Pitfall 6: Unresponsive External Webhooks Blocking Event Bus

**What goes wrong:**
A customer configures an outbound webhook to an on-premise boom barrier controller. If the barrier controller goes offline, HTTP POST requests hang for 30 seconds before timing out, exhausting Node's socket pool and degrading control plane responsiveness.

**Why it happens:**
Awaiting HTTP network calls directly inside event bus listener callbacks without timeouts or background queueing.

**How to avoid:**
1. Use an asynchronous in-memory dispatch queue with a strict 3000ms timeout per HTTP request.
2. Apply exponential backoff with a maximum of 3 retries, followed by marking the webhook endpoint as unhealthy.

**Warning signs:**
- Event bus dispatch latency spikes when external endpoints are unreachable.

**Phase to address:**
Phase addressing External REST API & Webhooks (`extended.api_webhooks`).
