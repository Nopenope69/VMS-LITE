/**
 * Instant Canvas Snapshot Utility (MVP-10)
 * Grabs the active video frame via HTML5 Canvas and triggers direct browser download.
 */

export interface SnapshotResult {
  success: boolean;
  filename?: string;
  dataUrl?: string;
  error?: string;
}

/**
 * Formats a Date object into YYYY-MM-DD_HH-mm-ss string
 */
export function formatSnapshotTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Sanitizes camera name for safe cross-platform file naming
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/**
 * Captures the current frame from an HTMLVideoElement and triggers an immediate JPEG download.
 */
export function captureVideoSnapshot(
  video: HTMLVideoElement | null,
  cameraName: string = 'camera'
): SnapshotResult {
  if (!video) {
    return { success: false, error: 'Video element not found' };
  }

  // Ensure video has loaded metadata and has dimensions
  const width = video.videoWidth || video.clientWidth || 0;
  const height = video.videoHeight || video.clientHeight || 0;

  if (width === 0 || height === 0) {
    return { success: false, error: 'Video frame is not yet rendered or ready' };
  }

  if (typeof document === 'undefined') {
    return { success: false, error: 'Document DOM environment not available' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { success: false, error: 'Could not obtain 2D canvas context' };
    }

    // Draw active video frame
    ctx.drawImage(video, 0, 0, width, height);

    // Encode to high-quality JPEG (95% quality)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    const timestamp = formatSnapshotTimestamp();
    const safeName = sanitizeFileName(cameraName);
    const filename = `snapshot_${safeName}_${timestamp}.jpg`;

    // Trigger immediate browser download
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return {
      success: true,
      filename,
      dataUrl,
    };
  } catch (err: any) {
    console.error('[Snapshot] Failed to capture video snapshot:', err);
    return {
      success: false,
      error: err.message || 'Canvas snapshot extraction failed',
    };
  }
}
