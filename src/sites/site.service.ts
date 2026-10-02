import { z } from 'zod';
import { prisma as defaultPrisma } from '../db/prisma.js';
import { CameraHealthService, cameraHealthService as defaultHealth } from '../health/camera-health.service.js';

/**
 * Sites group cameras by physical location. One central server pulls every site's
 * cameras (LAN, VPN or port-forwarded RTSP); the UI filters and summarises by site.
 */

export const SiteInputSchema = z.object({
  name: z.string().trim().min(1, 'Site name is required').max(100),
  address: z.string().trim().max(300).optional().nullable(),
  timezone: z.string().trim().max(64).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export const SiteUpdateSchema = SiteInputSchema.partial();
export type SiteInput = z.infer<typeof SiteInputSchema>;

export interface SiteHealthCounts {
  total: number;
  online: number;
  degraded: number;
  offline: number;
  unknown: number;
}

export interface SiteSummaryDto {
  id: string | null; // null = cameras not assigned to any site
  name: string;
  address: string | null;
  timezone: string | null;
  notes: string | null;
  cameraCount: number;
  health: SiteHealthCounts;
  /** Worst state across the site's cameras */
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN' | 'EMPTY';
}

export class SiteError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'SiteError';
  }
}

export const UNASSIGNED_SITE_NAME = 'Unassigned';

export class SiteService {
  constructor(
    private readonly prisma: any = defaultPrisma,
    private readonly health: Pick<CameraHealthService, 'getTelemetry'> = defaultHealth
  ) {}

  async getSite(id: string) {
    return this.prisma.site.findUnique({ where: { id } });
  }

  async assertSiteExists(id: string | null | undefined): Promise<void> {
    if (!id) return;
    if (!(await this.getSite(id))) {
      throw new SiteError(`Site with id ${id} not found`, 400);
    }
  }

  /**
   * Sites with camera counts and live health, restricted to `visibleCameraIds` when
   * given (operators). The "Unassigned" pseudo-site is included when it has cameras.
   */
  async listSummaries(visibleCameraIds: string[] | null = null): Promise<SiteSummaryDto[]> {
    const [sites, cameras] = await Promise.all([
      this.prisma.site.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.camera.findMany({ select: { id: true, siteId: true } }),
    ]);
    const visible = visibleCameraIds ? new Set(visibleCameraIds) : null;
    const bySite = new Map<string | null, string[]>();
    for (const cam of cameras) {
      if (visible && !visible.has(cam.id)) continue;
      const key = cam.siteId ?? null;
      bySite.set(key, [...(bySite.get(key) ?? []), cam.id]);
    }

    const summaries: SiteSummaryDto[] = sites
      // Operators only see sites where they have at least one camera
      .filter((site: any) => !visible || bySite.has(site.id))
      .map((site: any) => this.summarize(site, bySite.get(site.id) ?? []));

    const unassigned = bySite.get(null);
    if (unassigned?.length) {
      summaries.push(
        this.summarize({ id: null, name: UNASSIGNED_SITE_NAME, address: null, timezone: null, notes: null }, unassigned)
      );
    }
    return summaries;
  }

  private summarize(site: any, cameraIds: string[]): SiteSummaryDto {
    const health: SiteHealthCounts = { total: cameraIds.length, online: 0, degraded: 0, offline: 0, unknown: 0 };
    for (const id of cameraIds) {
      const status = this.health.getTelemetry(id)?.status ?? 'UNKNOWN';
      if (status === 'ONLINE') health.online++;
      else if (status === 'DEGRADED') health.degraded++;
      else if (status === 'OFFLINE') health.offline++;
      else health.unknown++;
    }
    const status: SiteSummaryDto['status'] =
      cameraIds.length === 0
        ? 'EMPTY'
        : health.offline > 0
        ? 'CRITICAL'
        : health.degraded > 0
        ? 'DEGRADED'
        : health.online === 0
        ? 'UNKNOWN' // nothing confirmed yet (just booted / health not checked)
        : 'HEALTHY';
    return {
      id: site.id,
      name: site.name,
      address: site.address ?? null,
      timezone: site.timezone ?? null,
      notes: site.notes ?? null,
      cameraCount: cameraIds.length,
      health,
      status,
    };
  }

  async createSite(input: SiteInput) {
    await this.assertNameFree(input.name);
    return this.prisma.site.create({ data: input });
  }

  async updateSite(id: string, input: Partial<SiteInput>) {
    if (!(await this.getSite(id))) throw new SiteError(`Site with id ${id} not found`, 404);
    if (input.name) await this.assertNameFree(input.name, id);
    return this.prisma.site.update({ where: { id }, data: input });
  }

  async deleteSite(id: string) {
    const site = await this.getSite(id);
    if (!site) throw new SiteError(`Site with id ${id} not found`, 404);
    const cameraCount = await this.prisma.camera.count({ where: { siteId: id } });
    if (cameraCount > 0) {
      throw new SiteError(
        `Site '${site.name}' still has ${cameraCount} camera(s); move or delete them first`,
        409
      );
    }
    await this.prisma.sitePermission.deleteMany({ where: { siteId: id } });
    await this.prisma.site.delete({ where: { id } });
    return site;
  }

  /**
   * First-boot helper: the wizard's site name becomes the first site, and cameras
   * added before any site existed are placed in it. No-op once sites exist.
   */
  async ensureInitialSite(name: string): Promise<void> {
    if ((await this.prisma.site.count()) > 0) return;
    const site = await this.prisma.site.create({ data: { name: name.trim() || 'Main Site' } });
    const unassigned = await this.prisma.camera.findMany({ where: { siteId: null }, select: { id: true } });
    for (const cam of unassigned) {
      await this.prisma.camera.update({ where: { id: cam.id }, data: { siteId: site.id } });
    }
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const existing = await this.prisma.site.findFirst({ where: { name: name.trim() } });
    if (existing && existing.id !== exceptId) {
      throw new SiteError(`A site named '${name}' already exists`, 409);
    }
    if (name.trim().toLowerCase() === UNASSIGNED_SITE_NAME.toLowerCase()) {
      throw new SiteError(`'${UNASSIGNED_SITE_NAME}' is reserved`, 400);
    }
  }
}

export const siteService = new SiteService();
