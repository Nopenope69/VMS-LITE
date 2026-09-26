import crypto from 'node:crypto';
import { prisma as defaultPrisma } from '../db/prisma.js';
import {
  BookmarkDto,
  BookmarkQueryParams,
  CreateBookmarkRequest,
} from './bookmark.types.js';

export interface BookmarkServiceOptions {
  prisma?: any;
}

export class BookmarkService {
  private readonly prisma: any;
  private readonly memoryBookmarks = new Map<string, BookmarkDto>();

  constructor(opts: BookmarkServiceOptions = {}) {
    this.prisma = opts.prisma || defaultPrisma;
  }

  async listBookmarks(
    cameraId: string,
    query: BookmarkQueryParams = {}
  ): Promise<BookmarkDto[]> {
    const fromDate = query.from ? new Date(query.from) : undefined;
    const toDate = query.to ? new Date(query.to) : undefined;

    try {
      const where: any = { cameraId };
      if (fromDate || toDate) {
        where.timestamp = {};
        if (fromDate) where.timestamp.gte = fromDate;
        if (toDate) where.timestamp.lte = toDate;
      }
      if (query.category) {
        where.category = query.category;
      }

      const results = await this.prisma.bookmark.findMany({
        where,
        orderBy: { timestamp: 'asc' },
      });

      return results.map((b: any) => this.mapPrismaBookmark(b));
    } catch {
      // In-memory fallback
      let list = Array.from(this.memoryBookmarks.values()).filter(
        (b) => b.cameraId === cameraId
      );
      if (fromDate) {
        list = list.filter((b) => new Date(b.timestamp) >= fromDate);
      }
      if (toDate) {
        list = list.filter((b) => new Date(b.timestamp) <= toDate);
      }
      if (query.category) {
        list = list.filter((b) => b.category === query.category);
      }
      return list.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    }
  }

  async createBookmark(
    cameraId: string,
    req: CreateBookmarkRequest,
    userId?: string | null
  ): Promise<BookmarkDto> {
    if (!req.title || !req.title.trim()) {
      throw new Error('Bookmark title is required');
    }
    if (!req.timestamp) {
      throw new Error('Bookmark timestamp is required');
    }

    const id = crypto.randomUUID();
    const timestamp = new Date(req.timestamp);
    const category = req.category || 'incident';
    const now = new Date();

    const bookmark: BookmarkDto = {
      id,
      cameraId,
      userId: userId || null,
      timestamp: timestamp.toISOString(),
      title: req.title.trim(),
      description: req.description?.trim() || null,
      category,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.memoryBookmarks.set(id, bookmark);

    try {
      const created = await this.prisma.bookmark.create({
        data: {
          id,
          cameraId,
          userId: userId || null,
          timestamp,
          title: bookmark.title,
          description: bookmark.description,
          category: bookmark.category,
          createdAt: now,
          updatedAt: now,
        },
      });
      return this.mapPrismaBookmark(created);
    } catch {
      // Prisma write failed, memory serves as return
      return bookmark;
    }
  }

  async getBookmark(id: string): Promise<BookmarkDto | null> {
    const mem = this.memoryBookmarks.get(id);
    if (mem) return mem;

    try {
      const b = await this.prisma.bookmark.findUnique({ where: { id } });
      if (!b) return null;
      return this.mapPrismaBookmark(b);
    } catch {
      return null;
    }
  }

  async deleteBookmark(id: string): Promise<boolean> {
    const hadMem = this.memoryBookmarks.delete(id);

    try {
      await this.prisma.bookmark.delete({ where: { id } });
      return true;
    } catch {
      return hadMem;
    }
  }

  private mapPrismaBookmark(b: any): BookmarkDto {
    return {
      id: b.id,
      cameraId: b.cameraId,
      userId: b.userId,
      timestamp: b.timestamp.toISOString(),
      title: b.title,
      description: b.description,
      category: b.category,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }
}

export const bookmarkService = new BookmarkService();
