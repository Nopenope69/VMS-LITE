import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireCameraPermission, requireRole } from '../users/rbac.guard.js';
import { requireCapability } from '../licensing/plugin.js';
import { bookmarkService } from './bookmark.service.js';

const CreateBookmarkSchema = z.object({
  timestamp: z.string().datetime(),
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  category: z.enum(['incident', 'visitor', 'maintenance', 'activity']).optional(),
});

const QueryBookmarkSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  category: z.string().optional(),
});

export const bookmarkRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/cameras/:id/bookmarks
   * Range query for camera bookmarks filtered by time window and category
   */
  app.get<{ Params: { id: string } }>(
    '/:id/bookmarks',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canViewPlayback'),
        requireCapability('extended.bookmarks'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsedQuery = QueryBookmarkSchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid bookmark query parameters',
          details: parsedQuery.error.errors,
        });
      }

      const bookmarks = await bookmarkService.listBookmarks(id, parsedQuery.data);
      return reply.send({
        success: true,
        bookmarks,
      });
    }
  );

  /**
   * POST /api/cameras/:id/bookmarks
   * Creates a timeline incident/activity bookmark
   */
  app.post<{ Params: { id: string } }>(
    '/:id/bookmarks',
    {
      preHandler: [
        authenticate,
        requireCameraPermission('canViewPlayback'),
        requireCapability('extended.bookmarks'),
      ],
    },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = CreateBookmarkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid bookmark body',
          details: parsed.error.errors,
        });
      }

      const bookmark = await bookmarkService.createBookmark(
        id,
        parsed.data,
        (request as any).user?.id
      );

      return reply.status(201).send({
        success: true,
        bookmark,
      });
    }
  );

  /**
   * DELETE /api/cameras/:id/bookmarks/:bookmarkId
   * Deletes a bookmark (Admin and Operator only)
   */
  app.delete<{ Params: { id: string; bookmarkId: string } }>(
    '/:id/bookmarks/:bookmarkId',
    {
      preHandler: [
        authenticate,
        requireRole([Role.ADMIN, Role.OPERATOR]),
        requireCapability('extended.bookmarks'),
      ],
    },
    async (request, reply) => {
      const { bookmarkId } = request.params;
      const deleted = await bookmarkService.deleteBookmark(bookmarkId);

      if (!deleted) {
        return reply.status(404).send({
          error: 'NotFound',
          message: `Bookmark ${bookmarkId} not found`,
        });
      }

      return reply.send({
        success: true,
        deleted: true,
      });
    }
  );
};
