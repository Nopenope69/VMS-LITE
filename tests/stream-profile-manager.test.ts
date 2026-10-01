import { describe, it, expect } from 'vitest';
import { resolveStreamProfile } from '../client/src/utils/streamProfileManager.js';

describe('StreamProfileManager Quality Resolution Engine', () => {
  it('resolves SUB profile in GRID mode when camera exposes a sub-stream', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('SUB');
    expect(res.path).toBe('cam_warehouse_sub');
    expect(res.isHdOnly).toBe(false);
  });

  it('resolves MAIN profile in FOCUSED mode even if sub-stream exists', () => {
    const res = resolveStreamProfile({
      viewMode: 'FOCUSED',
      operatorOverride: 'AUTO',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_warehouse');
    expect(res.isHdOnly).toBe(false);
  });

  it('resolves MAIN profile in FULLSCREEN mode even if sub-stream exists', () => {
    const res = resolveStreamProfile({
      viewMode: 'FULLSCREEN',
      operatorOverride: 'AUTO',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_warehouse');
    expect(res.isHdOnly).toBe(false);
  });

  it('respects manual operator override HD over viewMode', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'HD',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_warehouse');
    expect(res.isHdOnly).toBe(false);
  });

  it('respects manual operator override SD over viewMode', () => {
    const res = resolveStreamProfile({
      viewMode: 'FULLSCREEN',
      operatorOverride: 'SD',
      mainPath: 'cam_warehouse',
      subPath: 'cam_warehouse_sub',
    });
    expect(res.selectedStream).toBe('SUB');
    expect(res.path).toBe('cam_warehouse_sub');
    expect(res.isHdOnly).toBe(false);
  });

  it('gracefully falls back to MAIN with HD-only status when camera lacks sub-stream', () => {
    const res = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam_legacy',
      subPath: null,
    });
    expect(res.selectedStream).toBe('MAIN');
    expect(res.path).toBe('cam_legacy');
    expect(res.isHdOnly).toBe(true);
  });

  it('falls back to MAIN with HD-only status when sub-stream is empty string or undefined', () => {
    const resEmpty = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'SD',
      mainPath: 'cam_legacy',
      subPath: '',
    });
    expect(resEmpty.selectedStream).toBe('MAIN');
    expect(resEmpty.path).toBe('cam_legacy');
    expect(resEmpty.isHdOnly).toBe(true);

    const resUndefined = resolveStreamProfile({
      viewMode: 'GRID',
      operatorOverride: 'AUTO',
      mainPath: 'cam_legacy',
      subPath: undefined,
    });
    expect(resUndefined.selectedStream).toBe('MAIN');
    expect(resUndefined.path).toBe('cam_legacy');
    expect(resUndefined.isHdOnly).toBe(true);
  });
});
