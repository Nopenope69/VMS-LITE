import { FastifyInstance } from 'fastify';

/**
 * Initiates graceful shutdown sequence:
 * 1. Calls app.close() which triggers the onClose hook (engine.stop(), service teardown, etc.)
 * 2. Schedules SIGTERM to own process after 500ms delay so the HTTP response can flush first.
 */
export async function initiateGracefulShutdown(app: FastifyInstance): Promise<void> {
  await app.close();
  // Allow the response to flush before signaling the process manager
  setTimeout(() => {
    process.kill(process.pid, 'SIGTERM');
  }, 500);
}

/**
 * Registers SIGTERM and SIGINT handlers that perform orderly shutdown:
 * app.close() → process.exit(0).
 *
 * Recording Invariant: engine.stop() is called inside the onClose hook,
 * so all in-progress segment writes complete before exit.
 */
export function registerProcessSignalHandlers(app: FastifyInstance): void {
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, `Received ${signal}, starting graceful shutdown…`);
    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'Error during graceful shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
