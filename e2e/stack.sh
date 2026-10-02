#!/usr/bin/env bash
# Starts or stops the stack the browser end-to-end test runs against:
#   a simulated camera (MediaMTX + ffmpeg test pattern; H.264 like real cameras, or
#   E2E_CAMERA_CODEC=vp9 for Chromium builds without H.264),
#   the VMS MediaMTX (repo mediamtx.yml, 10 s recording segments) and the built app.
#
#   MEDIAMTX_BIN=/path/to/mediamtx DATABASE_URL=postgresql://... e2e/stack.sh start
#   e2e/stack.sh stop
#
# Needs: npm run build && npm run build:client, ffmpeg, an empty PostgreSQL database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="${E2E_RUN_DIR:-${ROOT}/e2e/.run}"
PORT="${E2E_PORT:-3100}"

stop() {
  if [ -d "${RUN}/pids" ]; then
    for pidfile in "${RUN}"/pids/*.pid; do
      [ -f "${pidfile}" ] && kill "$(cat "${pidfile}")" 2>/dev/null || true
    done
    rm -rf "${RUN}/pids"
  fi
}

start() {
  : "${MEDIAMTX_BIN:?Set MEDIAMTX_BIN to the mediamtx binary}"
  : "${DATABASE_URL:?Set DATABASE_URL to an empty PostgreSQL database}"
  stop
  mkdir -p "${RUN}/pids" "${RUN}/rec" "${RUN}/logs"

  run_bg() { # name, command...
    local name="$1"; shift
    nohup "$@" > "${RUN}/logs/${name}.log" 2>&1 &
    echo $! > "${RUN}/pids/${name}.pid"
  }

  run_bg camera-mediamtx "${MEDIAMTX_BIN}" "${ROOT}/e2e/camera-sim.yml"
  sleep 1
  local codec_args
  if [ "${E2E_CAMERA_CODEC:-h264}" = "vp9" ]; then
    codec_args=(-strict experimental -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k -g 15)
  else
    codec_args=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p -g 15)
  fi
  run_bg camera-ffmpeg ffmpeg -nostdin -loglevel error -re \
    -f lavfi -i "testsrc2=size=320x240:rate=15" \
    "${codec_args[@]}" \
    -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:18554/cam

  MTX_PATHDEFAULTS_RECORDPATH="${RUN}/rec/%path/%Y-%m-%d_%H-%M-%S-%f" \
  MTX_PATHDEFAULTS_RECORDSEGMENTDURATION=10s \
    run_bg vms-mediamtx "${MEDIAMTX_BIN}" "${ROOT}/mediamtx.yml"

  (cd "${ROOT}" && npx prisma migrate deploy > "${RUN}/logs/migrate.log" 2>&1)

  (
    cd "${ROOT}"
    export NODE_ENV=production HOST=127.0.0.1 PORT="${PORT}"
    export RECORDINGS_PATH="${RUN}/rec" BACKUPS_PATH="${RUN}/backups" AUTO_BACKUP=false
    export JWT_SECRET="${JWT_SECRET:-e2e-only-secret-e2e-only-secret-0123456789}"
    run_bg app node dist/index.js
  )

  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null; then
      echo "e2e stack up on http://127.0.0.1:${PORT}"
      return 0
    fi
    sleep 1
  done
  echo "App did not become healthy; logs in ${RUN}/logs" >&2
  tail -n 40 "${RUN}/logs/app.log" >&2 || true
  exit 1
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
