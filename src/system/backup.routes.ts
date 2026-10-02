import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { createBackup, restoreBackup, RestoreMode } from './backup.service.js';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { backupScheduler } from './backup-scheduler.js';

export const backupRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Support binary body uploads for restore
  app.addContentTypeParser(
    ['application/gzip', 'application/octet-stream', 'application/x-gzip'],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );
  /**
   * POST /api/system/backup
   * Admin-only. Generates and streams a config-only tar.gz backup archive.
   */
  app.post(
    '/backup',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (_request, reply) => {
      const archive = await createBackup(defaultPrisma);

      const isoDate = new Date().toISOString().slice(0, 10);
      const filename = `vms-backup-${isoDate}.tar.gz`;

      return reply
        .header('Content-Type', 'application/gzip')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', archive.length)
        .send(archive);
    },
  );

  /**
   * GET /api/system/backups
   * Admin-only. Automatic daily backups kept on the appliance, newest first.
   */
  app.get('/backups', { preHandler: [authenticate, requireRole('ADMIN')] }, async () => {
    const backups = await backupScheduler.list();
    return { backups, count: backups.length };
  });

  /**
   * GET /api/system/backups/:name
   * Admin-only. Downloads one automatic backup archive.
   */
  app.get<{ Params: { name: string } }>(
    '/backups/:name',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (request, reply) => {
      const archive = await backupScheduler.read(request.params.name);
      if (!archive) {
        return reply.status(404).send({ error: 'NotFound', message: 'Backup not found' });
      }
      return reply
        .header('Content-Type', 'application/gzip')
        .header('Content-Disposition', `attachment; filename="${request.params.name}"`)
        .header('Content-Length', archive.length)
        .send(archive);
    },
  );

  /**
   * POST /api/system/restore
   * Admin-only. Accepts a tar.gz backup archive and restores config.
   * Query param: mode=skip-existing (default) | mode=overwrite
   */
  app.post(
    '/restore',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
    },
    async (request, reply) => {
      const mode = ((request.query as any)?.mode || 'skip-existing') as RestoreMode;

      if (mode !== 'skip-existing' && mode !== 'overwrite') {
        return reply.status(400).send({
          error: 'InvalidRestoreMode',
          message: 'Query parameter "mode" must be "skip-existing" or "overwrite"',
        });
      }

      // Read the raw body as a Buffer
      const body = request.body;
      let archiveBuffer: Buffer;

      if (Buffer.isBuffer(body)) {
        archiveBuffer = body;
      } else if (typeof body === 'string') {
        archiveBuffer = Buffer.from(body, 'binary');
      } else {
        return reply.status(400).send({
          error: 'InvalidPayload',
          message: 'Expected a tar.gz archive body',
        });
      }

      if (archiveBuffer.length === 0) {
        return reply.status(400).send({
          error: 'EmptyPayload',
          message: 'Received empty archive body',
        });
      }

      try {
        const summary = await restoreBackup(defaultPrisma, archiveBuffer, mode);
        return reply.send({ success: true, mode, summary });
      } catch (err: any) {
        return reply.status(400).send({
          error: 'RestoreError',
          message: err.message,
        });
      }
    },
  );
};

export default backupRoutes;
