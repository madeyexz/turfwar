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
export const CARDS: [string, 'title' | 'caption' | 'tag' | 'end' | 'credit', string[], number][] = [
  ['title', 'title', ['TURF WAR: TAIPEI', '角頭械鬥', 'SWAT vs MILITIA'], 120],
  ['title_short', 'title', ['TURF WAR: TAIPEI', '角頭械鬥', 'SWAT vs MILITIA'], 60],
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
  ['end', 'end', ['TURF WAR: TAIPEI', '角頭械鬥', 'Play free in your browser', 'lawbreaker.vercel.app', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 300],
  ['end_short', 'end', ['TURF WAR: TAIPEI', '角頭械鬥', 'Play free in your browser', 'lawbreaker.vercel.app', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 180],
  // ---- The Turf War: Taipei edit ----
  ['credit_solo', 'credit', ["A tribute to Alex Honnold's 2025 free solo of Taipei 101"], 120],
  ['cap_solo1', 'caption', ['TAIPEI 101', 'Free solo. 508 m.'], 105],
  ['cap_solo2', 'caption', ['TAIPEI 101', 'No ropes. Just a rifle.'], 135],
  ['cap_88f', 'caption', ['TAIPEI 101 · 88F', '383 m up. Take the floor.'], 165],
  ['tag_88f', 'tag', ['TAIPEI 101 · 88F'], 54], ['tag_damper', 'tag', ['TUNED MASS DAMPER · 660 t'], 80], ['tag_server', 'tag', ['SITE A · SERVER ROOM'], 80],
  ['tag_board', 'tag', ['SITE B · BOARDROOM'], 95], ['tag_window', 'tag', ['383 M ABOVE XINYI'], 90],
  ['cap_memorial', 'caption', ['MEMORIAL HALL', '89 steps to the chamber.'], 165],
  ['tag_memgallery', 'tag', ['SITE A · GALLERY HALL'], 80],
  ['tag_store', 'tag', ['THE STORE · GUNS & ATTACHMENTS'], 80],
  ['cap_sabotage2', 'caption', ['SABOTAGE', 'Arm the bomb. Or stop it.'], 85],
  ['cap_elimination2', 'caption', ['ELIMINATION', 'One life a round. First to ten.'], 115],
  ['tag_duel', 'tag', ['1v1 DUEL'], 55], ['tag_war', 'tag', ['24v24 · MERIDIAN DISTRICT'], 70],
  ['cap_vehicles2', 'caption', ['VEHICLES', 'Drive it. Ride it. Fly it.'], 150],
  ['tag_shove', 'tag', ['CARS SHOVE CARS'], 80], ['tag_roof', 'tag', ['UP ON THE ROOF'], 90],
  ['cap_maps2', 'caption', ['12 MAPS', 'From Ximending to Taipei 101.'], 150],
  ['tag_railyard', 'tag', ['RAILYARD'], 54], ['tag_skyline', 'tag', ['SKYLINE ROOFTOPS'], 54],
  ['cap_online2', 'caption', ['PLAY ONLINE', 'Pick your fight. One click.'], 150],
  ['end2', 'end', ['TURF WAR: TAIPEI', '角頭械鬥', 'Play free in your browser', 'turfwar.ianhsiao.me', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 300],
  ['end2_short', 'end', ['TURF WAR: TAIPEI', '角頭械鬥', 'Play free in your browser', 'turfwar.ianhsiao.me', 'Solo vs bots · Online rooms 1v1 · 6v6 · 24v24'], 150],
];

/**
 * Traditional Chinese (Taiwan) copy for the zh-TW trailer: written as trailer lines, not translated
 * word for word. Team, mode, map and gear names match the game's own (src/ui/i18n.ts). The brand and
 * the URL stay in English; the lockup leads with 角頭械鬥.
 */
export const CARDS_ZH: Record<string, string[]> = {
  title: ['角頭械鬥', 'TURF WAR: TAIPEI', '特警 vs 民兵'],
  title_short: ['角頭械鬥', 'TURF WAR: TAIPEI', '特警 vs 民兵'],
  cap_store: ['商店', '買槍、上配件，直接開打。'],
  cap_sabotage: ['爆破戰', '炸彈裝下去，或拆掉它。'],
  cap_elimination: ['殲滅戰', '一回合一條命，先拿十勝。'],
  cap_vehicles: ['載具', '飆車、騎機車、開直升機。'],
  cap_maps: ['16 張地圖', '從西門町一路打到台北101。'],
  cap_online: ['線上對戰', '快速遊戲 · 1v1 · 6v6 · 24v24'],
  tag_mp5: ['MP5'], tag_m4: ['M4A1 · 全像瞄準鏡'], tag_m110: ['M110 · 6 倍鏡'],
  tag_m1014: ['M1014 · 一槍 14 顆彈丸'], tag_m249: ['M249 · 86 發彈鏈'], tag_bots: ['空位由電腦玩家補滿'],
  tag_knife: ['刀'], tag_grenade: ['M67 手榴彈'], tag_binos: ['望遠鏡 · 10 倍'],
  tag_slide: ['衝刺 · 滑鏟'], tag_ladder: ['爬梯'],
  tag_heli: ['直升機'], tag_drift: ['手煞車甩尾'], tag_scooter: ['一手催油門，一手開槍。'], tag_flight: ['飛越西門町'],
  tag_101: ['台北101 · 信義'], tag_atrium: ['信義商場中庭'], tag_market: ['西門夜市'], tag_cinema: ['西門町電影街'],
  tag_crane: ['起重機'], tag_tower: ['塔樓'], tag_warehouse: ['倉庫'], tag_meridian: ['子午線街區 · 24v24'],
  end: ['角頭械鬥', 'TURF WAR: TAIPEI', '打開瀏覽器，免費開打', 'lawbreaker.vercel.app', '單機對戰電腦 · 線上房間 1v1 · 6v6 · 24v24'],
  end_short: ['角頭械鬥', 'TURF WAR: TAIPEI', '打開瀏覽器，免費開打', 'lawbreaker.vercel.app', '單機對戰電腦 · 線上房間 1v1 · 6v6 · 24v24'],
  // The Turf War: Taipei edit.
  credit_solo: ['致敬 Alex Honnold 2025 年徒手攀登台北101'],
  cap_solo1: ['台北101', '徒手攀登 · 508 公尺'],
  cap_solo2: ['台北101', '沒有繩索，只有步槍。'],
  cap_88f: ['台北101 · 88F', '383 公尺高空，整層樓都是戰場。'],
  tag_88f: ['台北101 · 88F'], tag_damper: ['風阻尼器 · 660 公噸'], tag_server: ['A 點 · 機房'], tag_board: ['B 點 · 董事會議室'], tag_window: ['信義區上空 383 公尺'],
  cap_memorial: ['中正紀念堂', '89 階，直上紀念大廳。'],
  tag_memgallery: ['A 點 · 展覽廳'],
  tag_store: ['商店 · 槍枝與配件'],
  cap_sabotage2: ['爆破戰', '炸彈裝下去了，你敢來拆嗎？'],
  cap_elimination2: ['殲滅戰', '一回合一條命，先拿十勝。'],
  tag_duel: ['1v1 單挑'], tag_war: ['24v24 · 子午線街區'],
  cap_vehicles2: ['載具', '飆車、騎機車、開直升機。'],
  tag_shove: ['路邊的車擋路？撞開就好。'], tag_roof: ['跳上車頂開火'],
  cap_maps2: ['地圖', '12 張地圖，台北走透透。'],
  tag_railyard: ['鐵道貨場'], tag_skyline: ['天際屋頂'],
  cap_online2: ['線上對戰', '挑好戰場，一鍵開打。'],
  end2: ['角頭械鬥', 'TURF WAR: TAIPEI', '找朋友，打開瀏覽器就開打。', 'turfwar.ianhsiao.me', '免下載 · 單人打電腦 · 線上 1v1／6v6／24v24'],
  end2_short: ['角頭械鬥', 'TURF WAR: TAIPEI', '找朋友，打開瀏覽器就開打。', 'turfwar.ianhsiao.me', '免下載 · 單人打電腦 · 線上 1v1／6v6／24v24'],
};
/** A card's lines in a language (English is CARDS' own). */
export function cardLines(id: string, lang: string) {
  const en = CARDS.find(c => c[0] === id)?.[2];
  if (!en) throw new Error(`no card ${id}`);
  if (lang === 'en') return en;
  const zh = CARDS_ZH[id];
  if (!zh) throw new Error(`card ${id} has no ${lang} copy`);
  return zh;
}

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

/** The first edit (Lawbreaker // Frontline era), kept for reference; its outputs are in out/previous/. */
export const LEGACY = [FULL, SHORT];

/**
 * Turf War: Taipei (角頭械鬥) — the new edit. Act 1: the Taipei 101 free solo as the cold open, a
 * stop on the punchline and the title hit; Taipei 101 · 88F and Memorial Hall. Act 2: the modes, the
 * sizes, the store; the vehicles' drop. Act 3: a silent beat, the maps, the lobby, the end card.
 */
export const TURF: Cut = {
  id: 'turfwar-trailer',
  segments: [
    // 0–12 s: the free solo (open + a silent beat as the helicopter rises).
    s('climb_wide', 15, 75, { enter: 'black' }),
    s('climb_hands', 10, 45),
    s('climb_down', 10, 45),
    s('climb_orbit', 10, 60),
    s('climb_push', 10, 45),
    s('climb_top', 0, 90),
    // 12–16 s: title.
    s('card:title', 0, 120),
    // 16–24 s: Taipei 101 · Xinyi, into 88F.
    s('map_101', 30, 75, { enter: 'flash' }),
    s('t101_push', 0, 120),
    s('map_atrium', 40, 45),
    // 24–40 s: the floor at 383 m.
    s('t101_damper', 15, 90, { enter: 'flash' }),
    s('t101_gallery', 20, 90),
    s('t101_server', 15, 90),
    s('t101_arm', 0, 45),
    s('t101_arm', 140, 60),
    s('t101_window', 10, 105),
    // 40–52 s: Memorial Hall.
    s('mem_aerial', 15, 90, { enter: 'flash' }),
    s('mem_stairs', 30, 90),
    s('mem_chamber', 15, 90),
    s('mem_gallery', 20, 90),
    // 52–62 s: the store, Sabotage, Elimination, a duel.
    s('store', 120, 90, { enter: 'flash', zoom: { scale: 1.22, x: 0.5, y: 0.5 } }),
    s('bomb_defuse', 140, 90),
    s('elim_crane', 40, 60),
    s('duel', 30, 60),
    // 62–66 s: 24v24, then the helicopter lifts off (rotor swell, M249 fill).
    s('map_meridian', 60, 75),
    s('heli_takeoff', 100, 45),
    // 66–82 s: vehicles.
    s('drift', 60, 105, { enter: 'flash' }),
    s('scooter', 45, 90),
    s('car_shove', 60, 90),
    s('roof_jump', 0, 105),
    s('heli_flight', 30, 90),
    // 82–83 s: silence — Taipei 101 through the binoculars.
    s('binos', 40, 30),
    // 83–91 s: the maps.
    s('map_market', 20, 60, { enter: 'flash' }),
    s('map_cinema', 0, 60),
    s('map_railyard', 30, 45),
    s('map_skyline', 30, 45),
    s('map_warehouse', 30, 30),
    // 91–97 s: the lobby (filters, Play Online, live rooms).
    s('lobby2', 0, 105, { enter: 'flash', zoom: { scale: 1.7, x: 0, y: 0 } }),
    s('lobby2', 140, 75, { zoom: { scale: 2.2, x: 0, y: 0.35 } }),
    // 97–107 s: end card.
    s('card:end2', 0, 300),
  ],
  overlays: [
    { card: 'credit_solo', at: 15 },
    { card: 'cap_solo1', at: 75 + 6 }, { card: 'cap_solo2', at: 180 + 6 },
    { card: 'tag_101', at: 16 * 30 + 4 }, { card: 'cap_88f', at: 18.5 * 30 + 10, frames: 110 },
    { card: 'tag_damper', at: 24 * 30 + 6 }, { card: 'tag_server', at: 30 * 30 + 6 }, { card: 'tag_board', at: 33 * 30 + 4 }, { card: 'tag_window', at: 36.5 * 30 + 6 },
    { card: 'cap_memorial', at: 40 * 30 + 10 }, { card: 'tag_memgallery', at: 49 * 30 + 6 },
    { card: 'cap_sabotage2', at: 55 * 30 + 4 }, { card: 'cap_elimination2', at: 58 * 30 + 4 },
    { card: 'tag_duel', at: 60 * 30 + 3 }, { card: 'tag_war', at: 62 * 30 + 3 },
    { card: 'cap_vehicles2', at: 66 * 30 + 10 }, { card: 'tag_drift', at: 66 * 30 + 6, frames: 95 }, { card: 'tag_scooter', at: 69.5 * 30 + 4, frames: 82 },
    { card: 'tag_shove', at: 72.5 * 30 + 4 }, { card: 'tag_flight', at: 79 * 30 + 4, frames: 82 },
    { card: 'cap_maps2', at: 83 * 30 + 10 }, { card: 'tag_market', at: 83 * 30 + 3 }, { card: 'tag_cinema', at: 85 * 30 + 3 },
    { card: 'tag_railyard', at: 87 * 30 + 3, frames: 40 }, { card: 'tag_skyline', at: 88.5 * 30 + 3, frames: 40 }, { card: 'tag_warehouse', at: 90 * 30 + 2, frames: 27 },
  ],
  score: [['open', 22], ['silence', 2], ['title', 8], ['store', 16], ['guns', 56], ['tension', 20], ['fill', 8], ['drop', 32], ['silence', 2], ['climax', 16], ['rise', 12], ['end', 20]],
};

export const TURF_SHORT: Cut = {
  id: 'turfwar-trailer-30s',
  segments: [
    s('climb_hands', 10, 30, { enter: 'black' }),
    s('climb_down', 10, 30),
    s('climb_top', 45, 45),
    s('card:title_short', 0, 60),
    s('t101_push', 50, 60, { enter: 'flash' }),
    s('t101_damper', 30, 45),
    s('t101_server', 30, 45),
    s('mem_stairs', 60, 30),
    s('drift', 75, 60, { enter: 'flash' }),
    s('car_shove', 95, 45),
    s('roof_jump', 0, 45),
    s('scooter', 60, 45),
    s('heli_flight', 30, 45),
    s('mem_aerial', 30, 45, { enter: 'flash' }),
    s('t101_window', 40, 45),
    s('t101_arm', 140, 45),
    s('lobby2', 140, 30, { zoom: { scale: 2.2, x: 0, y: 0.35 } }),
    s('card:end2_short', 0, 150),
  ],
  overlays: [
    { card: 'cap_solo1', at: 4, frames: 56 },
    { card: 'tag_88f', at: 5.5 * 30 + 3, frames: 54 }, { card: 'tag_damper', at: 7.5 * 30 + 3, frames: 42 }, { card: 'tag_server', at: 9 * 30 + 3, frames: 42 },
    { card: 'tag_drift', at: 11.5 * 30 + 3, frames: 54 }, { card: 'tag_shove', at: 13.5 * 30 + 3, frames: 42 },
    { card: 'tag_scooter', at: 16.5 * 30 + 3, frames: 42 },
  ],
  score: [['open', 6], ['silence', 1], ['title', 4], ['guns', 12], ['drop', 16], ['climax', 9], ['rise', 2], ['end', 10]],
};

export const CUTS = [TURF, TURF_SHORT];

/** Seconds at which each segment of a cut starts (its picture cuts). */
export const cutTimes = (cut: Cut) => { let at = 0; return cut.segments.map(s => { const t = at / FPS; at += s.frames; return t; }); };
