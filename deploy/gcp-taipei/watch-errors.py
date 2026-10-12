#!/usr/bin/env python3
"""One-shot optional host monitor. Run each minute; never forward raw Docker log lines."""
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request


def read_env(path):
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        parts = shlex.split(value, comments=True)
        values[key.strip()] = parts[0] if parts else ''
    return values


def counts(logs):
    result = {'panic': 0, 'error': 0}
    for line in logs.splitlines()[-2000:]:
        if re.search(r'\bpanic(?:ked)?\b', line, re.I):
            result['panic'] += 1
        elif re.search(r'\bERROR\b', line):
            result['error'] += 1
    return result


def post(url, payload, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, json.dumps(payload).encode(), headers, method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read(1024)


def main():
    config = read_env(Path(os.environ.get('TURFWAR_ERROR_ENV', '/etc/turfwar/errors.env')))
    webhook = config.get('WEBHOOK_URL', '')
    if not webhook:
        return  # Missing configuration is intentionally silent.
    if not webhook.startswith('https://'):
        raise ValueError('HTTPS required')
    state = Path(os.environ.get('TURFWAR_ERROR_STATE', '/var/lib/turfwar/error-watcher'))
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        end = int(time.time())
        # Per-destination cursors: a failed webhook does not duplicate a successful DB write.
        for target in ['webhook', 'database']:
            if target == 'database' and not config.get('ADMIN_TOKEN'):
                continue
            cursor = state / target
            start = int(cursor.read_text()) if cursor.exists() else end - 60
            # Docker --until is inclusive; use the preceding nanosecond for disjoint windows.
            logs = subprocess.run(['docker', 'logs', '--since', str(start), '--until', f'{end - 1}.999999999', '--tail', '2000', 'turfwar-stdb'], capture_output=True, text=True, check=True, timeout=15)
            summary = counts(logs.stdout + '\n' + logs.stderr)
            if any(summary.values()):
                if target == 'webhook':
                    text = f"Turf War Taipei: {summary['panic']} panic lines, {summary['error']} ERROR lines. Inspect VM logs. At most 2000 lines scanned."
                    # Discord uses content; Slack uses text. No raw log or secret is included.
                    post(webhook, {'content': text, 'text': text})
                else:
                    for kind, count in summary.items():
                        if count:
                            post('http://127.0.0.1:8080/v1/database/turfwar/call/record_server_error', [kind, count], config['ADMIN_TOKEN'])
            temporary = state / (target + '.tmp')
            temporary.write_text(str(end))
            temporary.replace(cursor)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not print request URLs, keys, response bodies or raw logs.
        print('Turf War error watcher failed; check local configuration and services.', file=sys.stderr)
        sys.exit(1)
