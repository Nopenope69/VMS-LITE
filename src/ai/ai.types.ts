import { SegmentCreatedEventMetadata } from '../recordings/recording.types.js';

export type AiDetectionClass =
  | 'person'
  | 'vehicle'
  | 'face'
  | 'license_plate'
  | 'animal'
  | 'package'
  | 'unknown';

export interface AiBoundingBox {
  /** Normalized X coordinate of top-left corner (0.0 to 1.0) */
  x: number;
  /** Normalized Y coordinate of top-left corner (0.0 to 1.0) */
  y: number;
  /** Normalized width (0.0 to 1.0) */
  width: number;
  /** Normalized height (0.0 to 1.0) */
  height: number;
}

export interface AiDetectionItem {
  id: string;
  label: AiDetectionClass;
  confidence: number;
  boundingBox: AiBoundingBox;
  /** Milliseconds offset from segment start time */
  timestampOffsetMs: number;
}

export interface AiSegmentAnalysisResult {
  recordingId: string;
  cameraId: string;
  siteId: string | null;
  detections: AiDetectionItem[];
  processedAt: Date;
  processingDurationMs: number;
  modelVersion: string;
}

/**
 * Seam for Package 3 AI Workers (YOLO, ONNX Runtime, Coral TPU, OpenVINO, Hailo).
 * AI workers operate strictly asynchronously on completed video chunks.
 */
export interface IAiWorker {
  readonly name: string;
  readonly version: string;

  /** Health probe verifying hardware accelerator or inference model readiness */
  isReady(): Promise<boolean>;

  /**
   * Performs computer vision inference on a video segment chunk.
   * If the worker fails or times out, it must not disrupt media capture or storage.
   */
  processSegment(segment: SegmentCreatedEventMetadata): Promise<AiSegmentAnalysisResult>;
}
