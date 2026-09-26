# Phase 19 Research: Built-in SMTP Email Alerting

## Executive Summary
In SMB and residential CCTV deployments in India, third-party cloud APIs (such as WhatsApp Cloud API or Twilio) require active internet connectivity, Meta/Twilio business verification, credit cards, and periodic token maintenance. In contrast, standard SMTP email alerting provides a reliable, zero-subscription alerting channel that works immediately with any standard email account (e.g. Gmail App Password, Zoho Mail, local relay, Microsoft 365, Amazon SES, or on-premise postfix).

Furthermore, in accordance with the VMS-Lite Commercial Licensing Realignment, Basic Email Notifications is part of the **Core (Package 1)** baseline tier, ensuring all operators can receive incident alarms without requiring Pro/Extended licenses.

## Architectural Requirements
1. **Zero External Supply Chain Risk (Node Standard Library)**:
   - Implement an in-process RFC 5321 SMTP client using Node.js standard `node:net` and `node:tls` libraries.
   - Zero external third-party dependencies required. 100% MIT/Permissive compliance guaranteed without altering SBOM.
2. **Protocol Compatibility**:
   - Direct TLS (Port 465, SMTPS).
   - Plain TCP (Port 25 or Port 587) with opportunistic/required STARTTLS handshake.
   - Authentication: RFC 4954 `AUTH LOGIN` (Base64 username & password) and `AUTH PLAIN`.
   - MIME Formatting: RFC 2045/2046 `multipart/alternative` or clean `text/html; charset=utf-8` with UTF-8 Subject header encoding (`=?UTF-8?B?...?=`).
3. **EventBus Integration**:
   - Subscribes to events:
     - `motion.detected`: Camera motion alarms.
     - `camera.offline`: Camera disconnect or network failure.
     - `storage.warning`: Storage pool exceeding high watermark threshold (e.g. 80%).
4. **Anti-Flood Rate Limiting**:
   - In-memory `TokenBucketRateLimiter` keyed on `${cameraId}:${eventType}` with configurable cooldown (default: 60s, min: 10s).
   - Prevents cascading email inbox flooding during persistent wind/rain motion triggers.
5. **Rich Indian Standard Time (IST) HTML Template**:
   - Formatted for mobile email clients (iOS Mail, Gmail Android, Outlook).
   - Prominent event badge (Critical Red, Warning Amber, Info Blue).
   - Camera name, IP, timestamp in `en-IN` IST, event summary.
   - Deep-link button directly back to the timeline playback event.
6. **Masked Secrets Hygiene**:
   - Passwords returned via REST API are always masked (`********`).
   - Updates retaining masked placeholders do not overwrite the underlying encrypted or stored credential.
