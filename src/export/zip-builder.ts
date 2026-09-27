/**
 * Zero-Dependency Pure Node.js ZIP Archive Generator (MVP-13)
 *
 * Implements PKWARE ZIP Specification using built-in `node:zlib` (zlib.crc32).
 * Fast, packet-preserving STORE method optimal for H.264/H.265 video and metadata.
 */

import zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  date?: Date;
}

export function dateToDosTime(d: Date = new Date()): { time: number; date: number } {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);
  const time = (hours << 11) | (minutes << 5) | seconds;

  const year = Math.max(0, d.getFullYear() - 1980);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const date = (year << 9) | (month << 5) | day;

  return { time, date };
}

export function buildZipArchive(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = zlib.crc32(dataBuf);
    const uncompressedSize = dataBuf.length;
    const compressedSize = uncompressedSize; // Method 0: STORE
    const method = 0;
    const { time, date } = dateToDosTime(entry.date);

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // Bit flag: UTF-8 filename
    localHeader.writeUInt16LE(method, 8); // Compression method
    localHeader.writeUInt16LE(time, 10); // Mod time
    localHeader.writeUInt16LE(date, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    filenameBuf.copy(localHeader, 30);

    localChunks.push(localHeader, dataBuf);

    // Central Directory Record (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + filenameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by (2.0)
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8); // Bit flag: UTF-8
    centralHeader.writeUInt16LE(method, 10); // Compression method
    centralHeader.writeUInt16LE(time, 12); // Mod time
    centralHeader.writeUInt16LE(date, 14); // Mod date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(compressedSize, 20); // Compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    centralHeader.writeUInt16LE(filenameBuf.length, 28); // Filename length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // External file attributes (regular file rw-r--r--)
    centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    filenameBuf.copy(centralHeader, 46);

    centralChunks.push(centralHeader);
    currentOffset += localHeader.length + dataBuf.length;
  }

  const centralDirectoryOffset = currentOffset;
  const centralDirectoryBuf = Buffer.concat(centralChunks);
  const centralDirectorySize = centralDirectoryBuf.length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // Number of central dir records on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total number of central dir records
  eocd.writeUInt32LE(centralDirectorySize, 12); // Size of central directory
  eocd.writeUInt32LE(centralDirectoryOffset, 16); // Offset of central directory
  eocd.writeUInt16LE(0, 20); // ZIP file comment length

  return Buffer.concat([...localChunks, centralDirectoryBuf, eocd]);
}
