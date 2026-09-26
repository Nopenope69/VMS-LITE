/**
 * Webhook Routes (EXT-08)
 *
 * REST API for managing outbound webhook subscriptions.
 * Defined relative to the '/api/webhooks' registration prefix.
 *
 * Protected by:
 * - Authentication (JWT)
 * - Role.ADMIN (T-12-02)
 * - Capability: 'extended.api_webhooks'
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireRole } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { webhookDispatcherService } from './webhook-dispatcher.service.js';

const CreateWebhookSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  url: z.string().url('Valid URL is required'),
  secret: z.string().min(8, 'Secret must be at least 8 characters').optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const UpdateWebhookSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  secret: z.string().optional(),
  events: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const webhookRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/webhooks
   * Lists all configured webhook endpoints with masked secrets.
   */
  app.get(
    '/',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.api_webhooks'),
      ],
    },
    async (_request, reply) => {
      const endpoints = await webhookDispatcherService.listEndpoints();
      return reply.code(200).send(endpoints);
    }
  );

  /**
   * POST /api/webhooks
   * Creates a new webhook endpoint.
   */
  app.post(
    '/',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.api_webhooks'),
      ],
    },
    async (request, reply) => {
      const parsed = CreateWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Validation Error',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      try {
        const created = await webhookDispatcherService.createEndpoint(parsed.data);
        return reply.code(201).send(created);
      } catch (err: any) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message || 'Failed to create webhook endpoint',
        });
      }
    }
  );

  /**
   * PUT /api/webhooks/:id
   * Updates an existing webhook endpoint.
   */
  app.put<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.api_webhooks'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = UpdateWebhookSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Validation Error',
          message: parsed.error.issues.map((i) => i.message).join(', '),
        });
      }

      try {
        const updated = await webhookDispatcherService.updateEndpoint(id, parsed.data);
        if (!updated) {
          return reply.code(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: `Webhook endpoint with ID '${id}' not found`,
          });
        }
        return reply.code(200).send(updated);
      } catch (err: any) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message || 'Failed to update webhook endpoint',
        });
      }
    }
  );

  /**
   * DELETE /api/webhooks/:id
   * Deletes a webhook endpoint.
   */
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.api_webhooks'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const deleted = await webhookDispatcherService.deleteEndpoint(id);
      if (!deleted) {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Webhook endpoint with ID '${id}' not found`,
        });
      }
      return reply.code(200).send({ success: true, message: 'Webhook endpoint deleted' });
    }
  );

  /**
   * POST /api/webhooks/:id/test
   * Sends a test event with HMAC-SHA256 signature to verify receiver endpoint.
   */
  app.post<{ Params: { id: string } }>(
    '/:id/test',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN]),
        requireCapability('extended.api_webhooks'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const result = await webhookDispatcherService.sendTestPing(id);

      if (!result.success) {
        return reply.code(502).send({
          statusCode: 502,
          error: 'Webhook Dispatch Error',
          message: result.error || 'Failed to deliver test ping',
          deliveryId: result.deliveryId,
        });
      }

      return reply.code(200).send({
        success: true,
        deliveryId: result.deliveryId,
        status: result.status,
        message: 'Test ping delivered successfully',
      });
    }
  );
};

export default webhookRoutes;
