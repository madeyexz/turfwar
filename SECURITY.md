# Security Policy

## Supported versions

Only the live game at [turfwar.ianhsiao.me](https://turfwar.ianhsiao.me) and the `main` branch are
supported. Fixes land on `dev` and ship with the next release.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email **ian@rippling.computer** with:

- what you found and where (file, endpoint or game feature);
- steps to reproduce, or a proof of concept that does not touch other players' data;
- the impact you expect.

You will get an acknowledgement within a few days and a note when it is fixed. Credit in the release
notes is offered unless you prefer to stay anonymous.

## In scope

- The game server module (`spacetimedb/`): anything that lets a client break the server's authority —
  damage, cash, purchases, rounds, the bomb, movement validation — or reach another player's data.
- The admin dashboard (`/admin`) and its key check.
- The web client, when it can be abused against other players (for example script injection through
  callsigns or chat).

## Out of scope

- Denial of service and load testing against the live server.
- Cheats that only change what your own client shows (the server stays authoritative).
- Findings in third-party services the game relies on; report those to their vendors.
