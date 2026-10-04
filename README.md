# Lawbreaker

A browser first-person physics playground inspired by Alan Lightman’s *Einstein’s Dreams*. Shoot orbiting drones, then rewrite a law of nature with a sentence. Built with Vite, TypeScript, Three.js, Rapier, Zod, and SpacetimeDB. No game assets or LLM-generated code are downloaded or executed.

## Play

Use a desktop browser with WebGL2, keyboard, and mouse. Click **Enter the arena** to capture the pointer.

| Control | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Left click / Space | Shoot / jump |
| `/` | Open the sentence editor |
| 1 / 2 / 3 / 4 | Inverse-cube gravity / motion-driven time / slow light / rewind |
| Esc | Release the pointer or close the editor |
| R | Reset the selected world, targets, score, and history |

Hit each orange drone for 100 points. Use **Uniform gravity** to compare projectile arcs with central attraction. The three world cards reset everything to **Newton’s garden** (inverse square), **A moment, forever** (motion-driven time), or **Chasing the light** (c = 10 m/s). Laws can be combined after choosing a world. Your hover boots keep player movement independent of world gravity and world time.

## The four laws

- **Gravity:** Uniform acceleration or a central point-mass force proportional to `1/r^n`. Rapier gravity is zero; every dynamic body receives a mass-scaled force each step. The exponent is clamped to 0–3, strength to −200–200. Direction is normalized. Forces are softened inside a 1.5 m core. Drones start with inverse-square orbital velocities; switching to inverse cube keeps those velocities and makes them escape. Inverse-cube trajectories are not necessarily inward spirals.
- **Time:** A fixed 120 Hz wall-clock tick, independent of rendering, advances the world by `1/120 × scale × motion`. Motion is actual player translation speed / 6 m/s, capped at 1. Zero motion means exactly zero world integration. Looking or shooting does not advance time. Scale is clamped to 0.05–3.
- **Light:** Speed of light is clamped to 10–1000 m/s (default 300). A screen-space shader approximates directional Doppler color shift, searchlight brightness, and aberration using camera-relative player velocity. Velocity/c is capped at 0.85. This is not spectral rendering, time dilation, finite light-travel time, Lorentz geometry, or Terrell rotation. HUD elements are unaffected. “Walking speed” is an artistic preset: player speed is 6 m/s, c is 10 m/s.
- **Rewind:** A bounded 1,201-frame ring stores 10 seconds of simulation ticks, including body existence, position, velocity, age, and score. Playback runs backward at 120 Hz while the player retains movement and look control. Shooting is disabled during playback. Current laws are retained, not rewound. The discarded future is replaced on resume. Less history means a shorter rewind. Contact-solver caches are not restored; post-rewind collision trajectories need not be bit-identical.

The planet is a visual marker for the softened force field, not a solid collider for world bodies. Trails show recent paths, not analytically predicted orbits. The blue rings are decorative guides. The circular deck collides with drones and debris; projectiles use sensor colliders and hit-distance checks. Offline means no backend or AI connection is needed once the app has loaded; this is not an installable cached PWA. Fonts fall back to system fonts without network access.

## Run and test

Node 22.12+ is recommended.

```sh
npm ci
npm run dev
npm test
npm run build
```

The Vite development server includes the `/api/law` route. Export `OPENAI_API_KEY` in the server environment to enable arbitrary sentence translation. For example, load a local `.env` with your shell before starting Vite; never commit it. Vercel serves `api/law.ts` as a serverless route.

Without a key, buttons and keys 1–4 work immediately. The exact four example sentences also work through a labeled **OFFLINE PRESET** fallback. Unknown sentences show an error and leave the laws unchanged. With a key, the server calls OpenAI structured JSON, rejects malformed output, then validates and clamps it with the same Zod contract used by the browser and SpacetimeDB. API timeouts never block preset buttons. Do not put the key in a `VITE_` variable.

Tests include a mildly elliptical orbit checked against the analytic Kepler period, inverse-cube escape, projectile curvature/scoring, frozen and half-speed time, rewind through buffer wrap/body deletion, schema rejection/clamping, camera-relative light parameters, and mocked API failures/timeouts. The M-series MacBook 60 FPS target requires measurement on that hardware; a CPU-rendered Linux browser is not an equivalent benchmark. Pixel ratio is capped at 1.5 and active projectiles at 48. The Rapier compatibility package includes WASM and causes Vite's large-chunk warning.

## SpacetimeDB backend

The module stores private per-identity session counts, current law parameters, the latest 64 commands, and self-reported scores. Reducers derive ownership from `ctx.sender`; callers cannot choose another identity. These scores are telemetry, **not an authoritative multiplayer leaderboard**. No physics or competitive authority runs on the server. Stored data is not automatically restored into a new game.

Install the [SpacetimeDB CLI](https://spacetimedb.com/install), then:

```sh
npm --prefix spacetimedb ci
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

Import this repository into Vercel as a Vite project, or run `npx vercel --prod` after login. `vercel.json` configures the app and server route. Configure optional server-only `OPENAI_API_KEY`, `OPENAI_MODEL`, and the two public SpacetimeDB variables. Before enabling the anonymous AI endpoint publicly, configure Vercel Firewall rate limits and an OpenAI project spend limit. The project does not pretend that an in-memory serverless counter is a durable rate limit.

## 60-second demo — one continuous shot

1. **0–7 s:** Show the title, select Newton’s garden, enter. Say: “A universe with familiar rules.”
2. **7–15 s:** Fire at a drone. Observe normal inverse-square gravity and stable orange trails. Optional: Esc → Uniform gravity → resume → fire to show a falling projectile; press R immediately afterward to restore stable orbits.
3. **15–27 s:** Press `/`. Type **gravity falls off with the cube of distance**. Press Enter. Say: “Change one exponent, and the orbit breaks.” The fallback label is visible if no AI key is configured.
4. **27–36 s:** Watch the drones curve outward and escape. Keep the camera still so the trajectory change is clear.
5. **36–43 s:** Press `4`. Watch the last five seconds play backward; move sideways while the world rewinds.
6. **43–51 s:** Press R, then `2`. Stand still, then move. Say: “Time is waiting for me.”
7. **51–60 s:** Esc → Chasing the light → resume. Move forward and backward to show blue/red shifts. Finish: “The rules are yours to rewrite.”

## References

[Einstein’s Dreams](https://en.wikipedia.org/wiki/Einstein%27s_Dreams) · [Bertrand’s theorem](https://en.wikipedia.org/wiki/Bertrand%27s_theorem) · [MIT: A Slower Speed of Light](https://gamelab.mit.edu/games/a-slower-speed-of-light/) · [OpenRelativity](https://github.com/MITGameLab/OpenRelativity) · [Rapier](https://rapier.rs/) · [SpacetimeDB](https://spacetimedb.com/docs/)
