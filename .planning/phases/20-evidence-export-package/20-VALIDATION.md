# Phase 20 Validation Strategy: Self-Verifying Evidence Export Package

## Test Criteria
1. **Archive Integrity**:
   - Generated `.zip` bundle is recognized and extractable by standard archive utilities (`unzip`, Python `zipfile`, Windows Explorer, macOS Archive Utility).
   - Contains all 4 mandatory files: `video.mp4`, `manifest.json`, `audit.json`, `verify.js`.
2. **Cryptographic Consistency**:
   - `manifest.json` contains valid SHA-256 for `video.mp4` matching the actual file content.
   - `audit.json` contains accurate user identity (ID, username, role), requester client IP, node environment, camera metadata, and incident bookmarks.
3. **Standalone Verifier Execution**:
   - Running `node verify.js` in the extracted directory executes cleanly with exit code 0 and logs `INTEGRITY VERIFIED`.
   - Modifying a single byte of `video.mp4` causes `node verify.js` to report `INTEGRITY COMPROMISED` and exit with code 1.
4. **REST API Endpoints**:
   - `GET /api/recordings/export/:id/bundle`: Protected by JWT authentication and `extended.clip_export` capability.
   - Returns MIME `application/zip` with `Content-Disposition: attachment; filename="EVIDENCE_EXPORT_{exportId}_{timestamp}.zip"`.
   - Returns 404 if export job does not exist or has not completed.
5. **Frontend UI**:
   - `ClipExportModal.tsx` provides both "Download Evidence Package (.ZIP)" and "Download MP4 Clip" options with clear explanatory badges.
