#!/bin/bash
# Provision the Taipei game server: a GCP e2-small in asia-east1 (Changhua, Taiwan) on Debian 12.
# It runs the same SpacetimeDB container as deploy/instacloud (start.sh supervises the server and
# prunes the commitlog), behind Caddy, which terminates HTTPS (Let's Encrypt) and proxies HTTP and
# WebSockets to it. Run as root from a folder holding this script, Caddyfile.tmpl and the files
# deploy/instacloud's Dockerfile copies (config.toml, prune-commitlog.sh, start.sh):
#
#   HOSTS="34-81-41-144.sslip.io tw.turfwar.ianhsiao.me" bash setup.sh
#
# Safe to re-run: it only installs what is missing, rebuilds the image and rewrites the Caddyfile.
# It never touches the data in /var/lib/turfwar or the running container.
set -euo pipefail
HOSTS="${HOSTS:?space-separated hostnames Caddy serves}"

# 2 GB of swap under the machine's 2 GB of RAM: a cushion for spikes, not a working set.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io caddy netcat-openbsd >/dev/null
systemctl enable --now docker >/dev/null

docker build -q -t turfwar-stdb . >/dev/null
mkdir -p /var/lib/turfwar

# One site block for every hostname; Caddy fetches a certificate for each once its DNS points here.
sed "s|@HOSTS@|$(echo "$HOSTS" | sed 's/ /, /g')|" Caddyfile.tmpl > /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "ready: image turfwar-stdb, Caddy for: $HOSTS"
