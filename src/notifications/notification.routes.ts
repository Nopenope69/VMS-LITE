/**
 * Notification Routes (EXT-07)
 *
 * REST API for configuring WhatsApp and SMS incident alerts.
 * Defined relative to the '/api/notifications' registration prefix.
 *
 * Protected by:
 * - Authentication (JWT)
 * - Role.ADMIN (T-12-02)
 * - Capability: 'extended.whatsapp_alerts'
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { notificationService } from './notification-dispatcher.service.js';

const UpdateNotificationConfigSchema = z.object({
  provider: z.enum(['mock', 'whatsapp_cloud', 'twilio']).optional(),
  credentialsJson: z.string().nullable().optional(),
  sender: z.string().nullable().optional(),
  recipientPhones: z.array(z.string()).optional(),
  cooldownSeconds: z.number().int().min(10).max(3600).optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const TestNotificationSchema = z.object({
  recipientPhone: z.string().optional(),
});

export const notificationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/notifications/settings
   * Retrieves active notification configuration with masked credentials.
   */
  app.get(
    '/settings',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.whatsapp_alerts'),
      ],
    },
    async (_request, reply) => {
      const config = await notificationService.getConfig();
      return reply.code(200).send(config);
    }
  );

  /**
   * PUT /api/notifications/settings
   * Updates notification configuration. Masked credentials are preserved without overwrite.
   */
  app.put(
    '/settings',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.whatsapp_alerts'),
      ],
    },
    async (request, reply) => {
      const parsed = UpdateNotificationConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Validation Error',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      const updated = await notificationService.updateConfig(parsed.data);
      return reply.code(200).send(updated);
    }
  );

  /**
   * POST /api/notifications/test
   * Dispatches a test notification to verify integration.
   */
  app.post(
    '/test',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.whatsapp_alerts'),
      ],
    },
    async (request, reply) => {
      const parsed = TestNotificationSchema.safeParse(request.body || {});
      const phone = parsed.success ? parsed.data.recipientPhone : undefined;

      const result = await notificationService.sendTestAlert(phone);
      if (!result.success) {
        return reply.code(502).send({
          statusCode: 502,
          error: 'Dispatch Error',
          message: result.error || 'Failed to dispatch test notification',
        });
      }

      return reply.code(200).send({
        success: true,
        messageId: result.messageId,
        message: 'Test notification sent successfully',
      });
    }
  );
};

export default notificationRoutes;
