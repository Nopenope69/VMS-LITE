import net from 'node:net';

export interface TcpProbeResult {
  reachable: boolean;
  /** Handshake time; null when unreachable */
  latencyMs: number | null;
  error?: string;
}

export type TcpProbe = (host: string, port?: number, timeoutMs?: number) => Promise<TcpProbeResult>;

/**
 * TCP handshake to a camera port (RTSP 554 by default): the one reachability check used
 * by onboarding, the RTSP adapter and the health monitor. The socket is destroyed on
 * every path.
 */
export const probeTcp: TcpProbe = (host, port = 554, timeoutMs = 2500) =>
  new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ reachable, latencyMs: reachable ? Math.max(1, Date.now() - startTime) : null, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, `TCP connection timed out after ${timeoutMs}ms`));
    socket.once('error', (err) => finish(false, err.message));
    try {
      socket.connect(port, host);
    } catch (err: any) {
      finish(false, err.message);
    }
  });
