/**
 * Orders playback lanes by site (site list order, unassigned last), keeping the
 * user's selection order within a site, and labels each lane with its site name.
 * Without sites, lanes keep selection order and get no group.
 */
export function orderLanesBySite<T extends { cameraId: string }>(
  lanes: T[],
  cameraSite: (cameraId: string) => string | null | undefined,
  sites: Array<{ id: string | null; name: string }>
): Array<T & { group?: string }> {
  if (!sites.some((site) => site.id !== null)) return lanes.map((lane) => ({ ...lane }));
  const order = new Map<string | null, { name: string; order: number }>();
  sites.forEach((site, i) => order.set(site.id, { name: site.name, order: i }));
  if (!order.has(null)) order.set(null, { name: 'Unassigned', order: sites.length });

  return lanes
    .map((lane, selectionOrder) => {
      const site = order.get(cameraSite(lane.cameraId) ?? null) ?? order.get(null)!;
      return { lane: { ...lane, group: site.name }, siteOrder: site.order, selectionOrder };
    })
    .sort((a, b) => a.siteOrder - b.siteOrder || a.selectionOrder - b.selectionOrder)
    .map((entry) => entry.lane);
}
