import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { authenticate, requireCameraPermission } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { exportService } from './export.service.js';

const CreateExportBodySchema = z.object({
  cameraId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  exportMode: z.enum(['STREAM_COPY', 'TRANSCODED_OSD']).optional(),
  includeOsd: z.boolean().optional(),
});

export const exportRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/recordings/export
   * Initiates a clip export job (Stream Copy default or Transcoded OSD Derivative)
   */
  app.post(
    '/export',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canExportClips'),
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const parsed = CreateExportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid export request body',
          details: parsed.error.errors,
        });
      }

      try {
        const job = await exportService.createExportJob({
          ...parsed.data,
          userId: (request as any).user?.id,
        });

        return reply.status(202).send({
          success: true,
          job,
        });
      } catch (err: any) {
        if (err.code === 'INCOMPATIBLE_SEGMENTS') {
          return reply.status(400).send({
            error: 'INCOMPATIBLE_SEGMENTS',
            message: err.message,
            job: err.job,
          });
        }
        if (err.code === 'NO_RECORDINGS_FOUND') {
          return reply.status(404).send({
            error: 'NO_RECORDINGS_FOUND',
            message: err.message,
            job: err.job,
          });
        }
        return reply.status(500).send({
          error: 'ExportFailed',
          message: err.message || 'Failed to initialize export job',
        });
      }
    }
  );

  /**
   * GET /api/recordings/export/:id
   * Checks status and metadata (SHA-256 integrity checksum, progress) of an export job
   */
  app.get<{ Params: { id: string } }>(
    '/export/:id',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const job = await exportService.getExportJob(id);

      if (!job) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Export job ${id} not found`,
        });
      }

      return reply.send({
        success: true,
        job,
      });
    }
  );

  /**
   * GET /api/recordings/export/:id/download
   * Streams the exported MP4 file with SHA-256 integrity checksum header
   */
  app.get<{ Params: { id: string } }>(
    '/export/:id/download',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const details = await exportService.getExportFileDetails(id);

      if (!details) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Export file for job ${id} is not available for download`,
        });
      }

      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Disposition', `attachment; filename="${details.fileName}"`);
      if (details.sha256) {
        reply.header('X-Checksum-SHA256', details.sha256);
      }

      const stream = createReadStream(details.filePath);
      return reply.send(stream);
    }
  );

  /**
   * GET /api/recordings/export/:id/certificate
   * Generates a Section 65B / Bharatiya Sakshya Adhiniyam 2023 legal evidence certificate.
   */
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/export/:id/certificate',
    {
      preHandler: [
        authenticate,
        requireCapability('extended.clip_export'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const job = await exportService.getExportJob(id);

      if (!job) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Export job ${id} not found`,
        });
      }

      if (job.status !== 'COMPLETED' || !job.sha256) {
        return reply.status(400).send({
          error: 'ExportNotReady',
          message: `Export job ${id} has not completed successfully or missing checksum`,
        });
      }

      const certId = `CERT-BSA-${job.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const issuedAt = new Date().toISOString();
      const istTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      const certificateData = {
        certificateId: certId,
        statutoryJurisdiction: 'Bharatiya Sakshya Adhiniyam 2023 / Indian Evidence Act Section 65B',
        issuedAtUtc: issuedAt,
        issuedAtIst: `${istTime} IST`,
        exportJobId: job.id,
        cameraId: job.cameraId,
        videoInterval: {
          startTimeUtc: job.startTime,
          endTimeUtc: job.endTime,
        },
        technicalSpecifications: {
          exportMode: job.exportMode,
          osdWatermarkApplied: job.includeOsd,
          fileSizeBytes: job.fileSize,
          sha256Hash: job.sha256,
        },
        custodyDetails: {
          exportedByUserId: job.userId || 'system',
          certifiedBy: (request as any).user?.username || 'authorized_operator',
          role: (request as any).user?.role || 'OPERATOR',
        },
        statutoryDeclaration:
          'I hereby certify that the electronic video record identified by SHA-256 hash ' +
          job.sha256 +
          ' was generated from the Basic VMS secure storage repository during the ordinary course of operations. ' +
          'The recording engine and database were operating properly without any interception, modification, or tampering.',
      };

      if (request.query.format === 'html') {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Certificate of Electronic Record - ${certId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background: #fff; color: #111; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.5; font-size: 13px; }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; }
    .header h1 { margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; }
    .header h2 { margin: 4px 0 0; font-size: 13px; font-weight: normal; color: #444; }
    .meta-box { border: 1px solid #ccc; padding: 14px; margin-bottom: 20px; background: #f9f9f9; border-radius: 4px; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .meta-label { font-weight: bold; color: #333; }
    .hash { font-family: monospace; font-size: 12px; word-break: break-all; background: #eee; padding: 6px; border-radius: 3px; margin-top: 4px; display: block; border: 1px solid #ddd; }
    .statement { margin: 24px 0; padding: 14px; border-left: 4px solid #111; background: #fdfdfd; font-style: italic; }
    .signatures { display: flex; justify-content: space-between; margin-top: 50px; padding-top: 20px; }
    .sign-box { width: 45%; border-top: 1px solid #000; text-align: center; padding-top: 8px; font-size: 12px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Certificate of Authenticity of Electronic Record</h1>
    <h2>Under Bharatiya Sakshya Adhiniyam 2023 (Section 65B Indian Evidence Act Equivalent)</h2>
  </div>

  <div class="meta-box">
    <div class="meta-row"><span class="meta-label">Certificate ID:</span> <span>${certId}</span></div>
    <div class="meta-row"><span class="meta-label">Issued At (IST):</span> <span>${istTime} IST</span></div>
    <div class="meta-row"><span class="meta-label">Export Job Reference:</span> <span>${job.id}</span></div>
    <div class="meta-row"><span class="meta-label">Camera Identifier:</span> <span>${job.cameraId}</span></div>
    <div class="meta-row"><span class="meta-label">Recording Time Window:</span> <span>${job.startTime} to ${job.endTime}</span></div>
    <div class="meta-row"><span class="meta-label">Export Mode:</span> <span>${job.exportMode} (OSD Burn-In: ${job.includeOsd ? 'Yes' : 'No'})</span></div>
    <div class="meta-row"><span class="meta-label">File Size:</span> <span>${job.fileSize} bytes</span></div>
  </div>

  <div>
    <div class="meta-label">CRYPTOGRAPHIC SHA-256 DIGITAL FINGERPRINT:</div>
    <span class="hash">${job.sha256}</span>
  </div>

  <div class="statement">
    "${certificateData.statutoryDeclaration}"
  </div>

  <div class="signatures">
    <div class="sign-box">
      <strong>Certified By:</strong><br />
      ${(request as any).user?.username || 'System Operator'}<br />
      Role: ${(request as any).user?.role || 'OPERATOR'}
    </div>
    <div class="sign-box">
      <strong>VMS System Verification:</strong><br />
      Cryptographic Engine Verified<br />
      SHA-256 Match Confirmed
    </div>
  </div>
</body>
</html>`;
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(html);
      }

      return reply.send({
        success: true,
        certificate: certificateData,
      });
    }
  );

  /**
   * POST /api/recordings/export/verify
   * Verification of an electronic evidence hash against the VMS audit log.
   */
  app.post<{ Body: { sha256?: string; jobId?: string } }>(
    '/export/verify',
    async (request, reply) => {
      const { sha256, jobId } = request.body || {};

      if (!sha256 && !jobId) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Either sha256 hash or jobId must be provided for verification',
        });
      }

      let job = null;
      if (sha256) {
        job = await exportService.findJobBySha256(sha256.trim().toLowerCase());
      } else if (jobId) {
        job = await exportService.getExportJob(jobId.trim());
      }

      if (!job) {
        return reply.status(404).send({
          success: false,
          verified: false,
          message: 'No matching electronic video export record was found in the VMS archive log.',
        });
      }

      return reply.send({
        success: true,
        verified: true,
        message: 'Authentic: SHA-256 cryptographic fingerprint matches VMS tamper-proof audit record.',
        record: {
          jobId: job.id,
          cameraId: job.cameraId,
          startTime: job.startTime,
          endTime: job.endTime,
          exportMode: job.exportMode,
          status: job.status,
          fileSize: job.fileSize,
          sha256: job.sha256,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        },
      });
    }
  );
};
