import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { CameraService, cameraService as defaultCameraService } from '../cameras/camera.service.js';
import { RecordingEngine, recordingEngine as defaultRecordingEngine } from '../recordings/recording-engine.js';
import {
  PlaybackStreamUrlDto,
  TimelineQueryParams,
  TimelineResponseDto,
  TimelineSpanDto,
} from './playback.types.js';

export interface PlaybackServiceDependencies {
  prisma?: PrismaClient;
  cameraService?: CameraService;
  recordingEngine?: RecordingEngine;
  playbackBaseUrl?: string;
}

export class PlaybackService {
  private readonly prisma: PrismaClient;
  private readonly cameraService: CameraService;
  private readonly recordingEngine: RecordingEngine;
  private readonly playbackBaseUrl: string;

  constructor(deps: PlaybackServiceDependencies = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.cameraService = deps.cameraService || defaultCameraService;
    this.recordingEngine = deps.recordingEngine || defaultRecordingEngine;
    this.playbackBaseUrl =
      deps.playbackBaseUrl ||
      process.env.MEDIAMTX_PLAYBACK_BASE_URL ||
      'http://localhost:9996';
  }

  /**
   * Retrieves recorded timeline spans for a 24-hour window (PLAY-01).
   */
  async getTimelineSpans(params: TimelineQueryParams): Promise<TimelineResponseDto> {
    let startDate: Date;
    let endDate: Date;
    let dateStr: string;

    if (params.startTime && params.endTime) {
      startDate = new Date(params.startTime);
      endDate = new Date(params.endTime);
      dateStr = startDate.toISOString().split('T')[0];
    } else if (params.date) {
      dateStr = params.date;
      startDate = new Date(`${params.date}T00:00:00.000Z`);
      endDate = new Date(`${params.date}T23:59:59.999Z`);
    } else {
      const now = new Date();
      dateStr = now.toISOString().split('T')[0];
      startDate = new Date(`${dateStr}T00:00:00.000Z`);
      endDate = new Date(`${dateStr}T23:59:59.999Z`);
    }

    let records: any[] = [];

    try {
      records = await this.prisma.recording.findMany({
        where: {
          cameraId: params.cameraId,
          startTime: { gte: startDate },
          endTime: { lte: endDate },
        },
        orderBy: { startTime: 'asc' },
        take: 500,
      });
    } catch {
      // Fallback query
      const inMemory = await this.recordingEngine.queryRecordings({
        cameraId: params.cameraId,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        limit: 500,
      });
      records = inMemory;
    }

    const spans: TimelineSpanDto[] = records.map((r) => ({
      recordingId: r.id,
      startTime: r.startTime instanceof Date ? r.startTime.toISOString() : String(r.startTime),
      endTime: r.endTime instanceof Date ? r.endTime.toISOString() : String(r.endTime),
      durationSeconds: Number(r.duration),
    }));

    const totalDurationSeconds = spans.reduce((sum, s) => sum + s.durationSeconds, 0);

    return {
      cameraId: params.cameraId,
      date: dateStr,
      playbackBaseUrl: this.playbackBaseUrl,
      totalDurationSeconds,
      spans,
    };
  }

  /**
   * Resolves MediaMTX fMP4 stream URL for a camera at a given timestamp (PLAY-03).
   */
  async getPlaybackStreamUrl(
    cameraId: string,
    startTime: string,
    durationSeconds: number = 300
  ): Promise<PlaybackStreamUrlDto> {
    const camera = await this.cameraService.getCameraById(cameraId);
    if (!camera) {
      throw new Error(`Camera with id ${cameraId} not found`);
    }

    const base = this.playbackBaseUrl.replace(/\/$/, '');
    const encodedStart = encodeURIComponent(new Date(startTime).toISOString());
    const fmp4StreamUrl = `${base}/get?path=${camera.mediaMtxPath}&start=${encodedStart}&duration=${durationSeconds}`;

    return {
      cameraId,
      mediaMtxPath: camera.mediaMtxPath,
      fmp4StreamUrl,
      startTime: new Date(startTime).toISOString(),
      duration: durationSeconds,
    };
  }
}

export const playbackService = new PlaybackService();
export default playbackService;
