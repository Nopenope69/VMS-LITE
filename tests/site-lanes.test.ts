import { describe, it, expect } from 'vitest';
import { orderLanesBySite } from '../client/src/utils/site-lanes.js';

describe('Recordings: site lanes', () => {
  const sites = [
    { id: 'north', name: 'North' },
    { id: 'south', name: 'South' },
    { id: null, name: 'Unassigned' },
  ];
  const siteOf: Record<string, string | null> = { a: 'south', b: null, c: 'north', d: 'south' };

  it('groups lanes by site order, keeping selection order within a site', () => {
    const lanes = ['a', 'b', 'c', 'd'].map((cameraId) => ({ cameraId }));
    const ordered = orderLanesBySite(lanes, (id) => siteOf[id], sites);
    expect(ordered.map((l) => [l.cameraId, l.group])).toEqual([
      ['c', 'North'],
      ['a', 'South'],
      ['d', 'South'],
      ['b', 'Unassigned'],
    ]);
  });

  it('leaves single-site installs ungrouped in selection order', () => {
    const lanes = [{ cameraId: 'x' }, { cameraId: 'y' }];
    const ordered = orderLanesBySite(lanes, () => null, [{ id: null, name: 'Unassigned' }]);
    expect(ordered).toEqual([{ cameraId: 'x' }, { cameraId: 'y' }]);
  });
});
