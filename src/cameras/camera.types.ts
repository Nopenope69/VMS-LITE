import { z } from 'zod';

const SiteIdField = z.string().min(1).optional().nullable();

export const OnboardCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  siteId: SiteIdField,
  ip: z.string().min(1, 'Camera IP is required'),
  port: z.number().int().positive().default(80),
  username: z.string().optional(),
  password: z.string().optional(),
  xaddr: z.string().optional(),
});

export type OnboardCameraInput = z.infer<typeof OnboardCameraSchema>;

export const ManualCameraSchema = z.object({
  name: z.string().min(1, 'Camera name is required'),
  siteId: SiteIdField,
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
  siteId?: string | null;
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
  siteId?: string | null;
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
  siteId: string | null;
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
  port: z.number().int().min(1).max(65535).default(554),
  timeoutMs: z.number().int().positive().max(10_000).default(2500),
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
  siteId: SiteIdField,
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


export const UpdateCameraSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    siteId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.siteId !== undefined, { message: 'Nothing to update' });
export type UpdateCameraInput = z.infer<typeof UpdateCameraSchema>;
