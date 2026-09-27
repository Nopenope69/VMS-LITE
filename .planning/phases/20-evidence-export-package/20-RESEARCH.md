# Phase 20 Research: Self-Verifying Evidence Export Package (Workstream 2.5 / MVP-13)

## Executive Summary
Exporting raw `.mp4` video files is insufficient for evidentiary chain-of-custody in legal, insurance, or law enforcement scenarios (e.g. Indian Evidence Act section 65B requirements or police FIR investigations). Raw files can be challenged as potentially edited, re-encoded, or spliced. 

Workstream 2.5 upgrades incident exports into a self-verifying evidence bundle packaged as a signed `.zip` archive containing:
1. `video.mp4` - The raw stitched stream-copy or OSD derivative.
2. `manifest.json` - Cryptographic manifest containing export ID, camera info, time window, requester identity, file size, and calculated SHA-256 hash.
3. `audit.json` - System audit record documenting host OS, node version, client IP, request timestamp in IST, and timeline bookmarks active during the clip window.
4. `verify.js` - Portable, zero-dependency Node.js verification script that can be executed anywhere (`node verify.js`) to cryptographically verify byte integrity in 2 seconds.

## ZIP Generation Architecture
- Standard ZIP file specification (PKWARE AppNote).
- Using Node.js standard libraries (`node:fs`, `node:zlib`, `node:crypto`).
- Built-in `zlib.crc32` in Node.js 20 LTS computes CRC-32 checksums for each archive entry without external packages.
- Zero external third-party dependencies required. 100% Permissive licensing (MIT) preserved.
- Storing video files with `compressionMethod: 0` (STORE) avoids re-compressing already high-efficiency H.264/H.265 bitstreams, ensuring instant bundle generation (<1 second) with minimal CPU usage on budget appliance hardware.

## Verifier Script Specification (`verify.js`)
- Completely standalone: requires no `npm install`, imports only built-in `fs`, `path`, and `crypto`.
- Reads `manifest.json`.
- Streams `video.mp4`, computes SHA-256 in chunks.
- Validates that the calculated SHA-256 matches the manifest.
- Outputs human-readable verification log:
  ```text
  [VERIFY] Reading manifest.json... OK (Export ID: exp-...)
  [VERIFY] Reading video.mp4 (42,158,900 bytes)... OK
  [VERIFY] Calculating SHA-256 checksum...
  [VERIFY] Calculated: <hash>
  [VERIFY] Expected:   <hash>
  [RESULT] INTEGRITY VERIFIED: Video has not been modified or tampered with.
  ```
- Exits with return code 0 on success, code 1 on tamper/mismatch.
