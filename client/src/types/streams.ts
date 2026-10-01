/** Live stream endpoints for one camera, from GET /api/streaming/config (via the media proxy). */
export interface CameraStreamInfo {
  cameraId: string;
  name: string;
  mediaMtxPath: string;
  whepUrl: string;
  hlsUrl: string;
  subStreamWhepUrl?: string | null;
  subStreamHlsUrl?: string | null;
  siteId?: string | null;
}
