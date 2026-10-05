import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SegmentValidator, validateMp4ContainerHeader } from '../src/recordings/segment-validator.js';

describe('SegmentValidator (zero-fsync media verification)', () => {
  let root: string;
  let validator: SegmentValidator;
  let fixedNow: number;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-validator-'));
    fixedNow = Date.parse('2026-10-06T12:00:30.000Z');
    validator = new SegmentValidator({
      recordingsRoot: root,
      quietPeriodMs: 15_000,
      minSizeBytes: 1024,
      now: () => fixedNow,
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function createValidFmp4Buffer(size = 2048): Buffer {
    const buf = Buffer.alloc(size);
    // Write 32-bit length = 24 bytes
    buf.writeUInt32BE(24, 0);
    // Write 4-byte box type = 'ftyp'
    buf.write('ftyp', 4, 'ascii');
    // Major brand: 'isom'
    buf.write('isom', 8, 'ascii');
    // Minor version: 0x00000200
    buf.writeUInt32BE(512, 12);
    // Compatible brands: 'isom', 'mp42'
    buf.write('isom', 16, 'ascii');
    buf.write('mp42', 20, 'ascii');
    return buf;
  }

  it('validates a valid fMP4 container box header', () => {
    const validBuf = createValidFmp4Buffer(64);
    const result = validateMp4ContainerHeader(validBuf);
    expect(result.valid).toBe(true);
    expect(result.primaryBox).toBe('ftyp');
  });

  it('rejects corrupt or unrecognized container headers', () => {
    const corruptBuf = Buffer.from('NOT_AN_MP4_FILE_JUST_SOME_GARBAGE');
    const result = validateMp4ContainerHeader(corruptBuf);
    expect(result.valid).toBe(false);
  });

  it('accepts a valid quiescent fMP4 segment on disk and extracts lifecycle metadata', async () => {
    const segmentName = '2026-10-06_12-00-00.mp4';
    const filePath = path.join(root, segmentName);
    await fs.writeFile(filePath, createValidFmp4Buffer(4096));

    // Set mtime to 20 seconds before fixedNow (outside 15s quiet period)
    const mtime = new Date(fixedNow - 20_000);
    await fs.utimes(filePath, mtime, mtime);

    const res = await validator.validate({
      filePath,
      recordingsRoot: root,
      mediaMtxPath: 'cam1',
      duration: 30,
      computeSha256: true,
    });

    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.status).toBe('AVAILABLE');
      expect(res.streamRole).toBe('PRIMARY');
      expect(res.retentionTier).toBe('CONTINUOUS');
      expect(res.sizeBytes).toBe(4096);
      expect(res.duration).toBe(30);
      expect(res.startTime.toISOString()).toBe('2026-10-06T12:00:00.000Z');
      expect(res.endTime.toISOString()).toBe('2026-10-06T12:00:30.000Z');
      expect(res.sha256).toBeDefined();
      expect(res.sha256?.length).toBe(64);
    }
  });

  it('flags segment still in quiet period as VALIDATING (in flight)', async () => {
    const segmentName = '2026-10-06_12-00-25.mp4';
    const filePath = path.join(root, segmentName);
    await fs.writeFile(filePath, createValidFmp4Buffer(4096));

    // File was modified 5 seconds ago (within 15s quiet period)
    const mtime = new Date(fixedNow - 5_000);
    await fs.utimes(filePath, mtime, mtime);

    const res = await validator.validate({
      filePath,
      recordingsRoot: root,
      mediaMtxPath: 'cam1',
      duration: 30,
    });

    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.status).toBe('VALIDATING');
      expect(res.reason).toBe('QUIET_PERIOD_IN_FLIGHT');
    }
  });

  it('quarantines files below minimum size threshold', async () => {
    const segmentName = '2026-10-06_12-00-00.mp4';
    const filePath = path.join(root, segmentName);
    // Only 200 bytes
    await fs.writeFile(filePath, createValidFmp4Buffer(200));

    const mtime = new Date(fixedNow - 30_000);
    await fs.utimes(filePath, mtime, mtime);

    const res = await validator.validate({
      filePath,
      recordingsRoot: root,
      mediaMtxPath: 'cam1',
    });

    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.status).toBe('QUARANTINED');
      expect(res.reason).toBe('FILE_TOO_SMALL');
    }
  });

  it('quarantines files with corrupt container headers', async () => {
    const segmentName = '2026-10-06_12-00-00.mp4';
    const filePath = path.join(root, segmentName);
    // 2048 bytes of zeros / garbage (no valid box)
    await fs.writeFile(filePath, Buffer.alloc(2048, 0xff));

    const mtime = new Date(fixedNow - 30_000);
    await fs.utimes(filePath, mtime, mtime);

    const res = await validator.validate({
      filePath,
      recordingsRoot: root,
      mediaMtxPath: 'cam1',
    });

    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.status).toBe('QUARANTINED');
      expect(res.reason).toBe('INVALID_CONTAINER');
    }
  });

  it('quarantines paths that escape recordings root', async () => {
    const res = await validator.validate({
      filePath: '/etc/shadow',
      recordingsRoot: root,
      mediaMtxPath: 'cam1',
    });

    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.status).toBe('QUARANTINED');
      expect(res.reason).toBe('OUTSIDE_ROOT');
    }
  });

  it('assigns SUB streamRole when marked as sub-stream', async () => {
    const segmentName = '2026-10-06_12-00-00.mp4';
    const filePath = path.join(root, segmentName);
    await fs.writeFile(filePath, createValidFmp4Buffer(2048));

    const mtime = new Date(fixedNow - 30_000);
    await fs.utimes(filePath, mtime, mtime);

    const res = await validator.validate({
      filePath,
      recordingsRoot: root,
      mediaMtxPath: 'cam1_sub',
      isSubStream: true,
    });

    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.streamRole).toBe('SUB');
    }
  });
});
