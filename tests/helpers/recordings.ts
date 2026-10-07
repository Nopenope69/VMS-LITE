import path from 'node:path';
import { prisma } from '../../src/db/prisma.js';

/**
 * Catalogues an AVAILABLE segment directly, for tests that need recordings to exist
 * but are not about how Segment Ingest finds them on disk.
 */
export async function seedRecording(opts: {
  cameraId: string;
  mediaMtxPath: string;
  startTime: Date | string;
  durationSeconds?: number;
  sizeBytes?: number;
}) {
  const start = new Date(opts.startTime);
  const duration = opts.durationSeconds ?? 60;
  const stamp = start.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const fileName = `${stamp}.mp4`;
  return prisma.recording.create({
    data: {
      cameraId: opts.cameraId,
      mediaMtxPath: opts.mediaMtxPath,
      filePath: path.join('/var/recordings', opts.mediaMtxPath, fileName),
      fileName,
      startTime: start,
      endTime: new Date(start.getTime() + duration * 1000),
      duration,
      sizeBytes: BigInt(opts.sizeBytes ?? 1024 * 1024),
      format: 'fmp4',
      status: 'AVAILABLE',
    },
  });
}
