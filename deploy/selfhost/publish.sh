#!/usr/bin/env bash
# Publish the module to the self-hosted server through an SSH tunnel (the server only exposes the
# game client's routes publicly). Non-destructive: refuses schema changes that would delete data,
# and leaves the CLI's prompts (e.g. "this will BREAK existing clients") for you to answer.
# The first publish creates the database and makes your CLI identity its owner.
#
#   deploy/selfhost/publish.sh ubuntu@play.example.com [database=lawbreaker]
set -euo pipefail
HOST="${1:?usage: publish.sh <ssh-host> [database]}"
DATABASE="${2:-lawbreaker}"
PORT="${PORT:-13000}"
cd "$(dirname "$0")/../.."

sock="$(mktemp -u "${TMPDIR:-/tmp}/lawbreaker-ssh.XXXXXX")"
ssh -M -S "$sock" -fNT -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:3000" "$HOST"
trap 'ssh -S "$sock" -O exit "$HOST" 2>/dev/null' EXIT

spacetime publish "$DATABASE" --module-path spacetimedb --server "http://127.0.0.1:$PORT" --delete-data=never
