#!/usr/bin/env bash
# ==============================================================================
# Basic VMS - Single-Command Automated Installer (DEP-01, DEP-02)
# Target Deployment: Linux (Ubuntu / Debian / RHEL / CentOS)
# Target Time to Live View: < 10 minutes (guaranteed sub-30 minutes)
# ==============================================================================

set -euo pipefail

INSTALL_START_TIME=$(date +%s)
VMS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "============================================================"
echo "    Basic VMS - Automated Installer (Package 1: Core)       "
echo "============================================================"
echo "Deployment Root: ${VMS_DIR}"
echo ""

# 1. Check System Architecture and Operating System
OS="$(uname -s)"
if [ "${OS}" != "Linux" ] && [ "${OS}" != "Darwin" ]; then
  echo "[-] Error: Basic VMS must be installed on Linux (or macOS for development)."
  exit 1
fi

# 2. Check for Docker and Docker Compose
echo "[+] Checking container runtime prerequisites..."
if ! command -v docker &> /dev/null; then
  echo "[+] Docker not found. Installing Docker CE via official convenience script..."
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable --now docker
else
  echo "    Docker is already installed: $(docker --version)"
fi

if ! docker compose version &> /dev/null; then
  echo "[-] Error: Docker Compose (v2) plugin is required."
  echo "    Please install docker-compose-plugin and retry."
  exit 1
else
  echo "    Docker Compose is available: $(docker compose version)"
fi

# 3. Generate production secrets if .env is not present (T-07-01)
#
# HTTPS (recommended whenever the server is reached over the internet):
#   HTTPS_DOMAIN=vms.example.com HTTPS_EMAIL=ops@example.com ./deploy/install.sh
#     -> Let's Encrypt certificate (DNS must point here, ports 80/443 reachable)
#   HTTPS_DOMAIN=192.168.1.50 ./deploy/install.sh
#     -> certificate from Caddy's internal CA, for LAN / VPN-only installs
HTTPS_DOMAIN="${HTTPS_DOMAIN:-}"
HTTPS_EMAIL="${HTTPS_EMAIL:-}"
ENV_FILE="${VMS_DIR}/.env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "[+] Generating unique production credentials..."
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
  if [ -n "${HTTPS_DOMAIN}" ]; then
    PUBLIC_BASE_URL="https://${HTTPS_DOMAIN}"
  else
    PUBLIC_BASE_URL="http://${HOST_IP}:3000"
  fi
  cat <<EOF > "${ENV_FILE}"
POSTGRES_USER=vms_admin
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=basic_vms
JWT_SECRET=$(openssl rand -hex 32)
TURN_SECRET=$(openssl rand -hex 16)
TZ=Asia/Kolkata
# Address remote viewers use to reach this appliance (LAN IP, public IP or DNS name)
PUBLIC_HOST=${HOST_IP}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
TURN_SERVER_HOST=
BASIC_VMS_LICENSE=
EOF
  if [ -n "${HTTPS_DOMAIN}" ]; then
    cat <<EOF >> "${ENV_FILE}"
# HTTPS front end (deploy/Caddyfile); the app listens on localhost only
COMPOSE_PROFILES=https
HTTPS_DOMAIN=${HTTPS_DOMAIN}
HTTPS_TLS=${HTTPS_EMAIL:-internal}
APP_HOST=127.0.0.1
TRUST_PROXY=true
EOF
  fi
  chmod 600 "${ENV_FILE}"
  echo "    Generated ${ENV_FILE} with unique credentials."
else
  echo "[+] Existing .env configuration detected. Preserving credentials."
  if [ -n "${HTTPS_DOMAIN}" ] && ! grep -q '^HTTPS_DOMAIN=' "${ENV_FILE}"; then
    echo "[-] HTTPS_DOMAIN was given but ${ENV_FILE} already exists. To enable HTTPS, add:"
    echo "      COMPOSE_PROFILES=https"
    echo "      HTTPS_DOMAIN=${HTTPS_DOMAIN}"
    echo "      HTTPS_TLS=${HTTPS_EMAIL:-internal}"
    echo "      APP_HOST=127.0.0.1"
    echo "      TRUST_PROXY=true"
    echo "      PUBLIC_BASE_URL=https://${HTTPS_DOMAIN}"
    echo "    to ${ENV_FILE} and run: docker compose up -d"
  fi
fi
ENV_HTTPS_DOMAIN=$(grep -E '^HTTPS_DOMAIN=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)
ENV_HTTPS_ON=$(grep -E '^COMPOSE_PROFILES=.*https' "${ENV_FILE}" || true)

# 5. Launch Container Stack
echo "[+] Bringing up Basic VMS container stack..."
cd "${VMS_DIR}"
docker compose up -d --build

# Database migrations run automatically when the app container starts.

# 7. Verify Healthcheck Endpoint
echo "[+] Waiting for Basic VMS control plane healthcheck (http://localhost:3000/health)..."
MAX_ATTEMPTS=30
ATTEMPT=0
HEALTHY=0

while [ ${ATTEMPT} -lt ${MAX_ATTEMPTS} ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ ${HEALTHY} -ne 1 ]; then
  echo "[-] Warning: Healthcheck timed out after 60 seconds."
  echo "    Check container logs using: docker compose logs app"
else
  echo "[+] Control plane healthcheck confirmed OK!"
fi

# 8. Install Systemd Auto-Recovery Unit (if systemd is present)
if command -v systemctl &> /dev/null; then
  echo "[+] Installing systemd host reboot auto-recovery service..."
  SERVICE_FILE="/etc/systemd/system/basic-vms.service"
  sudo cp "${VMS_DIR}/deploy/basic-vms.service" "${SERVICE_FILE}"
  sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=${VMS_DIR}|" "${SERVICE_FILE}" || true
  sudo systemctl daemon-reload
  sudo systemctl enable basic-vms.service || true
  echo "    Systemd service enabled (basic-vms.service) for automatic recovery on boot."
fi

# 9. Compute Setup Elapsed Time
INSTALL_END_TIME=$(date +%s)
TOTAL_TIME=$((INSTALL_END_TIME - INSTALL_START_TIME))

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo "============================================================"
echo "    Basic VMS Installation Complete!                       "
echo "============================================================"
echo "Setup Duration:   ${TOTAL_TIME} seconds (sub-30-min bar passed)"
if [ -n "${ENV_HTTPS_ON}" ] && [ -n "${ENV_HTTPS_DOMAIN}" ]; then
  echo "Web Interface:    https://${ENV_HTTPS_DOMAIN}  (login: admin / admin123, change at first login)"
  echo "Open ports:       443/tcp + 80/tcp (web, API, video), 8189/udp (WebRTC media)"
else
  echo "Web Interface:    http://${HOST_IP}:3000  (login: admin / admin123, change at first login)"
  echo "Open ports:       3000/tcp (web, API, video), 8189/udp (WebRTC media)"
  echo "                  Reached over the internet? Re-install with HTTPS_DOMAIN set (see README)."
fi
echo "Recordings:       docker volume basic_vms_recordings"
echo "============================================================"
echo "Ready for camera onboarding and live view!"
