// Export Types & DTOs for VMS-Lite (EXT-04)

export type ExportStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type ExportMode = 'STREAM_COPY' | 'TRANSCODED_OSD';

export interface ExportJobDto {
  id: string;
  cameraId: string;
  userId?: string | null;
  startTime: string;
  endTime: string;
  exportMode: ExportMode;
  status: ExportStatus;
  filePath?: string | null;
  fileSize?: number | null;
  sha256?: string | null;
  includeOsd: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt: string;
}

export interface CreateExportRequest {
  cameraId: string;
  startTime: string;
  endTime: string;
  exportMode?: ExportMode;
  includeOsd?: boolean;
}

export interface ExportCompatibilityResult {
  compatible: boolean;
  errorCode?: 'INCOMPATIBLE_SEGMENTS' | 'NO_RECORDINGS_FOUND' | 'CORRUPT_SEGMENT';
  message?: string;
}

export interface DiskUsageStatus {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usageRatio: number; // 0.0 to 1.0
}
