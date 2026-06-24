#!/usr/bin/env bash
# ============================================================================
# VPS pull-based self-deploy
# ============================================================================
# Runs ON the Hetzner box (via cron) and deploys both apps straight from git —
# WITHOUT GitHub Actions, which is currently billing-locked ("job was not started
# because your account is locked due to a billing issue") and therefore never
# reaches the SSH deploy step. This restores hands-off "deploy from main".
#
# It is a no-op when there is nothing new to pull, so it is cheap to run often.
#
# ── INSTALL (run once on the server, as root) ───────────────────────────────
#   # 1. Put this script at a STABLE path OUTSIDE the deployed repos, so a deploy
#   #    can never rewrite the file mid-run:
#   install -m 0755 /var/www/baradzanwa/scripts/vps-selfdeploy.sh /usr/local/bin/vps-selfdeploy.sh
#
#   # 2. Add a cron entry (every 2 minutes):
#   ( crontab -l 2>/dev/null; echo '*/2 * * * * /usr/local/bin/vps-selfdeploy.sh >> /var/log/vps-selfdeploy.log 2>&1' ) | crontab -
#
#   # 3. Tail the log to watch deploys:
#   tail -f /var/log/vps-selfdeploy.log
#
# Re-enable GitHub Actions later (after fixing billing) and this can be removed —
# or kept as a billing-independent fallback. The two are idempotent and harmless
# together (whichever pulls first wins; the other sees "up to date").
# ============================================================================
set -euo pipefail

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# deploy_app <label> <repo_dir> <pm2_process_name>
deploy_app() {
  local label="$1" dir="$2" pm2name="$3"

  if [ ! -d "$dir/.git" ]; then
    log "$label: $dir is not a git checkout — skipping"
    return 0
  fi
  cd "$dir"

  git fetch origin main --quiet
  local local_sha remote_sha
  local_sha=$(git rev-parse HEAD)
  remote_sha=$(git rev-parse origin/main)

  if [ "$local_sha" = "$remote_sha" ]; then
    log "$label: up to date (${local_sha:0:8})"
    return 0
  fi

  log "$label: ${local_sha:0:8} -> ${remote_sha:0:8} — deploying"
  git reset --hard origin/main
  # full install: the build needs devDependencies (vite); --omit=dev breaks build
  npm ci
  npm run build
  # --update-env so any new env vars are picked up; restart is zero-config
  pm2 restart "$pm2name" --update-env || pm2 start npm --name "$pm2name" -- start
  log "$label: deployed ${remote_sha:0:8}"
}

log "── self-deploy run start ──"
deploy_app "Baradzanwa"   /var/www/baradzanwa    baradzanwa-api
deploy_app "Villa Gianni" /var/www/villa-gianni  villa-gianni-api
pm2 save >/dev/null 2>&1 || true
log "── self-deploy run done ──"
