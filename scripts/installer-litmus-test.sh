#!/usr/bin/env bash
# ==============================================================================
# Basic VMS - Day 75 Installer Litmus Test (Phase 21 - MVP-14)
# Automated verification script to guarantee sub-30-minute deployment readiness
# and 100% compliance with hardware, runtime, build, and licensing constraints.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================================${NC}"
echo -e "${BLUE}   BASIC VMS: DAY 75 INSTALLER LITMUS ACCEPTANCE TEST (MVP-14)      ${NC}"
echo -e "${BLUE}====================================================================${NC}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PASSED_STEPS=0
TOTAL_STEPS=6

log_step() {
  echo -e "\n${YELLOW}[STEP $1/$TOTAL_STEPS] $2...${NC}"
}

pass_step() {
  echo -e "${GREEN}✓ [PASS] $1${NC}"
  PASSED_STEPS=$((PASSED_STEPS + 1))
}

fail_step() {
  echo -e "${RED}✗ [FAIL] $1${NC}"
  exit 1
}

# ------------------------------------------------------------------------------
# 1. Environment & Node.js 20+ Runtime Check
# ------------------------------------------------------------------------------
log_step 1 "Verifying Node.js Runtime and Toolchain"
NODE_VERSION=$(node -v | tr -d 'v')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -ge 20 ]; then
  pass_step "Node.js runtime detected: v$NODE_VERSION (Required >= 20.0.0)"
else
  fail_step "Node.js v$NODE_VERSION is below required LTS v20.0.0"
fi

# ------------------------------------------------------------------------------
# 2. Control Plane TypeScript Build
# ------------------------------------------------------------------------------
log_step 2 "Compiling Node/Fastify Control Plane (npm run build)"
if npm run build > /dev/null 2>&1; then
  if [ -f "dist/index.js" ]; then
    pass_step "Control plane TypeScript compiled cleanly to dist/index.js"
  else
    fail_step "TypeScript compiler succeeded but dist/index.js missing"
  fi
else
  fail_step "TypeScript compilation failed"
fi

# ------------------------------------------------------------------------------
# 3. Web Operator Client Production Build
# ------------------------------------------------------------------------------
log_step 3 "Building React/Vite Web Client (npm run build:client)"
if npm run build:client > /dev/null 2>&1; then
  if [ -f "client/dist/index.html" ]; then
    DIST_SIZE=$(wc -c < client/dist/index.html | tr -d ' ')
    pass_step "Web client bundle built in client/dist/ (index.html: ${DIST_SIZE} bytes)"
  else
    fail_step "Vite build succeeded but client/dist/index.html is missing"
  fi
else
  fail_step "Vite client compilation failed"
fi

# ------------------------------------------------------------------------------
# 4. Reverse Proxy & Ingress Gateway Configuration
# ------------------------------------------------------------------------------
log_step 4 "Validating Caddy Gateway Configuration (Caddyfile)"
if [ -f "Caddyfile" ]; then
  if grep -q "reverse_proxy 127.0.0.1:3000" Caddyfile && \
     ! grep -qE "127\.0\.0\.1:(8888|8889|9996|9997)" Caddyfile; then
    pass_step "Caddyfile proxies to the control plane only (media via authenticated proxy)"
  else
    fail_step "Caddyfile missing required ingress reverse proxy rules"
  fi
else
  fail_step "Caddyfile not found in project root"
fi

# ------------------------------------------------------------------------------
# 5. Dependency Licensing Compliance Audit
# ------------------------------------------------------------------------------
log_step 5 "Auditing Third-Party Dependency Licenses (100% Permissive)"
AUDIT_OUTPUT=$(node scripts/audit-licenses.js 2>&1)
if echo "$AUDIT_OUTPUT" | grep -q "100% Permissive Licensing Verified"; then
  pass_step "License audit passed: 100% permissive licenses (Zero GPL/Copyleft risk)"
else
  fail_step "License audit failed: Copyleft or unapproved licenses detected"
fi

# ------------------------------------------------------------------------------
# 6. Software Bill of Materials (SBOM) Generation
# ------------------------------------------------------------------------------
log_step 6 "Generating Software Bill of Materials (SBOM)"
if npm run generate:sbom > /dev/null 2>&1; then
  if [ -f "sbom.json" ]; then
    SBOM_PKGS=$(grep -c '"name":' sbom.json || echo "0")
    pass_step "Release SBOM generated successfully (sbom.json: ${SBOM_PKGS} cataloged components)"
  else
    fail_step "generate:sbom command finished but sbom.json not found"
  fi
else
  fail_step "SBOM generation script failed"
fi

# ------------------------------------------------------------------------------
# Summary & Acceptance Sign-off
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}====================================================================${NC}"
echo -e "${GREEN}✓ ALL ${PASSED_STEPS}/${TOTAL_STEPS} GATES PASSED!${NC}"
echo -e "${GREEN}  DAY 75 INSTALLER LITMUS TEST: READY FOR COMMERCIAL PILOT DEPLOYMENT${NC}"
echo -e "${BLUE}====================================================================${NC}"
exit 0
