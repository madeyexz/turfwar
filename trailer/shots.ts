/**
 * Shot list: how each clip of the trailer is staged and captured (see scripts/capture.ts).
 * Every shot loads the game with `?capture&trailer&debuginput&quality=high&<url>` and drives it
 * through `window.__trailer` (src/game/trailer.ts). Frames are 1/30 s of game time.
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
  page?: string;
}

const T = 'window.__trailer';
/** Wait until the round is live (after warm-up and freeze). */
const live: Step = { until: `${T}.state().phase==='live' && ${T}.state().roundPhase==='live'`, max: 900 };
const freeze: Step = { until: `${T}.state().phase==='live' && ${T}.state().roundPhase==='freeze'`, max: 900 };
const js = (s: string): Step => ({ js: s.replaceAll('T.', `${T}.`) });
const cue = (at: number, s: string) => ({ at, js: s.replaceAll('T.', `${T}.`) });

/** Taipei 101 in the Taipei (Ximending) map's coordinates (1.6 km east-southeast). */
const T101: [number, number, number] = [1526, 230, 383];

const TAIPEI = 'mode=offline&map=taipei&size=squad';
/** yaw that faces from (x0, z0) toward (x1, z1) (the game's forward is -z at yaw 0). */
const yaw = (x0: number, z0: number, x1: number, z1: number) => +Math.atan2(-(x1 - x0), -(z1 - z0)).toFixed(4);

export const SHOTS: Shot[] = [
  // ---- Cold open ---------------------------------------------------------------------------
  {
    id: 'open_skyline', url: `${TAIPEI}&game=elimination`, frames: 170, load: 5000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:170, ease:false, keys:[
      {p:[-96,30,-74], t:[${T101}], fov:30}, {p:[-94,37,-50], t:[${T101}], fov:29}, {p:[-92,44,-26], t:[${T101}], fov:28}]})`)],
  },
  {
    // Hanzhong St under the Ximending gateway; Militia streams past the camera toward the arcade.
    id: 'open_gate', url: `${TAIPEI}&game=sabotage&team=0`, frames: 150, load: 4000,
    setup: [js(`T.hud('none')`), live, js(`T.god()`),
      js(`[7,8,9,10,11,12].forEach((id,i)=>{T.place(id, 21.5+(i%3)*3, 0.15, 24+Math.floor(i/3)*5, Math.PI); T.goal(id, 30, -45)})`), { frames: 2 }],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[25.8,1.0,19], t:[24.5,6,-40], fov:60}, {p:[25,1.4,9], t:[24.5,6.5,-40], fov:56}]})`)],
  },
  // ---- Round start and the store -----------------------------------------------------------
  {
    // The SWAT squad lined up in its base under the expressway as round 1 freezes.
    id: 'freeze', url: `${TAIPEI}&game=elimination&team=0`, frames: 120, load: 3500,
    setup: [js(`T.hud('clean')`), { until: `${T}.state().phase==='live'`, max: 900 }, js(`T.teleport(-30,0.15,-112,0)`)],
    cues: [cue(0, `T.camera({kind:'path', frames:120, keys:[{p:[-14,1.2,-97], t:[-6,1.3,-106], fov:55}, {p:[22,1.5,-99], t:[14,1.3,-106], fov:50}]})`)],
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
  // ---- Gunplay -----------------------------------------------------------------------------
  {
    id: 'gun_mp5', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.stage([76,-30,${yaw(76, -30, 76, 0)}], [[73,-14],[79,-10],[75,-6]])`), { frames: 30 }],
    cues: [cue(0, `T.fight({ads:false})`), cue(40, `T.fight({ads:true})`)],
  },
  {
    id: 'gun_m4', url: `${TAIPEI}&game=elimination&team=0`, frames: 130,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m4a1', {optic:'holo'})`), { frames: 30 },
      js(`T.stage([14,-24,${yaw(14, -24, -20, -24)}], [[0,-26],[-5,-21.5],[-10,-25]])`), { frames: 20 }],
    cues: [cue(0, `T.fight({ads:true, burst:[0.45,0.25]})`)],
  },
  {
    id: 'gun_m110', url: `${TAIPEI}&game=elimination&team=0`, frames: 150,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m110', {optic:'x6'})`), { frames: 40 },
      js(`T.stage([60,17,${yaw(60, 17, 0, 17)}], [[12,16],[2,19],[-8,15]], {pin:true})`), { frames: 20 }],
    cues: [cue(0, `T.fight({ads:true, head:true, burst:[0.1,0.7]})`)],
  },
  {
    id: 'gun_m1014', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m1014', {})`), { frames: 30 },
      js(`T.stage([76,-36,${yaw(76, -36, 76, 0)}], [[74,-28],[78,-26],[76,-24]])`), { frames: 10 }],
    cues: [cue(0, `T.fight({ads:false, burst:[0.1,0.35]})`)],
  },
  {
    id: 'gun_m249', url: `${TAIPEI}&game=elimination&team=0`, frames: 130,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('m249', {})`), { frames: 40 },
      js(`T.stage([-70,17,${yaw(-70, 17, -40, 17)}], [[-56,15],[-54,20],[-52,13],[-50,19]])`), { frames: 10 }],
    cues: [cue(0, `T.fight({ads:true, keys:['KeyC']})`)],
  },
  // ---- Sabotage ------------------------------------------------------------------------------
  {
    // Militia holds E on site B (the arcade) for 5 s: the bomb arms.
    id: 'bomb_arm', url: `${TAIPEI}&game=sabotage&team=1`, frames: 200,
    setup: [live, js(`T.god(); T.pinTeam(0); T.teleport(35,0.15,-41.5,${yaw(35, -41.5, 35, -60)},-0.35)`), { frames: 10 }],
    cues: [cue(0, `T.input({keys:['KeyE']})`)],
  },
  {
    // SWAT finds the bomb armed on site A (Cinema Street) and disarms it: round to SWAT.
    id: 'bomb_defuse', url: `${TAIPEI}&game=sabotage&team=0`, frames: 230,
    setup: [live, js(`T.god(); T.pinTeam(1); Object.assign(T.state().bomb,{site:0,armed:true,progress:0,by:-1}); T.state().phaseLeft=31`),
      js(`T.teleport(-54,0.15,-66,${yaw(-54, -66, -57.5, -68.5)},-0.4)`), { frames: 30 }],
    cues: [cue(0, `T.input({keys:['KeyE']})`)],
  },
  // ---- Elimination: a staged 3v3 on Crane, slowed down --------------------------------------
  {
    id: 'elim_crane', url: 'mode=offline&map=crane&size=squad&game=elimination&team=0', frames: 180,
    setup: [js(`T.hud('none')`), live, js(`T.teleport(40,0,34,0)`),
      js(`[2,3,4].forEach((id,i)=>T.place(id, -6+i*4, T.ground(-6+i*4, 12+i), 12+i, 0)); [5,6].forEach(id=>T.kill([id]))`),
      js(`[7,8,9].forEach((id,i)=>T.place(id, -8+i*5, T.ground(-8+i*5, -14+i), -14+i, Math.PI)); [10,11,12].forEach(id=>T.kill([id]))`),
      { frames: 2 }],
    cues: [cue(0, `T.timeScale = 0.45; T.camera({kind:'follow', target:{soldier:3}, offset:[0.9,1.75,3.2], look:[0,1.5,-12], fov:55, smooth:5})`)],
  },
  // ---- Mechanics ---------------------------------------------------------------------------
  {
    id: 'knife', url: `${TAIPEI}&game=elimination&team=0`, frames: 100,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies'); T.stage([76,-30,${yaw(76, -30, 76, 0)}], [[76,-27.6]], {pin:true})`), js(`T.press('Digit1')`), { frames: 15 }],
    cues: [cue(0, `T.fight({range:4})`)],
  },
  {
    id: 'grenade', url: `${TAIPEI}&game=elimination&team=0`, frames: 120,
    setup: [live, js(`T.god(); T.pinTeam(0); T.pacify('enemies'); T.grenades(1); T.stage([76,-38,${yaw(76, -38, 76, 0)}], [[74,-22],[77,-20],[79,-23]], {pin:true})`), { frames: 10 }],
    cues: [cue(0, `T.look(${yaw(76, -38, 76, 0)}, 0.16)`), cue(6, `T.press('KeyG')`)],
  },
  {
    // Binoculars from the roof at the top of the expressway-side ladder, on Taipei 101.
    id: 'binos', url: `${TAIPEI}&game=elimination&team=0`, frames: 110,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(-40, T.ground(-40,-96,40), -96, 0); T.lookAt(${T101})`), { frames: 10 }],
    cues: [cue(4, `T.press('KeyZ')`), cue(30, `T.turnTo(T.game.player.yaw - 0.05, T.game.player.pitch + 0.01, 0.6)`)],
  },
  {
    id: 'slide', url: `${TAIPEI}&game=elimination&team=0`, frames: 75,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(76,0.15,-60,${yaw(76, -60, 76, 0)})`), { frames: 5 }],
    cues: [cue(0, `T.input({keys:['KeyW','ShiftLeft']})`), cue(28, `T.input({keys:['KeyW','ShiftLeft','KeyC']})`), cue(52, `T.input({keys:['KeyW']})`)],
  },
  {
    id: 'ladder', url: 'mode=offline&map=tower&size=squad&game=elimination&team=0', frames: 150,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(19.6,0,2.5,${yaw(19.6, 2.5, 18.5, 2.5)},0.5)`), { frames: 5 }],
    cues: [cue(0, `T.input({keys:['KeyW']})`)],
  },
  // ---- Vehicles ----------------------------------------------------------------------------
  {
    // A car east along Zhongxiao Rd, drifting right into Zhonghua Rd.
    id: 'drift', url: `${TAIPEI}&game=elimination&team=0`, frames: 300,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(-48.5,0.15,28.2,0)`), { frames: 2 }, js(`T.enter(5)`), { frames: 10 }],
    cues: [cue(0, `T.drive([{x:-20,z:29,speed:26},{x:55,z:29,speed:26},{x:70,z:29,speed:22},{x:82,z:40,speed:20,drift:true},{x:82,z:70,speed:24},{x:82,z:115,speed:24}])`)],
  },
  {
    // Riding a scooter west on Zhongxiao Rd, shooting one-handed at Militia across the median.
    id: 'scooter', url: `${TAIPEI}&game=elimination&team=0`, frames: 270,
    setup: [live, js(`T.god(); T.pinTeam(0); T.loadout('mp5',{},'mp7'); T.teleport(24.2,0.2,40,0)`), { frames: 30 }, js(`T.enter(8)`), { frames: 10 },
      js(`T.stage([24.2,40,0], [[-15,16],[-28,14],[-42,18],[-56,15]], {clear:'enemies'})`), js(`T.teleport(24.2,0.2,40,0)`)],
    cues: [cue(0, `T.drive([{x:20,z:30,speed:8},{x:5,z:28,speed:12},{x:-80,z:28,speed:12}])`), cue(45, `T.fight({range:45})`)],
  },
  {
    id: 'heli_takeoff', url: `${TAIPEI}&game=elimination&team=0`, frames: 210,
    setup: [js(`T.hud('none')`), live, js(`T.god(); T.pacify('all'); T.teleport(86,0.15,-44,0)`), { frames: 2 }, js(`T.enter(15)`), { frames: 5 }],
    cues: [cue(0, `T.camera({kind:'track', p:[64,1.4,-24], p2:[62,4,-20], frames:210, target:{vehicle:15}, look:[0,1.2,0], fov:48})`),
      cue(0, `T.drive([{x:89,z:-44,y:22},{x:40,z:-60},{x:-40,z:-60}], {alt:40, climb:10})`)],
  },
  {
    id: 'heli_flight', url: `${TAIPEI}&game=elimination&team=0`, frames: 300,
    setup: [live, js(`T.god(); T.pacify('all'); T.teleport(86,0.15,-44,0)`), { frames: 2 }, js(`T.enter(15)`), { frames: 5 },
      js(`T.drive([{x:89,z:-44,y:45},{x:30,z:-70},{x:-60,z:-60},{x:-70,z:30},{x:0,z:80},{x:90,z:100}], {alt:45, climb:12})`), { frames: 240 }],
  },
  // ---- Maps --------------------------------------------------------------------------------
  {
    id: 'map_101', url: 'mode=offline&map=xinyi&size=war&game=elimination', frames: 150, load: 6000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-150,2,60], t:[-60,40,6], fov:55}, {p:[-155,4,52], t:[-60,330,6], fov:52}]})`)],
  },
  {
    id: 'map_atrium', url: 'mode=offline&map=xinyi&size=war&game=elimination', frames: 150, load: 6000,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-28,6,22], t:[-9,-3,10], fov:60}, {p:[-24,6.5,0], t:[-6,-3,12], fov:58}]})`)],
  },
  {
    id: 'map_market', url: `${TAIPEI}&game=elimination`, frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[30,2.2,-70], t:[-60,2.5,-70], fov:58}, {p:[16,2.6,-70.5], t:[-60,2.5,-70], fov:56}]})`)],
  },
  {
    id: 'map_cinema', url: `${TAIPEI}&game=elimination`, frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-82,2,-70], t:[-30,7,-70], fov:58}, {p:[-70,3,-69], t:[-30,8,-70], fov:55}]})`)],
  },
  {
    id: 'map_crane', url: 'mode=offline&map=crane&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[0,0,0], radius:62, height:32, from:2.2, to:2.9, fov:55})`)],
  },
  {
    id: 'map_tower', url: 'mode=offline&map=tower&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'orbit', frames:150, center:[12.5,0,-2.5], radius:34, height:12, from:-2.4, to:-1.7, lookUp:7, fov:55})`)],
  },
  {
    id: 'map_warehouse', url: 'mode=offline&map=warehouse&size=squad&game=elimination', frames: 150,
    setup: [js(`T.hud('none')`)],
    cues: [cue(0, `T.camera({kind:'path', frames:150, keys:[{p:[-25,5,-14], t:[8,1.5,4], fov:60}, {p:[-12,5.5,-14.5], t:[12,1.5,6], fov:58}]})`)],
  },
  {
    // 24v24 on Meridian District: the square fifteen seconds into the round.
    id: 'map_meridian', url: 'mode=offline&map=meridian&size=war&game=elimination&team=0', frames: 180, load: 4000,
    setup: [js(`T.hud('none')`), live, js(`T.teleport(-190,T.ground(-190,-30,10),-30,0)`), { frames: 420 }],
    cues: [cue(0, `T.camera({kind:'path', frames:180, keys:[{p:[-70,38,-70], t:[0,0,0], fov:50}, {p:[-40,32,-82], t:[10,0,0], fov:48}]})`)],
  },
];
