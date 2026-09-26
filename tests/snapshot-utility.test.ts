import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatSnapshotTimestamp,
  sanitizeFileName,
  captureVideoSnapshot,
} from '../client/src/utils/snapshot.js';

describe('Instant Canvas Snapshot Utility (Phase 18 - Plan 01 - MVP-10)', () => {
  let originalDocument: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  it('formats snapshot timestamp into YYYY-MM-DD_HH-mm-ss format', () => {
    const fixedDate = new Date(2026, 8, 27, 3, 15, 30); // 2026-09-27 03:15:30
    const formatted = formatSnapshotTimestamp(fixedDate);
    expect(formatted).toBe('2026-09-27_03-15-30');
  });

  it('sanitizes camera name for safe cross-platform file naming', () => {
    expect(sanitizeFileName('Front Gate (Main #1)!')).toBe('front_gate__main__1__');
    expect(sanitizeFileName('Cam-Backyard_123')).toBe('cam-backyard_123');
  });

  it('returns failure when video element is null or has zero dimensions', () => {
    const resNull = captureVideoSnapshot(null, 'gate');
    expect(resNull.success).toBe(false);
    expect(resNull.error).toBe('Video element not found');

    const mockEmptyVideo = {
      videoWidth: 0,
      videoHeight: 0,
      clientWidth: 0,
      clientHeight: 0,
    } as any;

    const resZero = captureVideoSnapshot(mockEmptyVideo, 'gate');
    expect(resZero.success).toBe(false);
    expect(resZero.error).toContain('not yet rendered or ready');
  });

  it('draws video frame onto canvas and triggers JPEG download when valid video provided', () => {
    const mockDrawImage = vi.fn();
    const mockToDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockJpegData');
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();
    const mockClick = vi.fn();

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        drawImage: mockDrawImage,
      }),
      toDataURL: mockToDataURL,
    };

    const mockAnchor = {
      href: '',
      download: '',
      click: mockClick,
    };

    (globalThis as any).document = {
      body: {
        appendChild: mockAppendChild,
        removeChild: mockRemoveChild,
      },
      createElement: (tagName: string) => {
        if (tagName === 'canvas') return mockCanvas;
        if (tagName === 'a') return mockAnchor;
        return {};
      },
    };

    const mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
    } as any;

    const res = captureVideoSnapshot(mockVideo, 'Warehouse-Entrance');
    expect(res.success).toBe(true);
    expect(res.filename).toMatch(/^snapshot_warehouse-entrance_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/);
    expect(res.dataUrl).toBe('data:image/jpeg;base64,mockJpegData');
    expect(mockDrawImage).toHaveBeenCalledWith(mockVideo, 0, 0, 1920, 1080);
    expect(mockToDataURL).toHaveBeenCalledWith('image/jpeg', 0.95);
    expect(mockAnchor.download).toBe(res.filename);
    expect(mockClick).toHaveBeenCalled();
    expect(mockAppendChild).toHaveBeenCalledWith(mockAnchor);
    expect(mockRemoveChild).toHaveBeenCalledWith(mockAnchor);
  });
});
