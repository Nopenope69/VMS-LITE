import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ICapabilityRegistry } from './types.js';
import { CapabilityRegistry, createEvaluationRegistry } from './capabilities.js';
import { verifyLicenseToken } from './verifier.js';
import { VENDOR_LICENSE_PUBLIC_KEY_HEX } from './vendor-key.js';

/**
 * The verification key is the compiled-in vendor key in production. Explicit code
 * options (tests) may supply one; BASIC_VMS_PUBLIC_KEY is honoured only outside
 * production, so an appliance operator cannot swap in a self-made key.
 */
export function resolveLicensePublicKey(
  explicitKeyHex: string | undefined,
  fastify?: FastifyInstance
): string | undefined {
  if (explicitKeyHex) return explicitKeyHex;
  const envKey = process.env.BASIC_VMS_PUBLIC_KEY;
  if (process.env.NODE_ENV !== 'production') {
    return envKey || VENDOR_LICENSE_PUBLIC_KEY_HEX || undefined;
  }
  if (envKey && envKey !== VENDOR_LICENSE_PUBLIC_KEY_HEX) {
    fastify?.log.warn('[Licensing] BASIC_VMS_PUBLIC_KEY is ignored in production; the built-in vendor key is used.');
  }
  return VENDOR_LICENSE_PUBLIC_KEY_HEX || undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    capabilities: ICapabilityRegistry;
  }
}

export interface LicensingPluginOptions {
  licenseToken?: string;
  publicKeyHex?: string;
  fallbackToEvaluation?: boolean;
}

/**
 * Fastify plugin that initializes and decorates the server with the CapabilityRegistry.
 */
async function licensingPluginAsync(
  fastify: FastifyInstance,
  opts: LicensingPluginOptions = {}
): Promise<void> {
  let registry: ICapabilityRegistry;

  const token = opts.licenseToken ?? process.env.BASIC_VMS_LICENSE;
  const publicKeyHex = resolveLicensePublicKey(opts.publicKeyHex, fastify);

  if (token && publicKeyHex) {
    try {
      const payload = await verifyLicenseToken(token, publicKeyHex);
      registry = new CapabilityRegistry(payload);
      fastify.log.info(
        `[Licensing] Loaded ${payload.edition.toUpperCase()} license with ${payload.capabilities.length} capabilities (camera limit: ${payload.cameraLimit})`
      );
    } catch (err) {
      if (opts.fallbackToEvaluation !== false) {
        fastify.log.warn(
          `[Licensing] Failed to verify license token (${(err as Error).message}). Falling back to evaluation mode.`
        );
        registry = createEvaluationRegistry();
      } else {
        throw err;
      }
    }
  } else {
    fastify.log.info(
      token
        ? '[Licensing] No vendor public key is built in; license token cannot be verified. Initializing in Evaluation Core mode.'
        : '[Licensing] No license provided. Initializing in Evaluation Core mode.'
    );
    registry = createEvaluationRegistry();
  }

  fastify.decorate('capabilities', registry);
}

export const licensingPlugin = fp(licensingPluginAsync, {
  name: 'basic-vms-licensing',
  fastify: '4.x || 5.x',
});

/**
 * Route pre-handler hook to gate endpoints by required capability.
 * Responds with HTTP 403 Forbidden if capability is missing or expired.
 */
export function requireCapability(capability: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const capabilities = request.server.capabilities;
    if (!capabilities || !capabilities.has(capability)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: `Missing required capability: '${capability}'`,
        capability,
      });
    }
  };
}
