/**
 * Snapshot Helper Utility
 * Captures full-frame or cropped ROI snapshots directly from HTML5 video feeds
 * with high-fidelity camera name and timestamp watermark.
 */

export interface CropRect {
  x: number; // in pixels relative to video container
  y: number;
  width: number;
  height: number;
}

export interface SnapshotOptions {
  cameraName: string;
  crop?: CropRect;
  containerWidth?: number;
  containerHeight?: number;
}

/**
 * Formats current date-time for watermark and filename
 */
function getTimestampInfo(): { filenameTs: string; watermarkTs: string } {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const min = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  const filenameTs = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
  const watermarkTs = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} IST`;

  return { filenameTs, watermarkTs };
}

/**
 * Captures a full-frame or cropped snapshot from a given HTMLVideoElement
 */
export async function captureVideoSnapshot(
  video: HTMLVideoElement,
  options: SnapshotOptions
): Promise<{ success: boolean; filename: string }> {
  if (!video || video.readyState < 2) {
    throw new Error('Video stream is not ready for capture');
  }

  const { filenameTs, watermarkTs } = getTimestampInfo();
  const cleanCameraName = options.cameraName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const isCropped = Boolean(options.crop && options.crop.width > 10 && options.crop.height > 10);
  const filename = isCropped
    ? `BasicVMS_CROP_${cleanCameraName}_${filenameTs}.jpg`
    : `BasicVMS_${cleanCameraName}_${filenameTs}.jpg`;

  const videoWidth = video.videoWidth || 1920;
  const videoHeight = video.videoHeight || 1080;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  if (isCropped && options.crop && options.containerWidth && options.containerHeight) {
    // Calculate scaling ratio between displayed video box and intrinsic video stream
    const scaleX = videoWidth / options.containerWidth;
    const scaleY = videoHeight / options.containerHeight;

    const sourceX = Math.max(0, options.crop.x * scaleX);
    const sourceY = Math.max(0, options.crop.y * scaleY);
    const sourceW = Math.min(videoWidth - sourceX, options.crop.width * scaleX);
    const sourceH = Math.min(videoHeight - sourceY, options.crop.height * scaleY);

    canvas.width = Math.max(sourceW, 100);
    canvas.height = Math.max(sourceH, 100);

    // Draw cropped region
    ctx.drawImage(
      video,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      canvas.width,
      canvas.height
    );
  } else {
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  // Draw Watermark Overlay Banner (Legal audit trail)
  const bannerHeight = Math.max(28, Math.round(canvas.height * 0.05));
  ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
  ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);

  // Watermark text styling
  const fontSize = Math.max(12, Math.round(bannerHeight * 0.48));
  ctx.font = `600 ${fontSize}px monospace`;
  ctx.fillStyle = '#4fc3f7'; // Cyan brand accent
  ctx.textBaseline = 'middle';

  const leftText = `● ${options.cameraName.toUpperCase()}${isCropped ? ' [REGION CROP]' : ''}`;
  const rightText = `${watermarkTs} | BASIC VMS SECURE`;

  ctx.fillText(leftText, 14, canvas.height - bannerHeight / 2);

  const rightTextWidth = ctx.measureText(rightText).width;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(rightText, Math.max(canvas.width - rightTextWidth - 14, leftText.length * fontSize), canvas.height - bannerHeight / 2);

  // Trigger download via data URL or Blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create image blob'));
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
        resolve({ success: true, filename });
      },
      'image/jpeg',
      0.95
    );
  });
}
