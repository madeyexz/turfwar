# Lawbreaker

A browser first-person sci-fi combat playground inspired by Alan Lightman’s *Einstein’s Dreams*, with an original PlanetSide-inspired military-outpost style. Fight drone patrols and capture a gravity reactor, then rewrite a law of nature with a sentence. Built with Vite, TypeScript, Three.js, Rapier, Zod, and SpacetimeDB. All map geometry and weapon models are procedural; no PlanetSide assets are used. This is a solo prototype, not an MMO.

## Play

Use a desktop browser with WebGL2, keyboard, and mouse. Select a map and click **Deploy to battlefield** to capture the pointer.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Hold left click / Space | Automatic fire / jump |
| Right mouse / Shift | Aim down sights / sprint forward |
| C or left Ctrl | Hold to crouch |
| R | Reload the 30-round magazine (unlimited reserve) |
| `/` | Open the sentence editor |
| 1 / 2 / 3 / 4 | Inverse-cube gravity / motion-driven time / slow light / rewind |
| Esc | Release the pointer or close the editor |
| M | Open deployment map selection |

Hit each red drone for 100 XP. Drones fire back; solid base structures block projectiles. Shields absorb damage before health and regenerate after four seconds without a hit. Death offers redeployment. Clear or displace all drones within 18 m of the reactor, then stay within 12 m for eight world-seconds to capture it. Rewriting gravity can clear the objective without shooting every drone.

Three maps have different terrain, cover, base layouts, and starting laws: **Cinder Basin** (desert, inverse-square gravity), **Frostline Reach** (snow, motion-driven time), and **Verdant Divide** (forest, c = 10 m/s). Selecting a map or **Redeploy** resets bodies, score, health, ammunition, and history. Use **Uniform gravity** to compare projectile arcs with central attraction. Laws can be combined after deployment. Player movement and reload/shield timers are independent of world time; world gravity does not affect the player. Rifle recoil, walk bob, sprint lowering, reload tilt, muzzle flashes, and hit bursts are procedural animations. Sound can be muted in the header.

## The four laws

- **Gravity:** Uniform acceleration or a central point-mass force proportional to `1/r^n`. Rapier gravity is zero; every dynamic body receives a mass-scaled force each step. The exponent is clamped to 0–3, strength to −200–200. Direction is normalized. Forces are softened inside a 1.5 m core. Drones start with inverse-square orbital velocities; switching to inverse cube keeps those velocities and makes them escape. Inverse-cube trajectories are not necessarily inward spirals.
- **Time:** A fixed 120 Hz wall-clock tick, independent of rendering, advances the world by `1/120 × scale × motion`. Motion is actual player translation speed / 6 m/s, capped at 1. Zero motion means exactly zero world integration. Looking or shooting does not advance time. Scale is clamped to 0.05–3.
- **Light:** Speed of light is clamped to 10–1000 m/s (default 300). A screen-space shader approximates directional Doppler color shift, searchlight brightness, and aberration using camera-relative player velocity. Velocity/c is capped at 0.85. This is not spectral rendering, time dilation, finite light-travel time, Lorentz geometry, or Terrell rotation. HUD elements are unaffected. “Walking speed” is an artistic preset: player speed is 6 m/s, c is 10 m/s.
- **Rewind:** A bounded 1,201-frame ring stores 10 seconds of simulation ticks, including body existence, position, velocity, age, and score. Playback runs backward at 120 Hz while the player retains movement and look control. Shooting is disabled during playback. Current laws are retained, not rewound. The discarded future is replaced on resume. Less history means a shorter rewind. Contact-solver caches are not restored; post-rewind collision trajectories need not be bit-identical.

The reactor is a visual marker for the softened force field, not a solid collider. Trails show recent paths, not analytically predicted orbits. Terrain and base blocks have Rapier colliders; player movement uses swept axis-separated collision against those same base definitions. Building doors are closed facades, and roofs, antennas, the overhead bridge, distant rocks, and trees are decorative. Playable boundaries are ±78 m. Projectiles use swept hit checks; combat is deliberately forgiving rather than competitive hitscan. Rewind also restores objective progress and enemy firing timers, but not player health or ammunition. Offline means no backend or AI connection is needed once the app has loaded; this is not an installable cached PWA. The interface uses system fonts.

## Run and test

Bun 1.3.10 is the project package manager. Node 22.12+ is recommended for the Vite and Vercel toolchain.

```sh
bun install --frozen-lockfile
bun run dev
bun run test
bun run build
```

Use `bun run test` to run Vitest; `bun test` invokes Bun’s separate test runner.

The Vite development server includes the `/api/law` route. Export `OPENAI_API_KEY` in the server environment to enable arbitrary sentence translation. For example, load a local `.env` with your shell before starting Vite; never commit it. Vercel serves `api/law.ts` as a serverless route.

Without a key, buttons and keys 1–4 work immediately. The exact four example sentences also work through a labeled **OFFLINE PRESET** fallback. Unknown sentences show an error and leave the laws unchanged. With a key, the server calls OpenAI structured JSON, rejects malformed output, then validates and clamps it with the same Zod contract used by the browser and SpacetimeDB. API timeouts never block preset buttons. Do not put the key in a `VITE_` variable.

Tests include a mildly elliptical orbit checked against the analytic Kepler period, inverse-cube escape, projectile curvature/scoring, frozen and half-speed time, rewind through buffer wrap/body deletion, schema rejection/clamping, camera-relative light parameters, mocked API failures/timeouts, movement speeds, collision/landing, reload timing, shields, enemy fire, and objective capture/rewind. The M-series MacBook 60 FPS target requires measurement on that hardware; a CPU-rendered Linux browser is not an equivalent benchmark. Pixel ratio is capped at 1.5, player projectiles at 48, and enemy projectiles at 24. The Rapier compatibility package includes WASM and causes Vite's large-chunk warning.

## SpacetimeDB backend

The module stores private per-identity session counts, current law parameters, the latest 64 commands, and self-reported scores. Reducers derive ownership from `ctx.sender`; callers cannot choose another identity. These scores are telemetry, **not an authoritative multiplayer leaderboard**. No physics or competitive authority runs on the server. Stored data is not automatically restored into a new game.

Install the [SpacetimeDB CLI](https://spacetimedb.com/install), then:

```sh
bun install --cwd spacetimedb --frozen-lockfile
spacetime start                           # separate terminal
spacetime publish lawbreaker-local --module-path spacetimedb --server local
spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb
```

Set these public client values and restart Vite:

```sh
VITE_SPACETIMEDB_URI=ws://localhost:3000
VITE_SPACETIMEDB_DATABASE=lawbreaker-local
```

For cloud persistence, log in with `spacetime login`, publish a uniquely named database to Maincloud, and configure its `wss://` URI and database name in Vercel **before building**. Missing configuration displays **LOCAL SESSION** and the game remains playable. Identity tokens are stored only in localStorage. Module build: `spacetime build --module-path spacetimedb`. Generated bindings use SDK 2.6.0; verified locally with CLI 2.10.2.

## Deploy

Import this repository into Vercel as a Vite project, or run `bunx vercel --prod` after login. `vercel.json` configures Bun installation, the build, and the server route. Configure optional server-only `OPENAI_API_KEY`, `OPENAI_MODEL`, and the two public SpacetimeDB variables. Before enabling the anonymous AI endpoint publicly, configure Vercel Firewall rate limits and an OpenAI project spend limit. The project does not pretend that an in-memory serverless counter is a durable rate limit.

## 60-second demo — one continuous shot

1. **0–7 s:** Show the deployment screen, select Cinder Basin, deploy. Say: “A battlefield with familiar rules.”
2. **7–15 s:** Sprint toward the reactor, aim, and fire at a drone. Observe normal inverse-square gravity and stable orange trails. Optional: Esc → Uniform gravity → resume → fire to show a falling projectile; Esc → Redeploy afterward to restore stable orbits.
3. **15–27 s:** Press `/`. Type **gravity falls off with the cube of distance**. Press Enter. Say: “Change one exponent, and the orbit breaks.” The fallback label is visible if no AI key is configured.
4. **27–36 s:** Watch the drones curve outward and escape. Keep the camera still so the trajectory change is clear.
5. **36–43 s:** Press `4`. Watch the last five seconds play backward; move sideways while the world rewinds.
6. **43–51 s:** Press M, choose Frostline Reach, resume. Stand still, then move. Say: “Time is waiting for me.”
7. **51–60 s:** Press M, choose Verdant Divide, resume. Move forward and backward to show blue/red shifts. Finish: “The rules are yours to rewrite.”

## References

[Einstein’s Dreams](https://en.wikipedia.org/wiki/Einstein%27s_Dreams) · [Bertrand’s theorem](https://en.wikipedia.org/wiki/Bertrand%27s_theorem) · [MIT: A Slower Speed of Light](https://gamelab.mit.edu/games/a-slower-speed-of-light/) · [OpenRelativity](https://github.com/MITGameLab/OpenRelativity) · [Rapier](https://rapier.rs/) · [SpacetimeDB](https://spacetimedb.com/docs/)
