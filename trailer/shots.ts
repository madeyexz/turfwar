/**
 * Shot list: how each clip of the trailer is staged and captured (see scripts/capture.ts).
 * Every shot loads the game with `?capture&trailer&debuginput&quality=high&<url>` and drives it
 * through `window.__trailer` (src/game/trailer.ts). Frames are 1/30 s of game time.
 * Coordinates are each map's own (metres; the game's forward is -z at yaw 0).
 */
export interface Step {
  /** Expression evaluated in the page (window.__trailer is `T`). */
  js?: string;
  /** Advance this many frames (not recorded). */
  frames?: number;
  /** Real milliseconds to wait (assets arriving). */
  sleep?: number;
  /** Advance until this expression is true (at most `max` frames). */
  until?: string;
  max?: number;
  log?: string;
}
export interface Shot {
  id: string;
  /** Query string after the capture flags. */
  url: string;
  /** Frames to record. */
  frames: number;
  setup?: Step[];
  /** Steps run before recording frame `at`. */
  cues?: (Step & { at: number })[];
  /** Real ms to let on-demand assets load before setup (default 2500). */
  load?: number;
  seed?: number;
  /** The lobby rather than a match. */
  lobby?: boolean;
  /** Device scale for the screenshots (default 1.5); with `native` the clip keeps that size for punch-ins. */
  scale?: number;
  native?: boolean;
  page?: string;
}

const T = 'window.__trailer';
/** Wait until the round is live (after warm-up and freeze). */
const live: Step = { until: `${T}.state().phase==='live' && ${T}.state().roundPhase==='live'`, max: 900 };
const freeze: Step = { until: `${T}.state().phase==='live' && ${T}.state().roundPhase==='freeze'`, max: 900 };
const js = (s: string): Step => ({ js: s.replaceAll('T.', `${T}.`) });
const cue = (at: number, s: string) => ({ at, js: s.replaceAll('T.', `${T}.`) });
/** yaw that faces from (x0, z0) toward (x1, z1). */
const yaw = (x0: number, z0: number, x1: number, z1: number) => +Math.atan2(-(x1 - x0), -(z1 - z0)).toFixed(4);

/**
 * Taipei (compact Ximending, 162.5 × 133.5 m): the ring road runs on Civic Blvd (z ≈ -63), Zhongxiao W.
 * Rd (z ≈ 62), Huanhe Rd (x ≈ -77) and Zhonghua Rd (x ≈ 77); Wuchang St (night market, z ≈ -27),
 * Emei St (z ≈ 19), Xining S. Rd (x ≈ -22, Militia's barricade) and Hanzhong St (x ≈ 34, the gateway).
 * SWAT deploys on Civic Blvd's sidewalk (z ≈ -52). Taipei 101 stands 1.6 km east-southeast.
 */
const TAIPEI = 'mode=offline&map=taipei&size=squad';
const T101: [number, number, number] = [1536, 230, 426];
/** Taipei 101 · Xinyi (24v24): the tower stands at (-60, 6); the mall atrium (site A) at (-9, 10.5). */
const XINYI = 'mode=offline&map=xinyi&size=war';
/** Taipei 101 · 88F (6v6) and Memorial Hall 中正紀念堂 (6v6). */
const T101_88 = 'mode=offline&map=taipei101&size=squad';
const MEMORIAL = 'mode=offline&map=memorial&size=squad';
/** The free solo: Xinyi (24v24, its only size; the fight stays far below), relit at golden hour (the 88F map's light). */
const CLIMB = 'mode=offline&map=xinyi&size=war&game=elimination&team=0';
const GOLDEN = "T.light('highrise', {x:-0.84, y:0.3, z:-0.2})";

export const SHOTS: Shot[] = [
  // ---- Cold open ---------------------------------------------------------------------------
  {
    // Rising over Ximending's rooftops at dusk; Taipei 101 on the skyline.
    id: 'open_skyline', url: `${TAIPEI}&game=elimination`, frames: 170, load: 5000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:170, ease:false, keys:[
      {p:[-80,24,-70], t:[${T101}], fov:31}, {p:[-78,33,-66], t:[${T101}], fov:29}, {p:[-76,42,-62], t:[${T101}], fov:27}]})`)],
  },
  {
    // Hanzhong St under the Ximending gateway: Militia streams past the camera toward the arcade.
    id: 'open_gate', url: `${TAIPEI}&game=sabotage&team=0`, frames: 150, load: 4000,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.pinTeam(0)`),
      js(`[7,8,9,10,11,12].forEach((id,i)=>{T.place(id, 31.5+(i%3)*2.6, 0.15, 63+Math.floor(i/3)*3, 0); T.goal(id, 45.75, -1.75)})`), { frames: 2 }],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[35.2,1.0,60.5], t:[34,6,-20], fov:60}, {p:[34.8,1.3,57], t:[34,6.4,-20], fov:56}]})`)],
  },
  // ---- Round start and the store -----------------------------------------------------------
  {
    // Round 1 freezes: facing the SWAT squad behind its police cordon on Civic Blvd.
    id: 'freeze', url: `${TAIPEI}&game=elimination&team=0`, frames: 120, load: 3500,
    setup: [{ until: `${T}.state().phase==='live'`, max: 900 }, js(`T.teleport(-6,0.15,-46.8,0.18,-0.04)`)],
    cues: [cue(0, `T.turnTo(-0.12, -0.02, 0.8)`)],
  },
  {
    id: 'store', url: `${TAIPEI}&game=elimination&team=0`, frames: 270, load: 3500,
    setup: [freeze, js(`T.money(16000)`), { frames: 2 }, js(`T.store(true)`), { frames: 6 }],
    cues: [
      cue(4, `T.cursor('#store [data-key="m4a1"]', 18)`),
      cue(24, `T.click('#store [data-key="m4a1"]')`),
      cue(64, `T.cursor('#store [data-buy]', 14)`),
      cue(80, `T.click('#store [data-buy]')`),
      cue(104, `T.cursor('#store [data-tab="attachments"]', 14)`),
      cue(120, `T.click('#store [data-tab="attachments"]')`),
      cue(134, `T.cursor('#store [data-key="holo"]', 14)`),
      cue(150, `T.click('#store [data-key="holo"]')`),
      cue(190, `T.cursor('#store [data-buy]', 14)`),
      cue(206, `T.click('#store [data-buy]')`),
      cue(246, `T.cursor(null); T.store(false)`),
    ],
  },
  // ---- Gunplay (staged fights on the ring road; enemies fire back, the camera soldier is kept alive) ----
  {
    id: 'gun_mp5', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.stage([4,62,${yaw(4, 62, 40, 62)}], [[16,61],[19,63],[22,61.5]])`), { frames: 30 }],
    cues: [cue(0, `T.fight({ads:false})`), cue(40, `T.fight({ads:true})`)],
  },
  {
    id: 'gun_m4', url: `${TAIPEI}&game=elimination&team=0`, frames: 130,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m4a1', {optic:'holo'})`), { frames: 30 },
      js(`T.stage([-77,-46,${yaw(-77, -46, -77, 0)}], [[-79,-28],[-75,-24],[-77,-19]])`), { frames: 20 }],
    cues: [cue(0, `T.fight({ads:true, burst:[0.45,0.25]})`)],
  },
  {
    id: 'gun_m110', url: `${TAIPEI}&game=elimination&team=0`, frames: 150,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m110', {optic:'x6'})`), { frames: 40 },
      js(`T.stage([62,-63,${yaw(62, -63, 0, -63)}], [[14,-62.5],[6,-64],[-4,-62]], {pin:true})`), { frames: 20 }],
    cues: [cue(0, `T.fight({ads:true, head:true, burst:[0.1,0.7]})`)],
  },
  {
    id: 'gun_m1014', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m1014', {})`), { frames: 30 },
      js(`T.stage([-44,62,${yaw(-44, 62, 0, 62)}], [[-38.5,61],[-36.5,63],[-34.5,61.5]])`), { frames: 10 }],
    cues: [cue(0, `T.fight({ads:false, burst:[0.1,0.35]})`)],
  },
  {
    id: 'gun_m249', url: `${TAIPEI}&game=elimination&team=0`, frames: 130,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m249', {})`), { frames: 40 },
      js(`T.stage([64,62,${yaw(64, 62, 0, 62)}], [[48,60.5],[45,63],[42,61],[39,63]])`), { frames: 10 }],
    cues: [cue(0, `T.fight({ads:true, keys:['KeyC']})`)],
  },
  // ---- Sabotage ------------------------------------------------------------------------------
  {
    // Militia holds E on site B (the arcade) for 5 s: the bomb arms.
    id: 'bomb_arm', url: `${TAIPEI}&game=sabotage&team=1`, frames: 200,
    setup: [live, js(`T.god(); T.pinTeam(0); T.teleport(45.75,0.15,-1.75,${yaw(45.75, -1.75, 60, -1.75)},-0.35)`), { frames: 10 }],
    cues: [cue(0, `T.input({keys:['KeyE']})`)],
  },
  {
    // SWAT finds the bomb armed on site A (Cinema Street) and disarms it: round to SWAT.
    id: 'bomb_defuse', url: `${TAIPEI}&game=sabotage&team=0`, frames: 230,
    setup: [live, js(`T.god(); T.pinTeam(1); Object.assign(T.state().bomb,{site:0,armed:true,progress:0,by:-1}); T.state().phaseLeft=31`),
      js(`T.teleport(-46.2,0.15,-27.3,${yaw(-46.2, -27.3, -47.75, -25.75)},-0.45)`), { frames: 30 }],
    cues: [cue(0, `T.input({keys:['KeyE']})`)],
  },
  // ---- Elimination: a staged 3v3 on Crane, slowed down --------------------------------------
  {
    id: 'elim_crane', url: 'mode=offline&map=crane&size=squad&game=elimination&team=0', frames: 180,
    setup: [js(`T.hud('none')`), live, js(`T.teleport(40,0,34,0)`),
      js(`[2,3,4].forEach((id,i)=>T.place(id, -6+i*4, T.ground(-6+i*4, 12+i), 12+i, 0)); T.kill([5,6])`),
      js(`[7,8,9].forEach((id,i)=>T.place(id, -9+i*6, T.ground(-9+i*6, -6+i), -6+i, Math.PI)); T.kill([10,11,12])`),
      { frames: 2 }],
    cues: [cue(0, `T.timeScale = 0.45; T.camera({kind:'follow', target:{soldier:3}, offset:[0.9,1.75,3.2], look:[0,1.4,-12], fov:60, smooth:5})`)],
  },
  // ---- Mechanics ---------------------------------------------------------------------------
  {
    id: 'knife', url: `${TAIPEI}&game=elimination&team=0`, frames: 100,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies'); T.stage([77,-42,${yaw(77, -42, 77, 0)}], [[77,-40.6]], {pin:true})`), js(`T.press('Digit1')`), { frames: 15 }],
    cues: [cue(0, `T.fight({range:4})`)],
  },
  {
    id: 'grenade', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies'); T.grenades(1); T.stage([-40,62,${yaw(-40, 62, 0, 62)}], [[-7,61],[-5,63.2],[-4,60.6]], {pin:true})`), { frames: 10 }],
    cues: [cue(0, `T.look(${yaw(-40, 62, 0, 62)}, 0.02)`), cue(6, `T.press('KeyG')`),
      // The landing, from beside the targets.
      cue(50, `T.hud('none'); T.camera({kind:'fixed', p:[-15,2.2,64.5], t:[-4,1,61.5], fov:52})`)],
  },
  {
    // Binoculars from the roof at the top of the 18 m ladder, on Taipei 101.
    id: 'binos', url: `${TAIPEI}&game=elimination&team=0`, frames: 110,
    setup: [live, js(`T.god(); T.pacify('all'); T.hold(-40, 21, -52); T.tick(1); T.lookAt(1536, 330, 426)`), { frames: 10 }],
    cues: [cue(4, `T.press('KeyZ')`), cue(30, `T.turnTo(T.game.player.yaw - 0.04, T.game.player.pitch + 0.01, 0.6)`)],
  },
  {
    id: 'slide', url: `${TAIPEI}&game=elimination&team=0`, frames: 75,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(77,0.15,40,${yaw(77, 40, 77, 0)})`), { frames: 5 }],
    cues: [cue(0, `T.input({keys:['KeyW','ShiftLeft']})`), cue(28, `T.input({keys:['KeyW','ShiftLeft','KeyC']})`), cue(52, `T.input({keys:['KeyW']})`)],
  },
  {
    // Up the round brick tower's ladder on Tower to the crow's nest.
    id: 'ladder', url: 'mode=offline&map=tower&size=squad&game=elimination&team=0', frames: 170,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(18.5,0,3.15,0,0.75)`), { frames: 5 }],
    cues: [cue(0, `T.input({keys:['KeyW']})`), cue(120, `T.turnTo(-0.9, -0.1, 3)`)],
  },
  // ---- Vehicles ----------------------------------------------------------------------------
  {
    // A car south down Zhonghua Rd, drifting right onto Zhongxiao W. Rd.
    id: 'drift', url: `${TAIPEI}&game=elimination&team=0`, frames: 280,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(74.8,0.15,-6.8,0)`), { frames: 2 }, js(`T.enter(5)`), { frames: 10 }],
    cues: [cue(0, `T.drive([{x:77,z:20,speed:22},{x:77,z:44,speed:20},{x:66,z:62,speed:17,drift:true},{x:30,z:62,speed:22},{x:-60,z:62,speed:24}])`)],
  },
  {
    // Militia on a scooter east along Zhongxiao W. Rd, shooting one-handed at SWAT ahead.
    id: 'scooter', url: `${TAIPEI}&game=elimination&team=1`, frames: 270,
    setup: [live, js(`T.god(); T.pinTeam(1); T.pacify('enemies'); T.loadout('mp5',{},'mp7'); T.teleport(-20.8,0.2,51.4,0)`), { frames: 30 }, js(`T.enter(6)`), { frames: 10 },
      js(`T.placeVehicle(6,-40,0.2,62,${yaw(0, 0, 1, 0)})`),
      js(`T.stage([-40,62,0], [[0,56],[14,55.5],[28,56.5],[42,55]], {clear:'enemies'})`), js(`T.teleport(-40,0.2,62,0)`), { frames: 2 }],
    cues: [cue(0, `T.drive([{x:-30,z:62,speed:12},{x:75,z:62,speed:12}])`), cue(30, `T.fight({range:45})`)],
  },
  {
    // The helicopter lifts off its pad on the 7-TWELVE roof, seen from above the rooftops.
    id: 'heli_takeoff', url: `${TAIPEI}&game=elimination&team=0`, frames: 210,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.pacify('all'); T.teleport(14.3, 13.9, 7.3, 0)`), { frames: 2 }, js(`T.enter(14)`), { frames: 5 }],
    cues: [cue(0, `T.camera({kind:'track', p:[-12,44,-30], p2:[-20,48,-12], frames:210, target:{vehicle:14}, look:[0,1.2,0], fov:46})`),
      cue(0, `T.drive([{x:16.8,z:7.3,y:24},{x:-50,z:-45},{x:-60,z:40}], {alt:40, climb:10})`)],
  },
  {
    // Flying a loop over Ximending at 45 m (chase camera and the vehicle HUD).
    id: 'heli_flight', url: `${TAIPEI}&game=elimination&team=0`, frames: 300,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(14.3, 13.9, 7.3, 0)`), { frames: 2 }, js(`T.enter(14)`), { frames: 5 },
      js(`T.drive([{x:16.8,z:7.3,y:45},{x:10,z:-45},{x:-60,z:-45},{x:-65,z:40},{x:60,z:55},{x:60,z:-40}], {alt:45, climb:12, loop:true})`), { frames: 240 }],
  },
  // ---- Online: the lobby against a local, disposable server with headless clients in its rooms ----
  {
    id: 'lobby', url: 'mode=online&size=squad&name=Lawbreaker&map=taipei', frames: 210, lobby: true, load: 6000, scale: 2, native: true,
    setup: [{ until: `document.querySelectorAll('#rooms .room').length >= 3`, max: 600 }, { frames: 10 }],
    cues: [
      cue(0, `T.cursor('[data-size="duel"]', 20)`), cue(22, `T.click('[data-size="duel"]')`),
      cue(40, `T.cursor('[data-size="squad"]', 16)`), cue(58, `T.click('[data-size="squad"]')`),
      cue(76, `T.cursor('[data-size="war"]', 16)`), cue(94, `T.click('[data-size="war"]')`),
      cue(116, `T.cursor('#rooms .room:nth-child(1)', 22)`), cue(150, `T.cursor('#rooms .room:nth-child(3)', 22)`),
      cue(185, `T.cursor('#quick', 20)`),
    ],
  },
  // ---- Cold open for the new edit: a SWAT soldier free-solos Taipei 101 (src/game/trailer-climb.ts) ----
  // A tribute to Alex Honnold's 2025 free solo; trailer-only, at golden hour on the Xinyi map. The
  // climber is on the west face, 13 m in from the south-west corner, in the eighth segment (354–388 m).
  {
    // 1. Wide: the tower at golden hour, a tiny figure on the glass.
    id: 'climb_wide', url: CLIMB, frames: 90, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({y:366, rate:0.6})`), { frames: 10 }],
    // A slow zoom from the whole tower down to the speck on its glass.
    cues: [cue(0, `T.camera({kind:'path', frames:90, keys:[{p:[-430,330,150], t:[-60,250,6], fov:44}, {p:[-430,330,150], t:[-80,330,15], fov:12}, {p:[-430,330,150], t:[-84.5,368,19], fov:3.4}]})`)],
  },
  {
    // 2. Close: hands and boots on the green glass.
    id: 'climb_hands', url: CLIMB, frames: 60, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({y:364, rate:0.6})`), { frames: 20 }],
    cues: [cue(0, `(() => { const c = T.climber.chest(); return T.camera({kind:'track', p:[c.x-1.15,c.y+0.45,c.z-1.5], p2:[c.x-1.05,c.y+0.95,c.z-1.35], frames:60, target:{climber:'chest'}, look:[0.3,0.35,0.1], fov:40, smooth:4}); })()`)],
  },
  {
    // 3. Straight down past his boots to Xinyi Rd, 360 m below.
    id: 'climb_down', url: CLIMB, frames: 60, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({y:366, rate:0.6})`), { frames: 20 }],
    cues: [cue(0, `(() => { const c = T.climber.chest(); return T.camera({kind:'track', p:[c.x-0.75,c.y+1.5,c.z+0.25], p2:[c.x-0.75,c.y+1.9,c.z+0.25], frames:60, target:{climber:'feet'}, look:[-14,-364,0], fov:66, smooth:3}); })()`)],
  },
  {
    // 4. Orbit round him on the flare of a pagoda segment.
    id: 'climb_orbit', url: CLIMB, frames: 75, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({y:372, rate:0.6})`), { frames: 20 }],
    cues: [cue(0, `(() => { const c = T.climber.chest(); return T.camera({kind:'orbit', frames:75, center:[c.x,c.y,c.z], radius:3.8, height:0.5, from:2.4, to:3.9, lookUp:0.15, fov:42}); })()`)],
  },
  {
    // 5. Slow push-in along the glass from the side, at the segment's edge.
    id: 'climb_push', url: CLIMB, frames: 60, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({y:380, rate:0.6})`), { frames: 20 }],
    cues: [cue(0, `(() => { const c = T.climber.chest(); return T.camera({kind:'track', p:[c.x-2.4,c.y+0.8,c.z+8], p2:[c.x-1.5,c.y+1.0,c.z+2.4], frames:60, target:{climber:'chest'}, fov:40, smooth:5}); })()`)],
  },
  {
    // 6. Top-out: he stands at the edge of the terrace at 388 m; a helicopter rises up level with him,
    //    he turns round to the camera. Cut hard to the title.
    id: 'climb_top', url: CLIMB, frames: 90, load: 6000,
    setup: [js(`T.hud('none'); ${GOLDEN}`), js(`T.climb({mode:'stand', look:0})`), { frames: 10 }],
    cues: [
      cue(0, `T.camera({kind:'track', p:[-77.5,390.4,25], p2:[-78.5,390.2,24], frames:90, target:{climber:'chest'}, look:[-4,-0.4,-1.5], fov:48, smooth:6})`),
      cue(8, `T.heliPath([-98,368,16], [-98,387.6,16], 1.7, -1.5708)`),
      cue(52, `T.turnHead(3.8, 0.55)`),
    ],
  },
  // ---- Taipei 101 · 88F (taipei101): the office floor at 383 m; floor at y = 0, glass at ±25 ----
  {
    // From outside the west glass into the server room (A).
    id: 't101_push', url: `${T101_88}&game=sabotage&team=0`, frames: 120, load: 6000,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.teleport(0,0,-20,0)`), { frames: 2 }],
    cues: [cue(0, `T.camera({kind:'path', frames:120, keys:[{p:[-44,3.2,-7], t:[0,1.2,-6], fov:52}, {p:[-31,2.2,-6.5], t:[0,1.3,-6], fov:52}, {p:[-21.5,1.7,-6], t:[0,1.2,-7], fov:56}]})`)],
  },
  {
    // The tuned mass damper: a slow orbit round the gold sphere and its cables, inside the shaft.
    id: 't101_damper', url: `${T101_88}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [js(`T.hud('none')`), js(`T.teleport(0,0,-20,0)`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:120, center:[0,5.6,0], radius:9.4, height:-3.7, from:-0.5, to:0.75, lookUp:0.6, fov:62})`)],
  },
  {
    // From the 89F gallery down into the damper hall: SWAT and Militia trade shots round the pedestal.
    id: 't101_gallery', url: `${T101_88}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.teleport(0,0,-20,0); T.kill([4,5,6,10,11,12])`),
      js(`T.place(2,-5.5,0,5.5,0); T.place(3,-5,0,-5.5,0); T.place(7,5.5,0,5,0); T.place(8,5,0,-5.8,0)`), { frames: 8 }],
    cues: [cue(0, `T.camera({kind:'path', frames:120, keys:[{p:[-8.7,7.1,-2.5], t:[1,0,1], fov:62}, {p:[-8.7,7.3,1.5], t:[1,0,0], fov:58}]})`)],
  },
  {
    // A: the server room, M4A1 with a holographic sight among the racks' LEDs.
    id: 't101_server', url: `${T101_88}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m4a1', {optic:'holo'})`), { frames: 30 },
      js(`T.stage([-23.5,-1,${yaw(-23.5, -1, -15.5, -7.5)}], [[-16,-6.5],[-14.5,-9],[-17,-10]])`), { frames: 15 }],
    cues: [cue(0, `T.fight({ads:true, burst:[0.4,0.25]})`)],
  },
  {
    // B: Militia arms the bomb in the boardroom.
    id: 't101_arm', url: `${T101_88}&game=sabotage&team=1`, frames: 200, load: 6000,
    setup: [live, js(`T.god(); T.pinTeam(0); T.teleport(18.5,0,-2.2,${yaw(18.5, -2.2, 22, -6)},-0.32)`), { frames: 10 }],
    cues: [cue(0, `T.input({keys:['KeyE']})`)],
  },
  {
    // A kill by the window, the city 383 m below.
    id: 't101_window', url: `${T101_88}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies'); T.loadout('m4a1', {optic:'holo'})`), { frames: 40 },
      js(`T.stage([-20,15,${yaw(-20, 15, -16.5, 23.6)}], [[-16.5,23.6]], {pin:true})`), { frames: 15 }],
    cues: [cue(0, `T.look(${yaw(-20, 15, -16.5, 23.6)}, -0.05)`), cue(20, `T.fight({ads:true})`)],
  },
  // ---- Memorial Hall (memorial): the hall's floor at y ≈ 13.5, the Gallery Hall at 0 ----------
  {
    id: 'mem_aerial', url: `${MEMORIAL}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:120, center:[5,6,0], radius:96, height:52, from:3.55, to:3.95, lookUp:4, fov:44})`)],
  },
  {
    // Militia charges up the 89-step grand staircase toward the statue chamber (B).
    id: 'mem_stairs', url: `${MEMORIAL}&game=sabotage&team=0`, frames: 150, load: 6000,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.teleport(52,0,20,0); T.pinTeam(0); T.pacify('all')`),
      js(`[7,8,9,10,11,12].forEach((id,i)=>{T.place(id, -50 - Math.floor(i/3)*3, 0, -3 + (i%3)*3, -1.5708); T.goal(id, 5, 0)})`), { frames: 2 }],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-23,13.5,4], t:[-46,2,0], fov:46}, {p:[-24.5,12.8,2.5], t:[-42,4,0], fov:42}]})`)],
  },
  {
    // A SWAT defender holds the statue chamber's door.
    id: 'mem_chamber', url: `${MEMORIAL}&game=sabotage&team=0`, frames: 120, load: 6000,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.teleport(52,0,20,0); T.kill([3,4,5,6,9,10,11,12])`),
      js(`T.place(2, 1, 13.5, 3, 1.5708, true); T.place(7, -16, 13.5, -1, -1.5708); T.place(8, -18, 13.5, 2, -1.5708); T.goal(7, 5, 0); T.goal(8, 5, 0)`), { frames: 2 }],
    cues: [cue(0, `T.camera({kind:'path', frames:120, keys:[{p:[4.5,14.7,5.5], t:[-8,14.6,0], fov:50}, {p:[4,14.9,4.5], t:[-9,14.6,0], fov:46}]})`)],
  },
  {
    // A: a fight among the museum cases of the Gallery Hall under the chamber.
    id: 'mem_gallery', url: `${MEMORIAL}&game=elimination&team=0`, frames: 120, load: 6000,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('mp5', {optic:'reflex'})`), { frames: 30 },
      js(`T.stage([-8,0,${yaw(-8, 0, 4, 0)}], [[3,0],[5,2.5],[4,-3]])`), { frames: 15 }],
    cues: [cue(0, `T.fight({ads:true})`)],
  },
  // ---- Sizes and vehicle collision ----------------------------------------------------------
  {
    // 1v1: one soldier each, on Crane.
    id: 'duel', url: 'mode=offline&map=crane&size=duel&game=elimination&team=0', frames: 120,
    setup: [live, js(`T.god(); T.loadout('m4a1', {optic:'reflex'})`), { frames: 30 }, js(`T.stage([-2,13,${yaw(-2, 13, -4, -5)}], [[-4,-5]])`), { frames: 10 }],
    cues: [cue(0, `T.fight({ads:true, burst:[0.35,0.3]})`)],
  },
  {
    // A car ploughs through the row of parked scooters on Zhongxiao W. Rd's kerb lane.
    id: 'car_shove', url: `${TAIPEI}&game=elimination&team=0`, frames: 150,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.pacify('all'); T.teleport(-1.8,0.15,59,0)`), { frames: 2 }, js(`T.enter(3)`), { frames: 10 },
      js(`T.placeVehicle(3, -4, 0, 61.6, ${yaw(0, 0, -1, 0)})`), { frames: 2 }],
    cues: [cue(0, `T.drive([{x:-80,z:61.8,speed:19}])`),
      cue(0, `T.camera({kind:'track', p:[-37,2.3,65.6], p2:[-41,2.4,65.6], frames:150, target:{vehicle:3}, look:[0,0.6,0], fov:46, smooth:6})`)],
  },
  {
    // Up the boot of a parked car onto its roof, then shooting from the high ground.
    id: 'roof_jump', url: `${TAIPEI}&game=elimination&team=0`, frames: 150,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies')`), js(`T.stage([-53,61.8,-1.5708], [[-20,60],[-17,63],[-14,61]], {pin:true})`), { frames: 5 }],
    cues: [
      cue(0, `T.input({keys:['KeyW']})`), cue(9, `T.input({keys:['KeyW','Space']})`), cue(12, `T.input({keys:['KeyW']})`),
      cue(24, `T.input({keys:['KeyW','Space']})`), cue(27, `T.input({keys:['KeyW']})`), cue(32, `T.input({keys:[]})`),
      cue(0, `T.hud('none'); T.camera({kind:'track', p:[-48.5,1.4,56.2], frames:40, target:{soldier:T.me().id}, look:[0,1.1,0], fov:50, smooth:8})`),
      cue(40, `T.camera(null); T.hud('full'); T.pacify('none'); T.fight({ads:true})`),
    ],
  },
  {
    // The new lobby: filters (size, mode, a map from the picker), PLAY ONLINE, the live room list.
    id: 'lobby2', url: 'mode=online&size=squad&name=Lawbreaker', frames: 240, lobby: true, load: 6000, scale: 2, native: true,
    setup: [{ until: `document.querySelectorAll('#rooms .room').length >= 1`, max: 600 }, { frames: 10 }],
    cues: [
      cue(0, `T.cursor('[data-size="squad"]', 18)`), cue(20, `T.click('[data-size="squad"]')`),
      cue(34, `T.cursor('[data-gamemode="sabotage"]', 16)`), cue(52, `T.click('[data-gamemode="sabotage"]')`),
      cue(66, `T.cursor('#map-trigger', 16)`), cue(84, `T.click('#map-trigger')`),
      cue(100, `T.cursor('#map-grid [data-pick="taipei101"]', 20)`), cue(124, `T.click('#map-grid [data-pick="taipei101"]')`),
      cue(150, `T.cursor('#play', 22)`),
      cue(196, `T.cursor('#rooms .room', 22)`),
    ],
  },
  // ---- Maps --------------------------------------------------------------------------------
  {
    id: 'map_101', url: `${XINYI}&game=elimination`, frames: 150, load: 6000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-40,40,-270], t:[-60,150,6], fov:50}, {p:[-72,62,-245], t:[-60,235,6], fov:50}]})`)],
  },
  {
    id: 'map_atrium', url: `${XINYI}&game=elimination`, frames: 150, load: 6000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-9,2.4,-9], t:[-9,-3,22], fov:62}, {p:[-8,3.2,0], t:[-9,-3.5,24], fov:60}]})`)],
  },
  {
    id: 'map_market', url: `${TAIPEI}&game=elimination`, frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[29.5,2.2,-27.4], t:[-40,3.2,-27], fov:58}, {p:[26.5,2.5,-27.3], t:[-40,3.4,-27], fov:54}]})`)],
  },
  {
    id: 'map_cinema', url: `${TAIPEI}&game=elimination`, frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-72.5,2,-27], t:[-30,6,-27], fov:54}, {p:[-69.5,2.6,-26.8], t:[-30,6.5,-27], fov:44}]})`)],
  },
  {
    id: 'map_crane', url: 'mode=offline&map=crane&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[0,0,0], radius:55, height:24, from:2.2, to:2.9, lookUp:-2, fov:55})`)],
  },
  {
    id: 'map_tower', url: 'mode=offline&map=tower&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[12.5,0,-2.5], radius:34, height:12, from:-2.4, to:-1.7, lookUp:7, fov:55})`)],
  },
  {
    id: 'map_railyard', url: 'mode=offline&map=railyard&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[0,0,0], radius:70, height:30, from:2.2, to:2.85, lookUp:-2, fov:55})`)],
  },
  {
    id: 'map_skyline', url: 'mode=offline&map=skyline&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[0,34,0], radius:70, height:28, from:-2.4, to:-1.75, lookUp:-4, fov:55})`)],
  },
  {
    id: 'map_warehouse', url: 'mode=offline&map=warehouse&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-25,5,-14], t:[8,1.5,4], fov:60}, {p:[-12,5.5,-14.5], t:[12,1.5,6], fov:58}]})`)],
  },
  {
    // 24v24 on Meridian District: the square fifteen seconds into the round.
    id: 'map_meridian', url: 'mode=offline&map=meridian&size=war&game=elimination&team=0', frames: 180, load: 4000,
    setup: [js(`T.hud('none')`), live, js(`T.teleport(-190,T.ground(-190,-30,10),-30,0)`), { frames: 540 }],
    cues: [cue(0, `T.camera({kind:'orbit', frames:180, center:[0,0,0], radius:50, height:40, from:4.0, to:3.55, fov:52})`)],
  },
];
