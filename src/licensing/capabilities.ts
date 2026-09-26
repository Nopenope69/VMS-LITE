import {
  CORE_CAPABILITIES,
  ICapabilityRegistry,
  LicenseEdition,
  LicensePayload,
} from './types.js';

export class CapabilityRegistry implements ICapabilityRegistry {
  private readonly capabilities: Set<string>;
  private readonly cameraLimit: number;
  private readonly expiresAt: Date | null;
  private readonly edition: LicenseEdition;

  constructor(payload: LicensePayload) {
    this.capabilities = new Set(payload.capabilities);
    this.cameraLimit = payload.cameraLimit;
    this.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    this.edition = payload.edition;
  }

  has(capability: string): boolean {
    if (this.isExpired()) {
      return false;
    }
    return this.capabilities.has(capability);
  }

  getCameraLimit(): number {
    return this.cameraLimit;
  }

  getExpiresAt(): Date | null {
    return this.expiresAt;
  }

  getEdition(): LicenseEdition {
    return this.edition;
  }

  getAllCapabilities(): string[] {
    if (this.isExpired()) {
      return [];
    }
    return Array.from(this.capabilities);
  }

  isExpired(): boolean {
    if (!this.expiresAt) {
      return false;
    }
    return this.expiresAt.getTime() < Date.now();
  }
}

/**
 * Creates a fallback evaluation registry for cold-boot or unlicensed dev mode.
 * Provides Package 1 Core capabilities with a 2-camera limit.
 */
export function createEvaluationRegistry(): CapabilityRegistry {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return new CapabilityRegistry({
    product: 'basic-vms',
    edition: 'core',
    capabilities: [...CORE_CAPABILITIES],
    cameraLimit: 2,
    expiresAt: thirtyDaysFromNow,
    issuedAt: new Date().toISOString(),
  });
}
