/**
 * Vendor Ed25519 public key (hex) that verifies license tokens in production.
 *
 * It is compiled into the application on purpose: if it were read from the
 * environment, anyone running the appliance could point it at their own key and
 * sign themselves an unlimited license.
 *
 * Generate the keypair with `node scripts/license-tool.mjs keygen` on a vendor
 * machine, paste the printed public key here, and keep the private key offline.
 * While this is empty, production appliances run in evaluation mode.
 */
export const VENDOR_LICENSE_PUBLIC_KEY_HEX = '';
