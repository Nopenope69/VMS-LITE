import { z } from 'zod';

export const OnboardCameraSchema = z
  .object({
    name: z.string().min(1, 'Camera name is required'),
    ip: z.string().optional(),
    port: z.number().int().positive().optional().default(80),
    username: z.string().optional(),
    password: z.string().optional(),
    xaddr: z.string().optional(),
    onvifUrl: z.string().optional(),
  })
  .transform((data) => {
    let ip = data.ip;
    let port = data.port || 80;
    const xaddr = data.xaddr || data.onvifUrl;

    if (!ip && xaddr) {
      try {
        const parsed = new URL(xaddr);
        ip = parsed.hostname;
        if (parsed.port) {
          port = parseInt(parsed.port, 10);
        }
      } catch {}
    }

    return {
      ...data,
      ip: ip || '127.0.0.1',
      port,
      xaddr: xaddr || (ip ? `http://${ip}:${port}/onvif/device_service` : undefined),
    };
  });

export type OnboardCameraInput = z.input<typeof OnboardCameraSchema>;
export type OnboardCameraOutput = z.output<typeof OnboardCameraSchema>;

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

export interface CameraResponseDto {
  id: string;
  name: string;
  ip?: string | null;
  port?: number | null;
  username?: string | null;
  // NOTE: password is intentionally excluded to prevent credential leakage (T-02-06)
  rtspUrl: string;
  subStreamUrl?: string | null;
  onvifUrl?: string | null;
  profileToken?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  status: string;
  mediaMtxPath: string;
  mediaSource?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
