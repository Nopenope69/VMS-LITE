export interface StorageCapacity {
  totalBytes: bigint;
  freeBytes: bigint;
  usedBytes: bigint;
}

export interface PutObjectOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Pluggable Storage Provider abstraction inspired by the Kerberos Vault pattern.
 * Decouples video chunk persistence from physical filesystem locations,
 * enabling transparent tiering across local NVMe/SSD, on-LAN NAS, and off-site S3/R2.
 */
export interface IStorageProvider {
  /** Unique provider instance identifier (e.g. 'primary-nvme', 'backup-r2') */
  readonly name: string;

  /** Storage backend classification */
  readonly type: 'local' | 's3' | 'nas';

  /**
   * Persists a video segment or object.
   * Returns a canonical storage URI (e.g. 'file:///var/recordings/...' or 's3://bucket/...').
   */
  put(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    options?: PutObjectOptions
  ): Promise<string>;

  /**
   * Reads a byte stream from storage, with optional byte-range slicing for fMP4 streaming.
   */
  getStream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream>;

  /**
   * Tests if an object exists in storage.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Unlinks an object from storage.
   */
  delete(key: string): Promise<void>;

  /**
   * Obtains storage volume metrics (total, free, used).
   */
  getCapacity(): Promise<StorageCapacity>;
}
