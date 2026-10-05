import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageProvider } from '../src/storage/local-storage-provider.js';
import { TieredStorageManager } from '../src/storage/tiered-storage-manager.js';
import { IStorageProvider } from '../src/storage/storage-provider.interface.js';

describe('Storage Provider & Tiered Offloading (Vault Pattern)', () => {
  let tempDir: string;
  let localProvider: LocalStorageProvider;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vms-storage-test-'));
    localProvider = new LocalStorageProvider({
      name: 'test-local',
      rootPath: tempDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('LocalStorageProvider', () => {
    it('persists a buffer and verifies existence and retrieval', async () => {
      const data = Buffer.from('test fmp4 data segment header');
      const uri = await localProvider.put('cam1/segment1.mp4', data);

      expect(uri).toContain('cam1/segment1.mp4');
      expect(await localProvider.exists('cam1/segment1.mp4')).toBe(true);

      const stream = await localProvider.getStream('cam1/segment1.mp4');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('test fmp4 data segment header');
    });

    it('supports byte-range reads for fMP4 scrubbing', async () => {
      const data = Buffer.from('0123456789abcdef');
      await localProvider.put('cam1/range.mp4', data);

      const stream = await localProvider.getStream('cam1/range.mp4', { start: 2, end: 5 });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('2345');
    });

    it('rejects path traversal attempts outside root path', async () => {
      await expect(
        localProvider.put('../../../etc/passwd', Buffer.from('exploit'))
      ).rejects.toThrow(/Path traversal violation/);
    });

    it('deletes an existing file cleanly', async () => {
      await localProvider.put('cam1/delete-me.mp4', Buffer.from('data'));
      expect(await localProvider.exists('cam1/delete-me.mp4')).toBe(true);

      await localProvider.delete('cam1/delete-me.mp4');
      expect(await localProvider.exists('cam1/delete-me.mp4')).toBe(false);
    });

    it('returns capacity metrics', async () => {
      const capacity = await localProvider.getCapacity();
      expect(capacity.totalBytes).toBeGreaterThan(0n);
      expect(capacity.freeBytes).toBeGreaterThanOrEqual(0n);
    });
  });

  describe('TieredStorageManager', () => {
    it('offloads flagged segment from primary to secondary storage', async () => {
      // Create mock secondary provider (e.g. S3 / Cloudflare R2 / NAS)
      const remoteObjects = new Map<string, Buffer>();
      const mockSecondary: IStorageProvider = {
        name: 'mock-s3',
        type: 's3',
        put: async (key, data) => {
          if (Buffer.isBuffer(data)) {
            remoteObjects.set(key, data);
          } else {
            const chunks: Buffer[] = [];
            for await (const c of data) chunks.push(Buffer.from(c));
            remoteObjects.set(key, Buffer.concat(chunks));
          }
          return `s3://vms-evidence-bucket/${key}`;
        },
        getStream: async (key) => {
          const buf = remoteObjects.get(key);
          if (!buf) throw new Error('Not found');
          const { Readable } = await import('node:stream');
          return Readable.from(buf);
        },
        exists: async (key) => remoteObjects.has(key),
        delete: async (key) => { remoteObjects.delete(key); },
        getCapacity: async () => ({
          totalBytes: 1000n,
          freeBytes: 800n,
          usedBytes: 200n,
        }),
      };

      // Store a segment in primary
      await localProvider.put('cam1/critical-event.mp4', Buffer.from('burglary evidence'));

      const manager = new TieredStorageManager({
        primary: localProvider,
        secondary: mockSecondary,
      });

      const task = await manager.enqueueOffload('cam1/critical-event.mp4', 'bookmark');
      expect(['pending', 'in_progress']).toContain(task.status);

      // Wait a moment for async drain
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = manager.getTask(task.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.remoteUri).toBe('s3://vms-evidence-bucket/cam1/critical-event.mp4');
      expect(remoteObjects.has('cam1/critical-event.mp4')).toBe(true);
      expect(remoteObjects.get('cam1/critical-event.mp4')?.toString()).toBe('burglary evidence');

      const stats = manager.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it('records failed status when secondary upload errors without crashing', async () => {
      const failingSecondary: IStorageProvider = {
        name: 'failing-s3',
        type: 's3',
        put: async () => {
          throw new Error('S3 Connection Timeout');
        },
        getStream: async () => { throw new Error('Not implemented'); },
        exists: async () => false,
        delete: async () => {},
        getCapacity: async () => ({ totalBytes: 0n, freeBytes: 0n, usedBytes: 0n }),
      };

      await localProvider.put('cam1/sample.mp4', Buffer.from('data'));

      const manager = new TieredStorageManager({
        primary: localProvider,
        secondary: failingSecondary,
      });

      const task = await manager.enqueueOffload('cam1/sample.mp4', 'alert');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = manager.getTask(task.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toContain('S3 Connection Timeout');

      const stats = manager.getStats();
      expect(stats.failed).toBe(1);
    });
  });
});
