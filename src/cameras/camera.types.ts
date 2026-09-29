import { z } from 'zod';

export const OnboardCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  ip: z.string().min(1, 'Camera IP is required'),
  port: z.number().int().positive().default(80),
  username: z.string().optional(),
  password: z.string().optional(),
  xaddr: z.string().optional(),
});

export type OnboardCameraInput = z.infer<typeof OnboardCameraSchema>;

export const ManualCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  rtspUrl: z.string().refine((url) => url.startsWith('rtsp://') || url.startsWith('rtsps://'), {
    message: 'RTSP URL must start with rtsp:// or rtsps://',
  }),
  subStreamUrl: z
    .string()
    .refine((url) => url.startsWith('rtsp://') || url.startsWith('rtsps://'), {
      message: 'Sub-stream URL must start with rtsp:// or rtsps://',
    })
    .optional(),
});

export type ManualCameraInput = z.infer<typeof ManualCameraSchema>;

export interface CreateCameraDto {
  name: string;
  rtspUrl: string;
  subRtspUrl?: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface CameraDto {
  id: string;
  name: string;
  ip?: string | null;
  port?: number | null;
  rtspUrl: string;
  subRtspUrl?: string | null;
  mediaMtxPath: string;
  subMediaMtxPath?: string | null;
  status: string;
  recordingMode: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CameraStreamProfile {
  rtspUrl: string;
  mediaMtxPath: string;
}

export interface CameraProfiles {
  main: CameraStreamProfile;
  sub?: CameraStreamProfile | null;
  mainStream?: CameraStreamProfile;
  subStream?: CameraStreamProfile | null;
}

export interface CameraResponseDto {
  id: string;
  name: string;
  ip?: string | null;
  port?: number | null;
  username?: string | null;
  // NOTE: password is intentionally excluded to prevent credential leakage (T-02-06)
  rtspUrl: string;
  subRtspUrl?: string | null;
  subStreamUrl?: string | null;
  mediaMtxPath: string;
  subMediaMtxPath?: string | null;
  onvifUrl?: string | null;
  profileToken?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  status: string;
  recordingMode: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const ProbeNetworkSchema = z.object({
  ip: z.string().min(1, 'IP address is required'),
  port: z.number().int().positive().default(554),
  timeoutMs: z.number().int().positive().default(2500),
});
export type ProbeNetworkInput = z.infer<typeof ProbeNetworkSchema>;

export const ProbeAuthSchema = z.object({
  ip: z.string().min(1, 'Camera IP is required'),
  port: z.number().int().positive().default(80),
  username: z.string().optional(),
  password: z.string().optional(),
  xaddr: z.string().optional(),
});
export type ProbeAuthInput = z.infer<typeof ProbeAuthSchema>;

export const ProvisionPreviewSchema = z.object({
  rtspUrl: z.string().refine((url) => url.startsWith('rtsp://') || url.startsWith('rtsps://'), {
    message: 'RTSP URL must start with rtsp:// or rtsps://',
  }),
});
export type ProvisionPreviewInput = z.infer<typeof ProvisionPreviewSchema>;

export const CommitCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  ip: z.string().optional(),
  port: z.number().int().positive().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  rtspUrl: z.string().refine((url) => url.startsWith('rtsp://') || url.startsWith('rtsps://'), {
    message: 'RTSP URL must start with rtsp:// or rtsps://',
  }),
  subStreamUrl: z.string().optional().nullable(),
  onvifUrl: z.string().optional().nullable(),
  profileToken: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  previewPath: z.string().optional().nullable(),
});
export type CommitCameraInput = z.infer<typeof CommitCameraSchema>;

