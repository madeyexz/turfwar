/**
 * The cuts: which captured clip plays when, the cards over them, and the score's sections.
 * Everything is in frames at 30 fps; the music runs at 120 BPM, so a beat is 15 frames and a bar
 * is 60 frames — every cut below lands on a beat, and every score section starts on a cut.
 */
export const FPS = 30;
export const BPM = 120;
export const BAR = 60;

export interface Segment {
  /** A clip in captures/ (shots.ts id) or a card rendered by scripts/cards.ts. */
  clip: string;
  /** First frame used from the clip. */
  in: number;
  frames: number;
  /** Punch in (scale about a point, 0..1 of the frame) for UI shots. */
  zoom?: { scale: number; x: number; y: number };
  /** Flash into the shot (white) or dip from black. */
  enter?: 'flash' | 'black';
  /** Fade to black over the last frames. */
  exit?: 'black';
  /** Keep the clip's own game sound in the mix (default true for clips, false for cards). */
  sound?: boolean;
}
export interface Overlay {
  /** Card id (scripts/cards.ts renders each into frames with alpha). */
  card: string;
  /** Start frame in the cut. */
  at: number;
  /** Length when it differs from the card's own. */
  frames?: number;
}
/** Score sections (music/score.ts), each [kind, beats]; a beat is 15 frames. */
import type { Section } from './music/score';
export type { Section };
export interface Cut { id: string; segments: Segment[]; overlays: Overlay[]; score: [Section, number][] }

/** Cards: [id, kind, lines, frames]. Lower thirds (`caption`), corner tags (`tag`), the title and the end card. */
export const CARDS: [string, 'title' | 'caption' | 'tag' | 'end', string[], number][] = [
  ['title', 'title', ['LAWBREAKER', '// FRONTLINE', 'SWAT vs MILITIA'], 120],
  ['title_short', 'title', ['LAWBREAKER', '// FRONTLINE', 'SWAT vs MILITIA'], 60],
  ['cap_store', 'caption', ['THE STORE', 'Buy guns. Fit optics. Fight.'], 150],
  ['cap_sabotage', 'caption', ['SABOTAGE', 'Arm the bomb. Or stop it.'], 225],
  ['cap_elimination', 'caption', ['ELIMINATION', 'One life a round. First to ten.'], 165],
  ['cap_vehicles', 'caption', ['VEHICLES', 'Drive it. Ride it. Fly it.'], 150],
  ['cap_maps', 'caption', ['16 MAPS', 'From Ximending to Taipei 101.'], 120],
  ['cap_online', 'caption', ['PLAY ONLINE', 'Quick Play · 1v1 · 6v6 · 24v24'], 165],
  ['tag_mp5', 'tag', ['MP5'], 66], ['tag_m4', 'tag', ['M4A1 · HOLOGRAPHIC'], 66], ['tag_m110', 'tag', ['M110 · 6× SCOPE'], 80],
  ['tag_m1014', 'tag', ['M1014 · 14 PELLETS'], 52], ['tag_m249', 'tag', ['M249 · 86-ROUND BELT'], 80], ['tag_bots', 'tag', ['BOTS FILL EVERY EMPTY SLOT'], 80],
  ['tag_knife', 'tag', ['KNIFE'], 40], ['tag_grenade', 'tag', ['M67 GRENADE'], 80], ['tag_binos', 'tag', ['BINOCULARS · 10×'], 40],
  ['tag_slide', 'tag', ['SPRINT · SLIDE'], 28], ['tag_ladder', 'tag', ['LADDERS'], 28],
  ['tag_heli', 'tag', ['HELICOPTER'], 95], ['tag_drift', 'tag', ['HANDBRAKE DRIFT'], 125], ['tag_scooter', 'tag', ['SCOOTER · SHOOT ONE-HANDED'], 110],
  ['tag_flight', 'tag', ['OVER XIMENDING'], 110],
  ['tag_101', 'tag', ['TAIPEI 101 · XINYI'], 68], ['tag_atrium', 'tag', ['XINYI MALL ATRIUM'], 40], ['tag_market', 'tag', ['XIMEN NIGHT MARKET 西門夜市'], 54],
  ['tag_cinema', 'tag', ['CINEMA STREET 電影街'], 54], ['tag_crane', 'tag', ['CRANE'], 54], ['tag_tower', 'tag', ['TOWER'], 54], ['tag_warehouse', 'tag', ['WAREHOUSE'], 54],
  ['tag_meridian', 'tag', ['MERIDIAN DISTRICT · 24v24'], 54],
  ['end', 'end', ['LAWBREAKER', '// FRONTLINE', 'Play free in your browser', 'lawbreaker.vercel.app', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 300],
  ['end_short', 'end', ['LAWBREAKER', '// FRONTLINE', 'Play free in your browser', 'lawbreaker.vercel.app', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 180],
];

const s = (clip: string, inFrame: number, frames: number, extra: Partial<Segment> = {}): Segment => ({ clip, in: inFrame, frames, ...extra });

export const FULL: Cut = {
  id: 'lawbreaker-trailer',
  segments: [
    // 0–8 s: cold open on Ximending at dusk, Taipei 101 on the skyline; Militia runs the gateway.
    s('open_skyline', 0, 135, { enter: 'black' }),
    s('open_gate', 8, 105, { exit: 'black' }),
    // 8–12 s: title.
    s('card:title', 0, 120),
    // 12–20 s: round 1, the store.
    s('store', 18, 240, { enter: 'flash', zoom: { scale: 1.22, x: 0.5, y: 0.5 } }),
    // 20–36 s: gunplay across the weapons.
    s('gun_mp5', 20, 75, { enter: 'flash' }),
    s('gun_m4', 20, 75),
    s('gun_m110', 10, 90),
    s('gun_m1014', 0, 60),
    s('gun_m249', 15, 90),
    s('elim_crane', 40, 90),
    // 36–44 s: Sabotage: arm, then disarm.
    s('bomb_arm', 0, 60, { enter: 'flash' }),
    s('bomb_arm', 140, 60),
    s('bomb_defuse', 10, 45),
    s('bomb_defuse', 150, 75),
    // 44–50 s: Elimination.
    s('elim_crane', 120, 60),
    s('gun_m4', 55, 60),
    s('gun_mp5', 60, 60),
    // 50–58 s: mechanics.
    s('knife', 15, 45, { enter: 'flash' }),
    s('grenade', 4, 45),
    s('grenade', 62, 45),
    s('binos', 10, 45),
    s('slide', 15, 30),
    s('ladder', 10, 30),
    // 58–74 s: vehicles.
    s('heli_takeoff', 100, 105, { enter: 'flash' }),
    s('drift', 60, 135),
    s('scooter', 45, 120),
    s('heli_flight', 30, 120),
    // 74–90 s: maps.
    s('map_101', 30, 75, { enter: 'flash' }),
    s('map_atrium', 30, 45),
    s('map_market', 20, 60),
    s('map_cinema', 0, 60),
    s('map_crane', 30, 60),
    s('map_tower', 30, 60),
    s('map_warehouse', 30, 60),
    s('map_meridian', 60, 60),
    // 90–96 s: online rooms in the lobby.
    s('lobby', 0, 105, { enter: 'flash', zoom: { scale: 1.9, x: 0, y: 0 } }),
    s('lobby', 110, 75, { zoom: { scale: 2.6, x: 1, y: 1 } }),
    // 96–106 s: end card.
    s('card:end', 0, 300),
  ],
  overlays: [
    { card: 'cap_store', at: 12 * 30 + 30 },
    { card: 'tag_mp5', at: 20 * 30 + 6 }, { card: 'tag_m4', at: 22.5 * 30 + 6 }, { card: 'tag_m110', at: 25 * 30 + 6 },
    { card: 'tag_m1014', at: 28 * 30 + 4 }, { card: 'tag_m249', at: 30 * 30 + 6 }, { card: 'tag_bots', at: 33 * 30 + 6 },
    { card: 'cap_sabotage', at: 36 * 30 + 8 },
    { card: 'cap_elimination', at: 44 * 30 + 8 },
    { card: 'tag_knife', at: 50 * 30 + 4 }, { card: 'tag_grenade', at: 51.5 * 30 + 4 }, { card: 'tag_binos', at: 54.5 * 30 + 4 },
    { card: 'tag_slide', at: 56 * 30 + 1 }, { card: 'tag_ladder', at: 57 * 30 + 1 },
    { card: 'cap_vehicles', at: 58 * 30 + 8 },
    { card: 'tag_heli', at: 58 * 30 + 6 }, { card: 'tag_drift', at: 61.5 * 30 + 6 }, { card: 'tag_scooter', at: 66 * 30 + 6 }, { card: 'tag_flight', at: 70 * 30 + 6 },
    { card: 'cap_maps', at: 74 * 30 + 10 },
    { card: 'tag_101', at: 74 * 30 + 4 }, { card: 'tag_atrium', at: 76.5 * 30 + 3 }, { card: 'tag_market', at: 78 * 30 + 3 }, { card: 'tag_cinema', at: 80 * 30 + 3 },
    { card: 'tag_crane', at: 82 * 30 + 3 }, { card: 'tag_tower', at: 84 * 30 + 3 }, { card: 'tag_warehouse', at: 86 * 30 + 3 }, { card: 'tag_meridian', at: 88 * 30 + 3 },
    { card: 'cap_online', at: 90 * 30 + 8, frames: 96 },
  ],
  // Act 1: ominous open, the title hit, the build through the store and the guns. Act 2: Sabotage and
  // Elimination under Shepard tension, the mechanics fill (heli swell, M249 burst), the drop on the
  // vehicles. A silent beat, then Act 3: the climax over the maps, the rise through the lobby, a
  // dry-fire click in the last silent beat, and the end card's braam.
  score: [['open', 16], ['title', 8], ['store', 16], ['guns', 32], ['tension', 28], ['fill', 16], ['drop', 30], ['silence', 2], ['climax', 32], ['rise', 12], ['end', 20]],
};

export const SHORT: Cut = {
  id: 'lawbreaker-trailer-30s',
  segments: [
    s('open_skyline', 40, 60, { enter: 'black' }),
    s('card:title_short', 0, 60),
    s('gun_m4', 25, 60, { enter: 'flash' }),
    s('gun_m110', 20, 60),
    s('gun_m249', 20, 60),
    s('scooter', 60, 60),
    s('drift', 80, 60, { enter: 'flash' }),
    s('heli_takeoff', 130, 60),
    s('map_101', 40, 60),
    s('map_market', 20, 60),
    s('bomb_defuse', 160, 60, { enter: 'flash' }),
    s('lobby', 112, 60, { zoom: { scale: 2.6, x: 1, y: 1 } }),
    s('card:end_short', 0, 180),
  ],
  overlays: [
    { card: 'tag_m4', at: 4 * 30 + 3, frames: 54 }, { card: 'tag_m110', at: 6 * 30 + 3, frames: 54 }, { card: 'tag_m249', at: 8 * 30 + 3, frames: 54 },
    { card: 'tag_scooter', at: 10 * 30 + 3, frames: 54 }, { card: 'tag_drift', at: 12 * 30 + 3, frames: 54 }, { card: 'tag_heli', at: 14 * 30 + 3, frames: 54 },
    { card: 'tag_101', at: 16 * 30 + 3, frames: 54 }, { card: 'tag_market', at: 18 * 30 + 3, frames: 54 },
  ],
  // Condensed: cold open, title hit, the guns build (M249 fill), the drop on the vehicles, the climax
  // on the maps, the rise with its dry-fire stop, the end braam.
  score: [['open', 4], ['title', 4], ['guns', 12], ['drop', 12], ['climax', 12], ['rise', 4], ['end', 12]],
};

export const CUTS = [FULL, SHORT];

/** Seconds at which each segment of a cut starts (its picture cuts). */
export const cutTimes = (cut: Cut) => { let at = 0; return cut.segments.map(s => { const t = at / FPS; at += s.frames; return t; }); };
