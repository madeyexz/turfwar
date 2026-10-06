#!/usr/bin/env bash
# One-time setup of a self-hosted Lawbreaker match server on a fresh Ubuntu 24.04 VM (x86_64 or
# arm64), run as root from a copy of this directory:
#
#   sudo deploy/selfhost/setup.sh play.example.com
#
# Installs SpacetimeDB 2.10.2 under /stdb as user `spacetimedb` (listening on localhost only),
# Caddy for TLS on the domain (only the routes the game client uses are public; DNS must already
# point at this machine and ports 80/443 must be open), and the nightly commitlog prune.
set -euo pipefail
DOMAIN="${1:?usage: setup.sh <domain>}"
VERSION=2.10.2
ROOT=/stdb
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB=/usr/local/lib/lawbreaker
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

apt-get update -q
apt-get install -y -q curl caddy

id spacetimedb >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --create-home --shell /usr/sbin/nologin spacetimedb
stdb() { sudo -u spacetimedb -H "$ROOT/spacetime" --root-dir="$ROOT" "$@"; }
[ -x "$ROOT/spacetime" ] || sudo -u spacetimedb -H sh -c "curl -sSf https://install.spacetimedb.com | sh -s -- --root-dir $ROOT --yes"
stdb version install "$VERSION" --use --yes
install -d -o spacetimedb -g spacetimedb "$ROOT/data"
install -m 644 -o spacetimedb -g spacetimedb "$HERE/config.toml" "$ROOT/data/config.toml"

install -d "$LIB"
install -m 755 "$HERE/prune-commitlog.sh" "$HERE/maintenance.sh" "$LIB/"
install -m 644 "$HERE/spacetimedb.service" "$HERE/spacetimedb-maintenance.service" "$HERE/spacetimedb-maintenance.timer" /etc/systemd/system/
sed "s/__DOMAIN__/$DOMAIN/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now spacetimedb spacetimedb-maintenance.timer
systemctl reload-or-restart caddy

for _ in $(seq 1 60); do curl -sf http://127.0.0.1:3000/v1/ping >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:3000/v1/ping >/dev/null || { echo "SpacetimeDB did not start: journalctl -u spacetimedb" >&2; exit 1; }
cat <<EOF
SpacetimeDB $VERSION is running; Caddy serves https://$DOMAIN (certificate issued on first request).

Next, from your machine:  deploy/selfhost/publish.sh <ssh-user>@$DOMAIN
Back up the token signing keys now; if they are lost, every player's saved login stops working:
  $ROOT/config/id_ecdsa  $ROOT/config/id_ecdsa.pub
EOF
