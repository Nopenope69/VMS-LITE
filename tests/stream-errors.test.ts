import { describe, it, expect } from 'vitest';
import {
  MediaHttpError,
  classifyError,
  classifyHttpFailure,
  classifyMediaElementError,
} from '../client/src/utils/stream-errors.js';

describe('Live stream failure classification (player error copy)', () => {
  it('reports codec problems as unsupported, not as an offline camera', () => {
    // MediaMTX WHEP answer when the browser lacks the camera codec
    expect(classifyHttpFailure(400, '{"error":"codecs not supported by client"}').kind).toBe('unsupported_codec');
    expect(classifyError(new MediaHttpError(400, 'codecs not supported by client')).kind).toBe('unsupported_codec');
    expect(classifyMediaElementError(4).kind).toBe('unsupported_codec');
  });

  it('distinguishes a camera not sending video, permissions and an unreachable server', () => {
    expect(classifyHttpFailure(404, 'no stream is available on path').kind).toBe('no_stream');
    expect(classifyHttpFailure(403).kind).toBe('forbidden');
    expect(classifyHttpFailure(502).kind).toBe('unreachable');
    expect(classifyError(new Error('WHEP connection timed out')).kind).toBe('unreachable');
    expect(classifyError(new Error('boom')).kind).toBe('unknown');
  });
});
