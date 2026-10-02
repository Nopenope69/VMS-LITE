#!/usr/bin/env bash
# ==============================================================================
# VMS-Lite field update
#
#   ./deploy/update.sh                 update to the latest commit of the current branch
#   ./deploy/update.sh --ref v1.2.0    update to a tag, branch or commit
#   ./deploy/update.sh --rollback      undo the last update (code and database)
#
# Steps: refuse local file changes, dump the database (backups/), fetch the new
# code, rebuild and restart (migrations run when the app starts), wait for the
# health check. Recordings are untouched. If the new version does not come up,
# the script says so and --rollback restores the previous code and database.
# ==============================================================================
set -euo pipefail

VMS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="${VMS_DIR}/backups/last-update.env"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() { echo "[update] $*"; }
fail() { echo "[update] ERROR: $*" >&2; exit 1; }

env_value() { # key -> value from .env (last occurrence), or empty
  grep -E "^$1=" "${VMS_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

cd "${VMS_DIR}"
[ -f .env ] || fail "No .env in ${VMS_DIR}: run deploy/install.sh first."
command -v git > /dev/null || fail "git is required."
docker compose version > /dev/null 2>&1 || fail "Docker Compose v2 is required."

PG_USER="$(env_value POSTGRES_USER)"; PG_USER="${PG_USER:-vms_user}"
PG_DB="$(env_value POSTGRES_DB)"; PG_DB="${PG_DB:-basic_vms}"
PORT="$(env_value PORT)"; PORT="${PORT:-3000}"

wait_healthy() {
  log "Waiting for the app to report healthy (up to ${HEALTH_TIMEOUT}s)..."
  local waited=0
  while [ "${waited}" -lt "${HEALTH_TIMEOUT}" ]; do
    if curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

restore_database() { # dump file
  log "Restoring database from $1 ..."
  docker compose stop app
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${PG_DB}\" WITH (FORCE);" \
    -c "CREATE DATABASE \"${PG_DB}\" OWNER \"${PG_USER}\";"
  gunzip -c "$1" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U "${PG_USER}" -d "${PG_DB}" > /dev/null
}

rollback() {
  [ -f "${STATE_FILE}" ] || fail "No previous update recorded (${STATE_FILE})."
  # shellcheck disable=SC1090
  . "${STATE_FILE}"
  log "Rolling back to ${PREVIOUS_COMMIT} (${PREVIOUS_REF}) with database dump ${DUMP_FILE}"
  [ -f "${DUMP_FILE}" ] || fail "Database dump ${DUMP_FILE} is missing."
  if [ "${PREVIOUS_REF}" = "HEAD" ]; then
    git checkout --quiet "${PREVIOUS_COMMIT}"
  else
    git checkout --quiet "${PREVIOUS_REF}"
    git reset --quiet --hard "${PREVIOUS_COMMIT}"
  fi
  docker compose up -d postgres
  restore_database "${DUMP_FILE}"
  docker compose up -d --build
  if wait_healthy; then
    log "Rolled back to ${PREVIOUS_COMMIT}. The app is healthy."
  else
    fail "Rolled back, but the app is not healthy: check 'docker compose logs app'."
  fi
}

update() { # target ref or empty
  local target="$1"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    fail "Local changes to tracked files would be overwritten. Commit, stash or revert them first."
  fi

  local previous_commit previous_ref target_commit
  previous_commit="$(git rev-parse HEAD)"
  previous_ref="$(git symbolic-ref --quiet --short HEAD || echo HEAD)"

  # 1. Work out the target first: nothing is touched when there is nothing to do
  log "Fetching updates..."
  git fetch --quiet --tags origin
  if [ -n "${target}" ]; then
    if git show-ref --verify --quiet "refs/remotes/origin/${target}"; then
      target_commit="$(git rev-parse "origin/${target}^{commit}")"
    else
      target_commit="$(git rev-parse --verify --quiet "${target}^{commit}")" \
        || fail "Unknown version '${target}'."
    fi
  else
    [ "${previous_ref}" != "HEAD" ] || fail "Not on a branch: pass --ref <tag|branch|commit>."
    target_commit="$(git rev-parse "origin/${previous_ref}^{commit}")"
    git merge-base --is-ancestor "${previous_commit}" "${target_commit}" \
      || fail "Cannot fast-forward ${previous_ref}; pass --ref to choose a version."
  fi
  if [ "${target_commit}" = "${previous_commit}" ]; then
    log "Already up to date (${previous_commit:0:8}). Nothing to do."
    return 0
  fi

  # 2. Database dump: new migrations cannot be undone without it
  mkdir -p backups
  chmod 700 backups
  local stamp dump
  stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  dump="${VMS_DIR}/backups/pre-update-${stamp}-${previous_commit:0:8}.sql.gz"
  log "Dumping database ${PG_DB} to ${dump}"
  docker compose up -d postgres > /dev/null
  ( umask 077 && docker compose exec -T postgres pg_dump -U "${PG_USER}" -d "${PG_DB}" | gzip > "${dump}" )
  [ "$(gunzip -c "${dump}" | head -c 1 | wc -c)" -gt 0 ] || fail "Database dump is empty; not updating."
  cat > "${STATE_FILE}" <<EOF
PREVIOUS_COMMIT=${previous_commit}
PREVIOUS_REF=${previous_ref}
DUMP_FILE=${dump}
EOF
  chmod 600 "${STATE_FILE}"

  # 3. New code
  if [ -n "${target}" ] && git show-ref --verify --quiet "refs/remotes/origin/${target}"; then
    git checkout --quiet "${target}"      # a branch: follow it
    git merge --quiet --ff-only "origin/${target}"
  elif [ -n "${target}" ]; then
    git checkout --quiet "${target_commit}"  # a tag or commit
  else
    git merge --quiet --ff-only "${target_commit}"
  fi
  local new_commit
  new_commit="$(git rev-parse HEAD)"
  log "Updating ${previous_commit:0:8} -> ${new_commit:0:8}"
  git --no-pager log --oneline "${previous_commit}..${new_commit}" | head -20 || true

  # 4. Rebuild and restart; database migrations run when the app starts
  docker compose up -d --build
  if wait_healthy; then
    log "Update complete: running ${new_commit:0:8}. Database dump kept at ${dump}"
    docker image prune -f > /dev/null 2>&1 || true
  else
    echo "" >&2
    echo "[update] The new version did not become healthy. Logs: docker compose logs app" >&2
    echo "[update] To return to ${previous_commit:0:8} and the pre-update database, run:" >&2
    echo "         ${VMS_DIR}/deploy/update.sh --rollback" >&2
    exit 1
  fi
}

case "${1:-}" in
  --rollback) rollback ;;
  --ref) [ -n "${2:-}" ] || fail "--ref needs a tag, branch or commit"; update "$2" ;;
  "") update "" ;;
  -h|--help) sed -n '2,14p' "$0" ;;
  *) fail "Unknown option '$1' (see --help)" ;;
esac
