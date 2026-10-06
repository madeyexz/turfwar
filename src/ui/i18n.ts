import type { MapId } from '../../shared/maps/index';
import type { AttachmentId, WeaponClass } from '../../shared/weapons';

/**
 * UI language: English or Traditional Chinese (Taiwan). `t(key)` looks a string up in the current
 * language; `zhTW` must translate every key `en` has (a missing or extra key is a type error).
 * `{name}` in a string is filled from `t`'s second argument.
 *
 * The language comes from `?lang=zh-TW` / `?lang=en` (not saved), then the saved choice
 * (`lawbreaker.lang`, set in Settings), then the browser (zh-TW, zh-HK and zh-Hant read Chinese).
 * Screens subscribe with `onLang` and redraw their text when it changes.
 *
 * Text from the server (reward reasons, room errors) keeps its English wire format and is
 * translated here on the client (`rewardReason`, `serverError`).
 */
export type Lang = 'en' | 'zh-TW';
export const LANGS: readonly { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'zh-TW', label: '繁體中文' }];

const en = {
  // ---- Shared words ----
  'team.0': 'SWAT', 'team.1': 'Militia',
  'team.short.0': 'SWAT', 'team.short.1': 'MILITIA',
  'mode.elimination': 'Elimination', 'mode.sabotage': 'Sabotage',
  'size.duel': 'Duel', 'size.squad': 'Squad', 'size.war': 'War',
  'common.join': 'Join', 'common.full': 'Full', 'common.free': 'Free', 'common.close': 'Close',
  'common.seconds': '{n}s', 'common.players': '{n}/{max} players',

  // ---- Lobby ----
  // The game's name: the big line in the current language, the other language under it.
  'brand.name': 'Turf War: Taipei', 'brand.alt': '角頭械鬥',
  'lobby.title': 'SWAT', 'lobby.titleVs': 'vs Militia',
  'lobby.defaultName': 'Player-{n}', 'lobby.fallbackName': 'Player',
  'lobby.callsign': 'Callsign', 'lobby.team': 'Team', 'lobby.auto': 'Auto',
  'lobby.playOnline': 'Play online', 'lobby.roomSize': 'Room size',
  'lobby.loading': 'Loading…', 'lobby.loadingPct': 'Loading {n}%',
  'lobby.filters': 'Match filters', 'lobby.more': 'More ways to play',
  'lobby.field.mode': 'Mode', 'lobby.field.map': 'Map', 'lobby.field.bots': 'Bots', 'lobby.field.size': 'Size', 'lobby.field.skill': 'Bot difficulty',
  'lobby.any': 'Any', 'lobby.anyMap': 'Any map', 'lobby.anyMapSub': 'Rotates every match',
  'lobby.chooseMap': 'Choose a map', 'lobby.mapsFor': '{size} maps', 'lobby.playing': '{n} playing', 'lobby.noSites': 'No bomb sites',
  'lobby.mapResetSize': '{map} is not a {size} map — map set to Any', 'lobby.mapResetMode': '{map} has no bomb sites — map set to Any',
  'lobby.bots.on': 'Fill empty slots', 'lobby.bots.off': 'Humans only',
  'lobby.skill.recruit': 'Recruit', 'lobby.skill.veteran': 'Veteran', 'lobby.skill.elite': 'Elite',
  'lobby.solo': 'Solo vs bots', 'lobby.sub.range': 'Practice', 'lobby.sub.create': 'Private room',
  'lobby.createRoom': 'Create room',
  'lobby.createHint': 'Uses the size, mode and map above (Any picks at random). In the match you get a four-letter code to share.',
  'lobby.roomCode': 'Room code', 'lobby.codeShort': 'Code', 'lobby.codeHint': 'Join a private room with its four-letter code',
  'lobby.startMatch': 'Start match',
  'lobby.botsHint': 'Your own match, offline: bots fill both teams. Uses the size, mode and map above; Any picks at random.',
  'lobby.rangeHint': 'No bots, a free store and no round limit: try every gun and attachment on the map above (Any picks at random).',
  'lobby.controls': 'Controls', 'lobby.settings': 'Settings',
  'lobby.joining': 'Joining…', 'lobby.starting': 'Starting…',
  'lobby.warmup': 'Warm-up', 'lobby.matchOver': 'Match over', 'lobby.round': 'Round {n}',
  'lobby.connecting': 'Connecting to the match server…',
  'lobby.serverOffline': 'Server offline — Solo and Practice still work',
  'lobby.playJoins': 'Joins {map} · {mode} · {players}',
  'lobby.opensAny': 'No matching room yet — opens a new one; maps rotate after each match',
  'lobby.opensFixed': 'No matching room yet — opens a new one that stays on {rules}',
  'lobby.liveRooms': 'Live rooms', 'lobby.matching': 'matching',
  'lobby.noMatches': 'No matching rooms yet — PLAY ONLINE opens one',
  'lobby.showing': 'Showing {n} of {m} rooms', 'lobby.clearFilters': 'Clear filters', 'lobby.otherSizes': 'Other sizes:',
  'lobby.fixedMap': 'Stays on this map', 'lobby.fixedMode': 'Stays on this mode',
  'lobby.liveTitle': 'Live · {db} · bots fill empty slots and step aside for players',
  'lobby.roomCount.one': '1 room', 'lobby.roomCount.other': '{n} rooms',
  'lobby.playerCount.one': '1 player', 'lobby.playerCount.other': '{n} players',
  'lobby.roomAria': '{map} {mode} {size}, {n} of {max} players, {status}',
  // Ping to the game server (src/net/ping.ts): the room list's column, its header chip, the play line.
  'server.label': 'Server', 'server.region.usEast': 'US East', 'server.region.local': 'Local',
  'server.ms': '{n} ms', 'server.ping': 'Ping {ms}', 'server.measuring': 'Measuring ping…',
  'server.pingTitle': 'Ping to the {server} server: round trip, median of the last {n} samples',
  'lobby.sitesAB': 'Sites A · B', 'lobby.siteA': 'Site A',
  'lobby.mapRotation': 'map rotation', 'lobby.bigMaps': 'big maps', 'lobby.newRoom': 'New room',
  'lobby.bombSites.one': '1 bomb site', 'lobby.bombSites.other': '{n} bomb sites',
  'lobby.couldNotJoin': 'Could not join: {error}',
  'lobby.unableToStart': 'Unable to start: {error}. A WebGL2 desktop browser is required.',
  'lobby.noServer': 'No SpacetimeDB server is configured for this build. Solo skirmish works offline.',
  'lobby.bench': 'Run the {n}-second performance check',
  'lobby.credits': 'Characters, weapons and props: CC0 packs by Quaternius. Gunshots: CC0 Free Firearm Sound Library. Textures: CC0 Poly Haven. Fonts: Rajdhani and Noto Sans TC (OFL). No proprietary game assets.',

  // ---- Online connection ----
  'net.connecting': 'Connecting to SpacetimeDB…', 'net.joining': 'Joining the battlefield…',
  'net.timeout': 'Timed out connecting to the match server.', 'net.subscription': 'Subscription failed.',
  'net.unreachable': 'Could not reach the match server ({error}).', 'net.refused': 'connection refused',
  'net.disconnected': 'DISCONNECTED', 'net.room': 'ROOM {code} · {size}', 'net.quick': 'PUBLIC ROOM {size}', 'net.online': 'ONLINE',
  'net.players.one': '1 PLAYER', 'net.players.other': '{n} PLAYERS',
  'net.solo': 'SOLO', 'net.practice': 'PRACTICE RANGE',

  // ---- Performance check ----
  'bench.title': 'Performance check', 'bench.met': '60 fps target met on this device', 'bench.notMet': '60 fps target not met on this device',
  'bench.about': '{n} s of scripted combat after a warm-up. Browsers cap frames at the display refresh rate, so 120 Hz screens can exceed 60. Met means an average of at least 58 fps with 95% of frames within 18.2 ms.',
  'bench.copy': 'Copy results', 'bench.copied': 'Copied', 'bench.again': 'Run again', 'bench.menu': 'Back to menu',
  'bench.warming': 'Performance check · warming up', 'bench.left': 'Performance check · {n} s',
  'bench.avg': 'Average', 'bench.low': '1% low', 'bench.frame': 'Frame time (median / p95 / p99)', 'bench.slowest': 'Slowest frame',
  'bench.slow': 'Frames slower than 60 Hz', 'bench.cpu': 'Main-thread time (median / p95)', 'bench.draws': 'Draw calls · triangles',
  'bench.hitches': 'Hitches over 100 ms · shader compiles', 'bench.setup': 'Map · quality · resolution', 'bench.gpu': 'GPU',

  // ---- Settings ----
  'set.title': 'Settings', 'set.sections': 'Settings sections', 'set.options': 'Options', 'set.controls': 'Controls',
  'set.close': 'Close settings', 'set.closeEsc': 'Close (Esc)',
  'set.paused': 'Paused', 'set.menuOnline': 'Menu — the match continues',
  'set.hintResume': 'resume', 'set.hintFullscreen': 'fullscreen', 'set.resume': 'Resume', 'set.leave': 'Leave match',
  'set.sens': 'Mouse sensitivity', 'set.ads': 'Aim sensitivity',
  'set.adsTip': '1.00 = matched: aiming scales your mouse by the zoom you look through, so moves feel the same scoped and unscoped. Lower = slower when aiming.',
  'set.matched': 'matched', 'set.fov': 'Field of view', 'set.horizontal': '{n}° horizontal',
  'set.vol': 'Effects volume', 'set.music': 'Menu music', 'set.off': 'Off',
  'set.language': 'Language',
  'set.crosshair': 'Crosshair', 'set.cross.classic': 'Classic', 'set.cross.dot': 'Dot', 'set.cross.circle': 'Circle', 'set.cross.t': 'T',
  'set.scope': 'Scope view', 'set.scope.pip': 'Through the lens', 'set.scope.overlay': 'Full-screen',
  'set.scope.pipTip': 'Magnified optics show the zoom through the lens; the view around it stays wide',
  'set.scope.overlayTip': 'Magnified optics fill the screen with a black eyepiece',
  'set.rcolor': 'Reticle colour', 'set.color.red': 'Red', 'set.color.green': 'Green', 'set.color.amber': 'Amber', 'set.color.white': 'White',
  'set.rstyle': 'Red dot & holo reticle', 'set.rstyle.stock': 'Stock', 'set.rstyle.dot': 'Dot', 'set.rstyle.circle': 'Circle',
  'set.rstyle.chevron': 'Chevron', 'set.rstyle.cross': 'Cross', 'set.rstyle.stockTip': "Each sight's own: dot for the red dot, circle-dot for the holo",
  'set.optic': 'Optic detail', 'set.optic.high': 'High', 'set.optic.low': 'Low',
  'set.optic.highTip': 'Smoothest optic models, sharper scope view', 'set.optic.lowTip': 'Lighter optic models and scope view',
  'set.quality': 'Graphics', 'set.q.low': 'Low', 'set.q.medium': 'Medium', 'set.q.high': 'High',
  'set.q.lowTip': 'No bloom, 1k shadows', 'set.q.mediumTip': 'Bloom, 2k shadows', 'set.q.highTip': '1.5× resolution',
  'key.mouse': 'Mouse', 'key.wheel': 'Wheel', 'key.lmb': 'LMB', 'key.rmb': 'RMB',
  'ctl.move': 'Move', 'ctl.look': 'Look', 'ctl.fire': 'Fire', 'ctl.aim': 'Aim (zoom)', 'ctl.sprint': 'Sprint (stamina)',
  'ctl.jump': 'Jump (stamina)', 'ctl.crouch': 'Crouch', 'ctl.slots': 'Knife · secondary · primary', 'ctl.grenade': 'Grenade',
  'ctl.last': 'Last weapon · cycle', 'ctl.reload': 'Reload', 'ctl.use': 'Use (bomb, ammo crate)', 'ctl.store': 'Store',
  'ctl.binos': 'Binoculars', 'ctl.chat': 'Chat · team chat', 'ctl.board': 'Scoreboard', 'ctl.menu': 'Menu (settings)',
  'ctl.fullscreen': 'Fullscreen', 'ctl.lobby': 'Back to the lobby (from the menu)',

  // ---- HUD ----
  'hud.hp': 'HP', 'hud.sta': 'STA', 'hud.kmh': 'KM/H', 'hud.alt': 'M ALT',
  'hud.released': 'Mouse released — the match continues', 'hud.clickResume': 'Click to resume', 'hud.leave': 'leave match',
  'hud.practice': 'PRACTICE', 'hud.warmup': 'WARMUP', 'hud.matchOver': 'MATCH OVER', 'hud.roundBuy': 'ROUND {n} · BUY',
  'hud.roundOver': 'ROUND OVER', 'hud.round': 'ROUND {n}',
  'hud.practiceSub': 'PRACTICE RANGE · FREE STORE', 'hud.modeSub': '{mode} · FIRST TO {n}',
  'hud.disarming': 'DISARMING {site}', 'hud.bombArmed': 'BOMB ARMED · {site} · {clock}', 'hud.arming': 'ARMING {site}',
  'hud.armSite': 'ARM A BOMB SITE', 'hud.defendSites': 'DEFEND THE BOMB SITES',
  'hud.knife': 'KNIFE', 'hud.headshot': 'Headshot', 'hud.spectating': 'SPECTATING', 'hud.next': 'NEXT',
  'hud.alive': '{n}/{m} ALIVE', 'hud.player': 'Player', 'hud.k': 'K', 'hud.d': 'D', 'hud.a': 'A', 'hud.score': 'Score', 'hud.cash': 'Cash',
  'hud.bot': 'BOT', 'hud.boardHead': '{map} · {mode} · ROUND {n} · FIRST TO {m}',
  'hud.chatDead': '*DEAD*', 'hud.chatTeam': '*TEAM*', 'hud.chatAll': 'ALL', 'hud.chatTeamLabel': 'TEAM',
  'hud.matchDrawn': 'MATCH DRAWN', 'hud.winMatch': '{team} WIN THE MATCH', 'hud.draw': 'DRAW', 'hud.victory': 'VICTORY', 'hud.defeat': 'DEFEAT',
  'hud.newMatchIn': 'New match in {n}s', 'hud.playAgain': 'Play again', 'hud.leaveMatch': 'Leave match',
  'hud.leaderboard': 'Server leaderboard', 'hud.hs': 'HS', 'hud.rounds': 'Rounds', 'hud.matches': 'Matches',
  'hud.store': 'B STORE', 'hud.storeLeft': 'B STORE · {n}s',
  'hud.arming2': 'ARMING', 'hud.disarming2': 'DISARMING',
  'hud.passenger': 'PASSENGER', 'hud.exit': 'EXIT', 'hud.fly': 'FLY', 'hud.mouseTurn': 'MOUSE TURN', 'hud.up': 'UP', 'hud.down': 'DOWN',
  'hud.view': 'VIEW', 'hud.drive': 'DRIVE', 'hud.steer': 'STEER', 'hud.drift': 'DRIFT', 'hud.fire': 'FIRE',
  'hud.rideAlong': 'RIDE ALONG · {name}', 'hud.enterCar': 'DRIVE THE {name}', 'hud.enterScooter': 'RIDE {name}', 'hud.enterHeli': 'FLY {name}',
  'hud.holdDisarm': 'HOLD {key} TO DISARM THE BOMB', 'hud.holdArm': 'HOLD {key} TO ARM THE BOMB AT {site}',
  'hud.crate': 'AMMO CRATE', 'hud.youDied': 'YOU DIED',
  'hud.goal.elim': 'Eliminate the enemy team', 'hud.goal.attack': 'Arm the bomb or eliminate SWAT', 'hud.goal.defend': 'Defend the sites or eliminate the Militia',
  'hud.roundDraw': 'DRAW · ROUND REPLAYS', 'hud.winsRound': '{team} WINS THE ROUND',
  'hud.armedTitle': 'BOMB ARMED', 'hud.disarmedTitle': 'BOMB DISARMED', 'hud.site': 'Site {site}',
  'hud.winsMatch': '{team} wins the match', 'hud.newMatch': 'NEW MATCH', 'hud.joined': '{name} joined {team}',
  'hud.privateToast': 'Private room {code} · {size} — friends join with this code',
  'reason.eliminated': 'Team eliminated', 'reason.time': 'Time ran out', 'reason.armed': 'Bomb armed', 'reason.disarmed': 'Bomb disarmed', 'reason.exploded': 'Target destroyed',
  'vehicle.car': 'CAR', 'vehicle.taxi': 'TAXI', 'vehicle.scooter': 'SCOOTER', 'vehicle.heli': 'HELICOPTER',
  'cause.knife': 'Knife', 'cause.fall': 'FALL', 'cause.bomb': 'BOMB', 'cause.vehicle': 'VEHICLE', 'cause.crash': 'CRASH', 'cause.roadkill': 'ROADKILL',

  // ---- Store ----
  'store.title': 'Store', 'store.close': 'Close store', 'store.cash': 'Cash', 'store.free': 'FREE',
  'store.tab.primary': 'Primary', 'store.tab.secondary': 'Secondary', 'store.tab.tactical': 'Tactical', 'store.tab.attachments': 'Attachments',
  'class.melee': 'Melee', 'class.pistol': 'Pistol', 'class.smg': 'Submachine gun', 'class.rifle': 'Assault rifle',
  'class.shotgun': 'Shotgun', 'class.sniper': 'Sniper rifle', 'class.lmg': 'Light machine gun',
  'slot.optic': 'Optic', 'slot.muzzle': 'Muzzle', 'slot.laser': 'Laser', 'slot.light': 'Light', 'slot.counter': 'Counter',
  'slot.magazine': 'Magazine', 'slot.stock': 'Stock', 'slot.ammo': 'Ammo',
  'slot.empty.optic': 'Iron Sight', 'slot.empty.muzzle': 'Bare muzzle', 'slot.empty.none': 'Empty', 'slot.empty.standard': 'Standard', 'slot.empty.ammo': 'Standard rounds',
  'note.irons': 'The free default sights. Choosing them takes the fitted optic off.',
  'note.reflex': 'Tube red dot: a small, crisp dot through a round tube; a little zoom.',
  'note.holo': 'Holographic sight: a wide window and a ring-and-dot reticle; more zoom and steadier aim.',
  'note.acog': 'Magnified 4× prism scope for mid-range fights.',
  'note.x4': 'Pistol scope: 4× magnification on the M9A1.',
  'note.x6': 'Sniper scope: 6× magnification for the M110.',
  'note.ammoCounter': 'Without it you do not see your ammo: shows the magazine and spare rounds on the gun and the HUD.',
  'note.laser': 'Tightens hip-fire. The beam is visible — others can see it.',
  'note.flashlight': 'Lights a cone ahead of you; adds a little recoil.',
  'note.suppressor': 'Hides your tracer and muzzle flash and keeps you off enemy minimaps. Slightly less damage.',
  'note.extendedClip': 'More rounds per magazine; a little heavier.',
  'note.recoilPad': 'Softens recoil; a little heavier.',
  'note.explosiveAmmo': 'Hard-hitting rounds, especially to the head. Smaller magazine.',
  'note.incendiaryAmmo': 'Burning rounds that hit the body harder. Smaller magazine.',
  'bar.damage': 'Damage', 'bar.headshot': 'Headshot', 'bar.rate': 'Fire rate', 'bar.accuracy': 'Accuracy', 'bar.aimAcc': 'Aim acc.',
  'bar.recoil': 'Recoil', 'bar.mobility': 'Mobility',
  'stat.head': 'Head damage', 'stat.body': 'Body damage', 'stat.limb': 'Limb damage', 'stat.magazine': 'Magazine',
  'stat.hipAcc': 'Hip accuracy', 'stat.aimAcc': 'Aim accuracy', 'stat.recoil': 'Recoil', 'stat.aimRecoil': 'Aim recoil',
  'stat.move': 'Move speed', 'stat.zoom': 'Zoom', 'stat.summary': '{text} {lower}',
  'store.need': 'Need {money} more',
  'store.returnToBase': 'Return to your base to buy weapons',
  'store.buyOver': 'Buy time is over — weapons are sold at the start of the next round',
  'store.frag': 'Frag grenade', 'store.he': 'High Explosive', 'store.heUpgrade': 'M67 upgrade',
  'store.oneM67': 'You carry one M67 at a time — throw it to buy another',
  'store.freeDefault': 'Free default', 'store.onYourGun': 'On your gun',
  'store.k.browse': 'browse', 'store.k.option': 'option', 'store.k.weapon': 'weapon', 'store.k.fit': 'fit',
  'store.k.select': 'select', 'store.k.buy': 'double-click buy', 'store.k.tabs': 'tabs', 'store.k.close': 'close',
  'store.c.free': 'Free store', 'store.c.practice': 'Practice', 'store.c.buy': 'Buy time', 'store.c.weapons': 'Weapons', 'store.c.onSale': 'On sale',
  'store.c.outside': 'Outside base', 'store.c.closed': 'Weapons closed', 'store.c.gear': 'Gear still on sale',
  'store.lo.primary': 'Primary', 'store.lo.secondary': 'Secondary', 'store.lo.melee': 'Melee', 'store.lo.tactical': 'Tactical',
  'store.noAttachments': 'No attachments', 'store.knife': 'Knife', 'store.alwaysCarried': 'Always carried', 'store.empty': 'Empty',
  'store.heReady': 'High Explosive ready', 'store.noGrenade': 'No grenade',
  'badge.equipped': 'Equipped', 'badge.owned': 'Owned', 'badge.fitted': 'Fitted', 'badge.inUse': 'In use', 'badge.carrying': 'Carrying',
  'store.asideTactical': 'Grenades and upgrades sell anywhere, any time.',
  'store.asideWeapons': 'Bought weapons stay yours for the match — swap between them free during buy time.',
  'store.prevWeapon': 'Previous weapon', 'store.nextWeapon': 'Next weapon', 'store.default': 'default',
  'store.equipFree': 'Equip · free', 'store.useIrons': 'Use iron sights · free', 'store.buy': 'Buy {price}', 'store.buyFree': 'Buy · free',
  'store.leaves': 'Leaves you <b>{money}</b>', 'store.haveIt': 'You have it', 'store.ownedSwap': 'Owned · swap free', 'store.price': 'Price',
  'store.blast': 'Blast radius', 'store.appliesTo': 'Applies to', 'store.everyM67': 'Every M67 you throw', 'store.fuse': 'Fuse', 'store.carry': 'Carry',
  'store.carryN': '{n} at a time · not restocked',
  'store.heNote': 'A bigger charge: much more damage in a tighter blast.', 'store.m67Note': 'Cook and throw with 4. Kills pay $900.',
  'store.replaces': 'Replaces <b>{name}</b>', 'store.noChange': 'No stat change',
  'store.yourWeapon': 'Your equipped weapon', 'store.compared': 'Compared with your <b>{name}</b>',
  'store.f.magazine': 'Magazine', 'store.f.reload': 'Reload', 'store.f.fire': 'Fire', 'store.f.auto': 'Auto', 'store.f.semi': 'Semi',
  'store.f.zoom': 'Zoom', 'store.f.velocity': 'Velocity', 'store.customize': 'Customize attachments →',
  'store.heTitle': 'M67 upgrade · lasts the match', 'store.m67Title': 'Frag grenade · tactical · key 4',
  'store.slotOn': '{slot} slot · on {weapon}', 'store.primaryKey': 'Primary · key 3', 'store.secondaryKey': 'Secondary · key 2',
  'store.previewOff': 'Preview unavailable', 'store.previewHint': 'Drag to rotate · scroll to zoom',

  // ---- Cash awards (server reasons) ----
  'reward.Kill': 'Kill', 'reward.First kill': 'First kill', 'reward.First blood': 'First blood', 'reward.Headshot': 'Headshot',
  'reward.Assist': 'Assist', 'reward.Last enemy': 'Last enemy', 'reward.Trade': 'Trade', 'reward.Bomb armed': 'Bomb armed',
  'reward.Bomb disarmed': 'Bomb disarmed', 'reward.Round won': 'Round won', 'reward.Survived': 'Survived',
  'reward.Last man standing': 'Last man standing', 'reward.Loss bonus': 'Loss bonus', 'reward.Loyalty': 'Loyalty',
  'reward.multi': '{n}× multi-kill', 'reward.streak': '{n} kill streak',

  // ---- Server errors (reducer messages) ----
  'err.No such room': 'No such room', 'err.Not joined': 'Not joined', 'err.Every room is busy, try again shortly': 'Every room is busy, try again shortly',
  'err.That room is full': 'That room is full', 'err.Unknown room size': 'Unknown room size', 'err.Unknown mode': 'Unknown mode',
  'err.That map does not host this room': 'That map does not host this room', 'err.No room with that code': 'No room with that code',
  'err.That room is gone; try Quick Play': 'That room is gone; press Play online',
} as const;

export type Key = keyof typeof en;

/** Traditional Chinese (Taiwan). SWAT 特警, Militia 民兵; weapon names stay the real guns' names. */
const zhTW: Record<Key, string> = {
  'team.0': '特警', 'team.1': '民兵',
  'team.short.0': '特警', 'team.short.1': '民兵',
  'mode.elimination': '殲滅戰', 'mode.sabotage': '爆破戰',
  'size.duel': '單挑', 'size.squad': '小隊', 'size.war': '大戰',
  'common.join': '加入', 'common.full': '已滿', 'common.free': '免費', 'common.close': '關閉',
  'common.seconds': '{n} 秒', 'common.players': '{n}/{max} 名玩家',

  'brand.name': '角頭械鬥', 'brand.alt': 'Turf War: Taipei',
  'lobby.title': '特警', 'lobby.titleVs': '對決民兵',
  'lobby.defaultName': '玩家{n}', 'lobby.fallbackName': '玩家',
  'lobby.callsign': '呼號', 'lobby.team': '隊伍', 'lobby.auto': '自動',
  'lobby.playOnline': '線上對戰', 'lobby.roomSize': '房間人數',
  'lobby.loading': '載入中…', 'lobby.loadingPct': '載入中 {n}%',
  'lobby.filters': '對戰條件', 'lobby.more': '更多玩法',
  'lobby.field.mode': '模式', 'lobby.field.map': '地圖', 'lobby.field.bots': '電腦玩家', 'lobby.field.size': '人數', 'lobby.field.skill': '電腦難度',
  'lobby.any': '不限', 'lobby.anyMap': '不限地圖', 'lobby.anyMapSub': '每場對戰輪替',
  'lobby.chooseMap': '選擇地圖', 'lobby.mapsFor': '{size} 地圖', 'lobby.playing': '{n} 人在玩', 'lobby.noSites': '沒有炸彈點',
  'lobby.mapResetSize': '{map} 不開放 {size}，地圖已改回「不限」', 'lobby.mapResetMode': '{map} 沒有炸彈點，地圖已改回「不限」',
  'lobby.bots.on': '補滿空位', 'lobby.bots.off': '僅限真人',
  'lobby.skill.recruit': '新兵', 'lobby.skill.veteran': '老兵', 'lobby.skill.elite': '菁英',
  'lobby.solo': '單人對戰電腦', 'lobby.sub.range': '練習場', 'lobby.sub.create': '私人房間',
  'lobby.createRoom': '建立房間',
  'lobby.createHint': '採用上方的人數、模式與地圖（「不限」會隨機挑選）。進入對戰後會拿到一組四碼代碼，分享給朋友即可加入。',
  'lobby.roomCode': '房間代碼', 'lobby.codeShort': '代碼', 'lobby.codeHint': '輸入四碼代碼加入私人房間',
  'lobby.startMatch': '開始對戰',
  'lobby.botsHint': '離線自訂對戰：雙方空位都由電腦玩家補滿。採用上方的人數、模式與地圖，「不限」會隨機挑選。',
  'lobby.rangeHint': '沒有電腦玩家、商店免費、不限回合：在上方選的地圖試遍每把槍與配件（「不限」會隨機挑選）。',
  'lobby.controls': '操作說明', 'lobby.settings': '設定',
  'lobby.joining': '加入中…', 'lobby.starting': '啟動中…',
  'lobby.warmup': '暖身中', 'lobby.matchOver': '對戰結束', 'lobby.round': '第 {n} 回合',
  'lobby.connecting': '正在連線至對戰伺服器…',
  'lobby.serverOffline': '伺服器離線 — 仍可單人對戰電腦或進入練習場',
  'lobby.playJoins': '將加入 {map} · {mode} · {players}',
  'lobby.opensAny': '目前沒有符合的房間 — 將開新房間，每場對戰後輪替地圖',
  'lobby.opensFixed': '目前沒有符合的房間 — 將開新房間，固定為{rules}',
  'lobby.liveRooms': '進行中的房間', 'lobby.matching': '符合條件',
  'lobby.noMatches': '目前沒有符合的房間 — 按「線上對戰」就會開一間',
  'lobby.showing': '顯示 {m} 個房間中的 {n} 個', 'lobby.clearFilters': '清除篩選', 'lobby.otherSizes': '其他人數：',
  'lobby.fixedMap': '固定此地圖', 'lobby.fixedMode': '固定此模式',
  'lobby.liveTitle': '已連線 · {db} · 電腦玩家補滿空位，真人加入時自動讓位',
  'lobby.roomCount.one': '1 個房間', 'lobby.roomCount.other': '{n} 個房間',
  'lobby.playerCount.one': '1 名玩家', 'lobby.playerCount.other': '{n} 名玩家',
  'lobby.roomAria': '{map} {mode} {size}，{n}/{max} 名玩家，{status}',
  'server.label': '伺服器', 'server.region.usEast': '美東', 'server.region.local': '本機',
  'server.ms': '{n} ms', 'server.ping': '延遲 {ms}', 'server.measuring': '正在測量延遲…',
  'server.pingTitle': '到{server}伺服器的延遲：往返時間，取最近 {n} 次的中位數',
  'lobby.sitesAB': '炸彈點 A · B', 'lobby.siteA': '炸彈點 A',
  'lobby.mapRotation': '地圖輪替', 'lobby.bigMaps': '大地圖', 'lobby.newRoom': '新房間',
  'lobby.bombSites.one': '1 個炸彈點', 'lobby.bombSites.other': '{n} 個炸彈點',
  'lobby.couldNotJoin': '無法加入：{error}',
  'lobby.unableToStart': '無法啟動：{error}。需要支援 WebGL2 的桌面瀏覽器。',
  'lobby.noServer': '此版本未設定 SpacetimeDB 伺服器，仍可離線對戰電腦。',
  'lobby.bench': '執行 {n} 秒效能檢測',
  'lobby.credits': '角色、武器與道具：Quaternius 的 CC0 素材包。槍聲：CC0 Free Firearm Sound Library。貼圖：CC0 Poly Haven。字型：Rajdhani 與 Noto Sans TC（OFL）。未使用任何專有遊戲素材。',

  'net.connecting': '正在連線至 SpacetimeDB…', 'net.joining': '正在進入戰場…',
  'net.timeout': '連線至對戰伺服器逾時。', 'net.subscription': '資料訂閱失敗。',
  'net.unreachable': '無法連上對戰伺服器（{error}）。', 'net.refused': '連線遭拒',
  'net.disconnected': '已斷線', 'net.room': '房間 {code} · {size}', 'net.quick': '公開房間 {size}', 'net.online': '線上',
  'net.players.one': '1 名玩家', 'net.players.other': '{n} 名玩家',
  'net.solo': '單人', 'net.practice': '練習場',

  'bench.title': '效能檢測', 'bench.met': '此裝置達到 60 fps 目標', 'bench.notMet': '此裝置未達 60 fps 目標',
  'bench.about': '暖機後進行 {n} 秒的腳本戰鬥。瀏覽器的幀率上限為螢幕更新率，因此 120 Hz 螢幕可能超過 60。「達到」代表平均至少 58 fps，且 95% 的影格在 18.2 ms 內完成。',
  'bench.copy': '複製結果', 'bench.copied': '已複製', 'bench.again': '再測一次', 'bench.menu': '返回主選單',
  'bench.warming': '效能檢測 · 暖機中', 'bench.left': '效能檢測 · 剩 {n} 秒',
  'bench.avg': '平均', 'bench.low': '1% 低點', 'bench.frame': '影格時間（中位數 / p95 / p99）', 'bench.slowest': '最慢影格',
  'bench.slow': '低於 60 Hz 的影格', 'bench.cpu': '主執行緒時間（中位數 / p95）', 'bench.draws': '繪製呼叫 · 三角形',
  'bench.hitches': '超過 100 ms 的卡頓 · 著色器編譯', 'bench.setup': '地圖 · 畫質 · 解析度', 'bench.gpu': 'GPU',

  'set.title': '設定', 'set.sections': '設定分頁', 'set.options': '選項', 'set.controls': '操作',
  'set.close': '關閉設定', 'set.closeEsc': '關閉（Esc）',
  'set.paused': '已暫停', 'set.menuOnline': '選單 — 對戰仍在進行',
  'set.hintResume': '繼續', 'set.hintFullscreen': '全螢幕', 'set.resume': '繼續遊戲', 'set.leave': '離開對戰',
  'set.sens': '滑鼠靈敏度', 'set.ads': '瞄準靈敏度',
  'set.adsTip': '1.00 = 一致：瞄準時依瞄具倍率換算滑鼠移動，開鏡與不開鏡的手感相同。數值越低，瞄準時越慢。',
  'set.matched': '一致', 'set.fov': '視野', 'set.horizontal': '水平 {n}°',
  'set.vol': '音效音量', 'set.music': '選單音樂', 'set.off': '關閉',
  'set.language': '語言',
  'set.crosshair': '準星', 'set.cross.classic': '經典', 'set.cross.dot': '圓點', 'set.cross.circle': '圓圈', 'set.cross.t': 'T 字',
  'set.scope': '狙擊鏡顯示', 'set.scope.pip': '鏡內放大', 'set.scope.overlay': '全螢幕',
  'set.scope.pipTip': '倍率瞄具只在鏡片內放大，周圍視野維持寬廣',
  'set.scope.overlayTip': '倍率瞄具以黑色目鏡填滿整個畫面',
  'set.rcolor': '準心顏色', 'set.color.red': '紅', 'set.color.green': '綠', 'set.color.amber': '琥珀', 'set.color.white': '白',
  'set.rstyle': '紅點與全像準心', 'set.rstyle.stock': '原廠', 'set.rstyle.dot': '圓點', 'set.rstyle.circle': '圓圈',
  'set.rstyle.chevron': 'V 形', 'set.rstyle.cross': '十字', 'set.rstyle.stockTip': '各瞄具的原廠準心：紅點為圓點，全像瞄準鏡為圈點',
  'set.optic': '瞄具細節', 'set.optic.high': '高', 'set.optic.low': '低',
  'set.optic.highTip': '最平滑的瞄具模型，更清晰的鏡內畫面', 'set.optic.lowTip': '較輕量的瞄具模型與鏡內畫面',
  'set.quality': '畫質', 'set.q.low': '低', 'set.q.medium': '中', 'set.q.high': '高',
  'set.q.lowTip': '無光暈、1k 陰影', 'set.q.mediumTip': '光暈、2k 陰影', 'set.q.highTip': '1.5 倍解析度',
  'key.mouse': '滑鼠', 'key.wheel': '滾輪', 'key.lmb': '左鍵', 'key.rmb': '右鍵',
  'ctl.move': '移動', 'ctl.look': '轉動視角', 'ctl.fire': '射擊', 'ctl.aim': '瞄準（放大）', 'ctl.sprint': '衝刺（消耗體力）',
  'ctl.jump': '跳躍（消耗體力）', 'ctl.crouch': '蹲下', 'ctl.slots': '刀 · 副武器 · 主武器', 'ctl.grenade': '手榴彈',
  'ctl.last': '上一把武器 · 切換武器', 'ctl.reload': '換彈', 'ctl.use': '互動（炸彈、彈藥箱）', 'ctl.store': '商店',
  'ctl.binos': '望遠鏡', 'ctl.chat': '全體聊天 · 隊伍聊天', 'ctl.board': '計分板', 'ctl.menu': '選單（設定）',
  'ctl.fullscreen': '全螢幕', 'ctl.lobby': '返回大廳（於選單中）',

  'hud.hp': '生命', 'hud.sta': '體力', 'hud.kmh': 'KM/H', 'hud.alt': '高度 M',
  'hud.released': '滑鼠已釋放 — 對戰仍在進行', 'hud.clickResume': '點擊繼續', 'hud.leave': '離開對戰',
  'hud.practice': '練習', 'hud.warmup': '暖身', 'hud.matchOver': '對戰結束', 'hud.roundBuy': '第 {n} 回合 · 購買',
  'hud.roundOver': '回合結束', 'hud.round': '第 {n} 回合',
  'hud.practiceSub': '練習場 · 免費商店', 'hud.modeSub': '{mode} · 先贏 {n} 回合',
  'hud.disarming': '拆除炸彈中 · {site}', 'hud.bombArmed': '炸彈已安裝 · {site} · {clock}', 'hud.arming': '安裝炸彈中 · {site}',
  'hud.armSite': '前往炸彈點安裝炸彈', 'hud.defendSites': '守住炸彈點',
  'hud.knife': '刀', 'hud.headshot': '爆頭', 'hud.spectating': '觀戰中', 'hud.next': '下一位',
  'hud.alive': '存活 {n}/{m}', 'hud.player': '玩家', 'hud.k': '殺', 'hud.d': '死', 'hud.a': '助', 'hud.score': '分數', 'hud.cash': '金錢',
  'hud.bot': '電腦', 'hud.boardHead': '{map} · {mode} · 第 {n} 回合 · 先贏 {m} 回合',
  'hud.chatDead': '*陣亡*', 'hud.chatTeam': '*隊伍*', 'hud.chatAll': '全體', 'hud.chatTeamLabel': '隊伍',
  'hud.matchDrawn': '對戰平手', 'hud.winMatch': '{team} 贏得對戰', 'hud.draw': '平手', 'hud.victory': '勝利', 'hud.defeat': '敗北',
  'hud.newMatchIn': '{n} 秒後開始新對戰', 'hud.playAgain': '再玩一次', 'hud.leaveMatch': '離開對戰',
  'hud.leaderboard': '伺服器排行榜', 'hud.hs': '爆頭', 'hud.rounds': '回合', 'hud.matches': '對戰',
  'hud.store': 'B 商店', 'hud.storeLeft': 'B 商店 · {n} 秒',
  'hud.arming2': '安裝中', 'hud.disarming2': '拆除中',
  'hud.passenger': '乘客', 'hud.exit': '下車', 'hud.fly': '飛行', 'hud.mouseTurn': '滑鼠轉向', 'hud.up': '上升', 'hud.down': '下降',
  'hud.view': '視角', 'hud.drive': '油門 / 煞車', 'hud.steer': '轉向', 'hud.drift': '甩尾', 'hud.fire': '射擊',
  'hud.rideAlong': '搭乘 · {name}', 'hud.enterCar': '駕駛{name}', 'hud.enterScooter': '騎乘{name}', 'hud.enterHeli': '駕駛{name}',
  'hud.holdDisarm': '按住 {key} 拆除炸彈', 'hud.holdArm': '按住 {key} 在 {site} 點安裝炸彈',
  'hud.crate': '彈藥箱', 'hud.youDied': '你陣亡了',
  'hud.goal.elim': '殲滅敵方隊伍', 'hud.goal.attack': '安裝炸彈，或殲滅特警', 'hud.goal.defend': '守住炸彈點，或殲滅民兵',
  'hud.roundDraw': '平手 · 本回合重打', 'hud.winsRound': '{team} 贏得本回合',
  'hud.armedTitle': '炸彈已安裝', 'hud.disarmedTitle': '炸彈已拆除', 'hud.site': '{site} 點',
  'hud.winsMatch': '{team} 贏得對戰', 'hud.newMatch': '新對戰', 'hud.joined': '{name} 加入了{team}',
  'hud.privateToast': '私人房間 {code} · {size} — 朋友輸入此代碼即可加入',
  'reason.eliminated': '全隊殲滅', 'reason.time': '時間到', 'reason.armed': '炸彈已安裝', 'reason.disarmed': '炸彈已拆除', 'reason.exploded': '目標已摧毀',
  'vehicle.car': '汽車', 'vehicle.taxi': '計程車', 'vehicle.scooter': '機車', 'vehicle.heli': '直升機',
  'cause.knife': '刀', 'cause.fall': '墜落', 'cause.bomb': '炸彈', 'cause.vehicle': '車輛爆炸', 'cause.crash': '撞擊', 'cause.roadkill': '輾斃',

  'store.title': '商店', 'store.close': '關閉商店', 'store.cash': '金錢', 'store.free': '免費',
  'store.tab.primary': '主武器', 'store.tab.secondary': '副武器', 'store.tab.tactical': '戰術裝備', 'store.tab.attachments': '配件',
  'class.melee': '近戰武器', 'class.pistol': '手槍', 'class.smg': '衝鋒槍', 'class.rifle': '突擊步槍',
  'class.shotgun': '霰彈槍', 'class.sniper': '狙擊步槍', 'class.lmg': '輕機槍',
  'slot.optic': '瞄具', 'slot.muzzle': '槍口', 'slot.laser': '雷射', 'slot.light': '槍燈', 'slot.counter': '計數器',
  'slot.magazine': '彈匣', 'slot.stock': '槍托', 'slot.ammo': '彈藥',
  'slot.empty.optic': '機械瞄具', 'slot.empty.muzzle': '無槍口配件', 'slot.empty.none': '無', 'slot.empty.standard': '標準', 'slot.empty.ammo': '標準彈',
  'note.irons': '免費的預設瞄具。選用時會拆下已裝的瞄具。',
  'note.reflex': '筒式紅點：圓筒中一顆小而清晰的紅點，略有放大。',
  'note.holo': '全像瞄準鏡：視窗寬廣、圈點準心，放大倍率更高，瞄準更穩。',
  'note.acog': '4 倍稜鏡瞄準鏡，適合中距離交戰。',
  'note.x4': '手槍瞄準鏡：M9A1 專用的 4 倍放大。',
  'note.x6': '狙擊鏡：M110 專用的 6 倍放大。',
  'note.ammoCounter': '沒裝就看不到剩餘彈藥：在槍上與 HUD 顯示彈匣與備彈數。',
  'note.laser': '提升腰射精準度。雷射光束看得見 — 敵人也看得到。',
  'note.flashlight': '照亮前方錐形範圍；後座力略為增加。',
  'note.suppressor': '隱藏曳光彈與槍口火光，開火時也不會出現在敵方小地圖上。傷害略為降低。',
  'note.extendedClip': '每個彈匣裝更多子彈；稍微加重。',
  'note.recoilPad': '減輕後座力；稍微加重。',
  'note.explosiveAmmo': '威力強大，爆頭尤其致命。彈匣容量減少。',
  'note.incendiaryAmmo': '燃燒彈，擊中身體傷害更高。彈匣容量減少。',
  'bar.damage': '傷害', 'bar.headshot': '爆頭', 'bar.rate': '射速', 'bar.accuracy': '精準度', 'bar.aimAcc': '瞄準精準',
  'bar.recoil': '後座力', 'bar.mobility': '機動性',
  'stat.head': '頭部傷害', 'stat.body': '身體傷害', 'stat.limb': '四肢傷害', 'stat.magazine': '彈匣容量',
  'stat.hipAcc': '腰射精準度', 'stat.aimAcc': '瞄準精準度', 'stat.recoil': '後座力', 'stat.aimRecoil': '瞄準後座力',
  'stat.move': '移動速度', 'stat.zoom': '放大倍率', 'stat.summary': '{name} {text}',
  'store.need': '還差 {money}',
  'store.returnToBase': '回到己方基地才能購買武器',
  'store.buyOver': '購買時間已過 — 下一回合開始時才能購買武器',
  'store.frag': '破片手榴彈', 'store.he': '高爆強化', 'store.heUpgrade': 'M67 升級',
  'store.oneM67': '一次只能攜帶一顆 M67 — 丟出後才能再買',
  'store.freeDefault': '免費預設', 'store.onYourGun': '已裝在槍上',
  'store.k.browse': '瀏覽', 'store.k.option': '選項', 'store.k.weapon': '武器', 'store.k.fit': '安裝',
  'store.k.select': '選擇', 'store.k.buy': '雙擊購買', 'store.k.tabs': '分頁', 'store.k.close': '關閉',
  'store.c.free': '免費商店', 'store.c.practice': '練習', 'store.c.buy': '購買時間', 'store.c.weapons': '武器', 'store.c.onSale': '開放購買',
  'store.c.outside': '不在基地', 'store.c.closed': '武器停售', 'store.c.gear': '配件仍可購買',
  'store.lo.primary': '主武器', 'store.lo.secondary': '副武器', 'store.lo.melee': '近戰', 'store.lo.tactical': '戰術',
  'store.noAttachments': '無配件', 'store.knife': '刀', 'store.alwaysCarried': '隨身攜帶', 'store.empty': '無',
  'store.heReady': '高爆強化已備妥', 'store.noGrenade': '沒有手榴彈',
  'badge.equipped': '已裝備', 'badge.owned': '已擁有', 'badge.fitted': '已安裝', 'badge.inUse': '使用中', 'badge.carrying': '攜帶中',
  'store.asideTactical': '手榴彈與升級隨時隨地都能購買。',
  'store.asideWeapons': '買下的武器整場對戰都歸你 — 購買時間內可免費切換。',
  'store.prevWeapon': '上一把武器', 'store.nextWeapon': '下一把武器', 'store.default': '預設',
  'store.equipFree': '裝備 · 免費', 'store.useIrons': '改用機械瞄具 · 免費', 'store.buy': '購買 {price}', 'store.buyFree': '購買 · 免費',
  'store.leaves': '購買後剩 <b>{money}</b>', 'store.haveIt': '已擁有', 'store.ownedSwap': '已擁有 · 免費切換', 'store.price': '價格',
  'store.blast': '爆炸半徑', 'store.appliesTo': '適用', 'store.everyM67': '你丟出的每顆 M67', 'store.fuse': '引信', 'store.carry': '攜帶',
  'store.carryN': '一次 {n} 顆 · 不會補充',
  'store.heNote': '加大裝藥：爆炸範圍縮小，但傷害大幅提升。', 'store.m67Note': '按 4 拔插銷並投擲。擊殺獎勵 $900。',
  'store.replaces': '取代 <b>{name}</b>', 'store.noChange': '數值不變',
  'store.yourWeapon': '你目前裝備的武器', 'store.compared': '與你的 <b>{name}</b> 比較',
  'store.f.magazine': '彈匣', 'store.f.reload': '換彈', 'store.f.fire': '射擊模式', 'store.f.auto': '全自動', 'store.f.semi': '半自動',
  'store.f.zoom': '放大倍率', 'store.f.velocity': '初速', 'store.customize': '自訂配件 →',
  'store.heTitle': 'M67 升級 · 整場有效', 'store.m67Title': '破片手榴彈 · 戰術裝備 · 按鍵 4',
  'store.slotOn': '{slot}槽 · 裝於 {weapon}', 'store.primaryKey': '主武器 · 按鍵 3', 'store.secondaryKey': '副武器 · 按鍵 2',
  'store.previewOff': '無法預覽', 'store.previewHint': '拖曳旋轉 · 滾輪縮放',

  'reward.Kill': '擊殺', 'reward.First kill': '首殺', 'reward.First blood': '首先命中', 'reward.Headshot': '爆頭',
  'reward.Assist': '助攻', 'reward.Last enemy': '最後一名敵人', 'reward.Trade': '換命', 'reward.Bomb armed': '安裝炸彈',
  'reward.Bomb disarmed': '拆除炸彈', 'reward.Round won': '回合勝利', 'reward.Survived': '存活',
  'reward.Last man standing': '最後倖存', 'reward.Loss bonus': '連敗補助', 'reward.Loyalty': '忠誠獎勵',
  'reward.multi': '{n} 連殺', 'reward.streak': '連續擊殺 {n}',

  'err.No such room': '找不到該房間', 'err.Not joined': '尚未加入房間', 'err.Every room is busy, try again shortly': '所有房間都在忙碌中，請稍後再試',
  'err.That room is full': '該房間已滿', 'err.Unknown room size': '未知的房間人數', 'err.Unknown mode': '未知的模式',
  'err.That map does not host this room': '該地圖不支援此房間設定', 'err.No room with that code': '沒有使用此代碼的房間',
  'err.That room is gone; try Quick Play': '該房間已關閉，請改按「線上對戰」',
};

export const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, 'zh-TW': zhTW };

// ---- Names that live in shared/ data (English there; Chinese here) ----

/** Map names and the region line under them ("place / feature"). */
const MAPS_ZH: Record<MapId, { name: string; region: string }> = {
  crane: { name: '起重機', region: '山頂倉儲 / 倒塌的起重機' },
  tower: { name: '塔樓', region: '山坡貨運站' },
  warehouse: { name: '倉庫', region: '貨運站 / 貨箱大廳' },
  pipeline: { name: '輸油管', region: '北方森林 / 抽油站' },
  courtyard: { name: '庭園', region: '圍牆花園 / 藍調時刻' },
  timbertown: { name: '伐木鎮', region: '廢棄莊園 / 木材場' },
  cinder: { name: '灰燼盆地', region: '沙漠 / 科技前哨' },
  frostline: { name: '霜線前哨', region: '凍原 / 中繼站' },
  verdant: { name: '翠綠分水嶺', region: '叢林 / 通訊陣列' },
  ochre: { name: '赭石舊城', region: '沙漠 / 舊城區' },
  citadel: { name: '山城要塞', region: '翠綠高地 / 山頂要塞' },
  railyard: { name: '鐵道貨場', region: '沙漠終點站 / 貨運場' },
  skyline: { name: '天際屋頂', region: '北境生態城 / 上城區' },
  meridian: { name: '子午線街區', region: '沙漠 / 市區' },
  taipei: { name: '西門町', region: '西門町 / 台北' },
  xinyi: { name: '台北101・信義', region: '信義區 / 台北' },
  taipei101: { name: '台北101・88F', region: '高樓辦公層 / 信義區' },
  memorial: { name: '中正紀念堂', region: '中正區 / 台北' },
};

/** Attachment names: the optics in Taiwan players' words (紅點, 全像, ACOG, 倍鏡). */
const ATTACHMENTS_ZH: Record<AttachmentId, string> = {
  irons: '機械瞄具', reflex: '紅點瞄準鏡', holo: '全像瞄準鏡', acog: 'ACOG 瞄準鏡', x4: '4 倍鏡', x6: '6 倍鏡',
  ammoCounter: '彈藥計數器', laser: '雷射瞄準器', flashlight: '戰術槍燈', suppressor: '消音器',
  extendedClip: '擴充彈匣', recoilPad: '後座力緩衝墊', explosiveAmmo: '爆裂彈', incendiaryAmmo: '燃燒彈',
};

// ---- Current language ----

const STORAGE_KEY = 'lawbreaker.lang';
const isLang = (v: string | null | undefined): v is Lang => v === 'en' || v === 'zh-TW';
/** zh-TW, zh-HK, zh-MO and zh-Hant* read Traditional Chinese; other Chinese and everything else English. */
export function langFromLocale(locale: string | undefined): Lang {
  const l = (locale ?? '').toLowerCase();
  return /^zh-(tw|hk|mo|hant)\b/.test(l) ? 'zh-TW' : 'en';
}
/** `?lang=` accepts zh-TW (zh, zh-Hant, tw also work) and en. */
function urlLang(): Lang | undefined {
  if (typeof location === 'undefined') return undefined;
  const v = new URLSearchParams(location.search).get('lang')?.toLowerCase();
  if (!v) return undefined;
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'zh' || v === 'tw' || v.startsWith('zh-')) return 'zh-TW';
  return undefined;
}
function initialLang(): Lang {
  const fromUrl = urlLang();
  if (fromUrl) return fromUrl;
  try { const saved = localStorage.getItem(STORAGE_KEY); if (isLang(saved)) return saved; } catch { /* storage disabled */ }
  return langFromLocale(typeof navigator === 'undefined' ? undefined : navigator.languages?.[0] ?? navigator.language);
}

let current: Lang = initialLang();
const listeners = new Set<(lang: Lang) => void>();
const applyDocumentLang = () => { if (typeof document !== 'undefined') document.documentElement.lang = current; };
applyDocumentLang();

export const lang = () => current;
export const isZh = () => current === 'zh-TW';

/** Switch language (saved for next time) and tell every open screen. */
export function setLang(next: Lang, save = true) {
  if (save) { try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage disabled */ } }
  if (next === current) return;
  current = next;
  applyDocumentLang();
  for (const fn of [...listeners]) fn(next);
}

/** Redraw on language change; returns the unsubscribe function. */
export function onLang(fn: (lang: Lang) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** The current language's text for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>) {
  const text = DICTIONARIES[current][key] ?? en[key];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
/** `<key>.one` for 1, else `<key>.other` (with `{n}`). */
export function plural(base: 'lobby.roomCount' | 'lobby.playerCount' | 'lobby.bombSites' | 'net.players', n: number) {
  return t(`${base}.${n === 1 ? 'one' : 'other'}` as Key, { n });
}

/**
 * Re-translates static markup: `data-i18n="key"` sets the text, `data-i18n-title`, `-aria-label`,
 * `-placeholder` and `-tip` set those attributes (`-tip` is the lobby's `data-tip` tooltip).
 */
export function applyI18n(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as Key); });
  for (const [data, attr] of [['i18nTitle', 'title'], ['i18nAriaLabel', 'aria-label'], ['i18nPlaceholder', 'placeholder'], ['i18nTip', 'data-tip']] as const) {
    root.querySelectorAll<HTMLElement>(`[data-${data.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}]`).forEach(el => el.setAttribute(attr, t(el.dataset[data] as Key)));
  }
}
/** An element whose text follows the language: `<tag data-i18n="key">text</tag>`. */
export const L = (key: Key, tag = 'span', attrs = '') => `<${tag} data-i18n="${key}"${attrs ? ` ${attrs}` : ''}>${escapeHtml(t(key))}</${tag}>`;
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---- Data names ----

export const teamName = (team: number) => t(team === 1 ? 'team.1' : 'team.0');
export const teamShort = (team: number) => t(team === 1 ? 'team.short.1' : 'team.short.0');
export const modeName = (mode: string) => t(mode === 'sabotage' ? 'mode.sabotage' : 'mode.elimination');
export const sizeName = (id: 'duel' | 'squad' | 'war') => t(`size.${id}`);
export const mapName = (id: string, english: string) => (isZh() && MAPS_ZH[id as MapId]?.name) || english;
export const mapRegion = (id: string, english: string) => (isZh() && MAPS_ZH[id as MapId]?.region) || english;
export const attachmentName = (id: AttachmentId, english: string) => (isZh() && ATTACHMENTS_ZH[id]) || english;
export const weaponClass = (c: WeaponClass) => t(`class.${c}`);
export const roundReason = (r: string | undefined) => (r && `reason.${r}` in en ? t(`reason.${r}` as Key) : '');
/** Kill-feed label for a weapon name or cause: guns keep their names, the knife and causes translate. */
export function causeName(cause: string, gunName?: string) {
  if (cause === 'knife') return t('cause.knife');
  if (gunName) return gunName;
  return `cause.${cause}` in en ? t(`cause.${cause}` as Key) : cause.toUpperCase();
}

/** A cash award's reason as sent by the match ("Kill", "3× multi-kill", "5 kill streak"). */
export function rewardReason(reason: string) {
  const key = `reward.${reason}`;
  if (key in en) return t(key as Key);
  const multi = /^(\d+)× multi-kill$/.exec(reason);
  if (multi) return t('reward.multi', { n: multi[1] });
  const streak = /^(\d+) kill streak$/.exec(reason);
  if (streak) return t('reward.streak', { n: streak[1] });
  return reason;
}

/** A reducer's error message (English on the wire), translated when it is one we know. */
export function serverError(message: string) {
  for (const k of Object.keys(en) as Key[]) {
    if (!k.startsWith('err.')) continue;
    const english = k.slice(4);
    if (message.includes(english)) return message.replace(english, t(k));
  }
  return message;
}

export const ZH_DATA = { maps: MAPS_ZH, attachments: ATTACHMENTS_ZH };
