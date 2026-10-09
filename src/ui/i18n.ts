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
  'leave.title': 'Leave the match?', 'leave.why': 'You go back to the lobby; the match carries on without you.',
  'leave.go': 'Leave', 'leave.stay': 'Keep playing',
  'gfx.lost': 'The graphics stopped: the browser lost the graphics card. Reload to keep playing.', 'gfx.reload': 'Reload',
  'cs.title': 'Pick a callsign', 'cs.why': 'Your name on the scoreboard and in the kill feed. You can change it later in the lobby.',
  'cs.placeholder': 'Your nickname', 'cs.play': 'Play', 'cs.close': 'Back to the lobby',
  'cs.empty': 'Type a callsign to play.', 'cs.own': 'Pick a name of your own, not the made-up one.',
  'lobby.roomSize': 'Room size',
  'lobby.loading': 'Loading…', 'lobby.loadingPct': 'Loading {n}%',
  'lobby.more': 'More ways to play',
  'lobby.field.mode': 'Mode', 'lobby.field.map': 'Map', 'lobby.field.bots': 'Bots', 'lobby.field.size': 'Size', 'lobby.field.skill': 'Bot difficulty',
  'lobby.any': 'Any',
  'lobby.chooseMap': 'Choose a map', 'lobby.mapsFor': '{size} maps', 'lobby.playing': '{n} playing', 'lobby.noSites': 'No bomb sites',
  'lobby.bots.on': 'Fill empty slots', 'lobby.bots.off': 'Humans only',
  'lobby.skill.recruit': 'Recruit', 'lobby.skill.veteran': 'Veteran', 'lobby.skill.elite': 'Elite',
  'lobby.solo': 'Solo vs bots', 'lobby.sub.range': 'Practice',
  'lobby.roomCode': 'Room code', 'lobby.codeShort': 'Code', 'lobby.codeHint': 'Join a private room with its four-letter code',
  'lobby.startMatch': 'Start match',
  'lobby.botsHint': 'Your own match, offline: bots fill both teams. Uses the game type, size and map from Start a server.',
  'lobby.rangeHint': 'No bots, a free store and no round limit: try every gun and attachment on the map chosen in Start a server.',
  'lobby.controls': 'Controls', 'lobby.settings': 'Settings',
  'lobby.joining': 'Joining…', 'lobby.starting': 'Starting…',
  'lobby.warmup': 'Warm-up', 'lobby.matchOver': 'Match over', 'lobby.round': 'Round {n}',
  'lobby.connecting': 'Connecting to the match server…',
  'lobby.liveRooms': 'Live rooms',
  'lobby.clearFilters': 'Show all',
  'lobby.fixedMap': 'Stays on this map', 'lobby.fixedMode': 'Stays on this mode',
  'lobby.liveTitle': 'Live · {db} · bots fill empty slots and step aside for players',
  'lobby.roomCount.one': '1 room', 'lobby.roomCount.other': '{n} rooms',
  'lobby.playerCount.one': '1 player', 'lobby.playerCount.other': '{n} players',
  'lobby.roomAria': '{map} {mode} {size}, {n} of {max} players, {status}',
  // Ping to the game server (src/net/ping.ts): the room list's column, its header chip, the play line.
  'server.label': 'Server', 'server.region.usEast': 'US East', 'server.region.taipei': 'Taipei', 'server.region.singapore': 'Singapore', 'server.region.local': 'Local',
  'server.ms': '{n} ms', 'server.ping': 'Ping {ms}', 'server.measuring': 'Measuring ping…',
  'server.pingTitle': 'Ping to the {server} server: round trip, median of the last {n} samples',
  // Choosing the server (Settings → Server, src/net/servers.ts): a development build's own server, and the chips' tooltip.
  'server.choice.dev': 'Dev server', 'server.change': 'Change server',
  // Waking the game server (src/net/wake.ts): it sleeps when nobody plays and boots on the next visit.
  'wake.head': 'Waking the server', 'wake.elapsed': '{n} s',
  'wake.body': 'The server is asleep to save costs — waking it up (about 30 s).',
  'wake.loading': 'Almost there: the server is up and loading the game.',
  'wake.slow': 'Taking a little longer than usual — still trying.',
  'wake.queued': 'Joining as soon as the server is up…', 'wake.cancel': 'Cancel', 'wake.waiting': 'Waiting for the server…',
  'wake.line': 'Waking the server… {n} s', 'wake.chip': 'waking',
  'wake.rooms': 'Waking the server…', 'wake.roomsSub': 'Rooms show up here once it is awake (about 30 s).',
  'wake.downHead': "Can't reach the server", 'wake.downBody': 'It did not wake up within 3 minutes. Solo and Practice still work.',
  'wake.downChip': 'unreachable', 'wake.retry': 'Retry',
  // The three online views: Quick Play, Start a Server, Join a Server.
  'lobby.ways': 'Ways to play online', 'lobby.offline': 'Offline',
  // The footer links: the source on GitHub and the privacy page.
  'lobby.openSource': 'Open source', 'lobby.openSourceTitle': 'The source code on GitHub (opens in a new tab)',
  'lobby.privacy': 'Privacy', 'lobby.siteLinks': 'About this game',
  'tab.quick': 'Quick play', 'tab.quickSub': 'No setup', 'tab.start': 'Start a server', 'tab.startSub': 'Your rules',
  'tab.join': 'Join a server', 'tab.joinSub': 'Rooms · code',
  'quick.tag': 'Any room',
  'quick.noRooms': 'No public rooms right now: Quick Play opens one.',
  'quick.about': 'Drops you into the fullest open public room — any size, map or mode. If none is open, it opens a 6v6 with bots on a random map, and players join as they arrive.',
  'quick.joins': 'Joins {map} · {size} · {n}/{max}', 'quick.opens': 'Opens a new 6v6 room with bots',
  'start.field.mode': 'Game type', 'start.field.visibility': 'Visibility', 'start.go': 'Start',
  'start.public': 'Public', 'start.publicSub': 'In the room list', 'start.private': 'Private', 'start.privateSub': 'Join by code',
  'start.botsOn': 'On', 'start.botsOff': 'Off',
  'start.hintPublic': 'Listed for everyone; Quick Play can fill it. Keeps this map and mode.',
  'start.hintPrivate': 'Hidden from the list: share the 4-letter code shown in game.',
  'start.hintBotsOff': 'No bots: empty slots stay empty.',
  'start.mapSwitchSize': '{map} is not a {size} map — switched to {next}', 'start.mapSwitchMode': '{map} has no bomb sites — switched to {next}',
  'join.all': 'All', 'join.code': 'Private room code', 'join.empty': 'No open rooms yet', 'join.emptyFiltered': 'No rooms match these filters', 'join.noBots': 'No bots',
  'join.private': 'Private', 'join.enterCode': 'Code', 'join.privateTitle': 'Private room',
  'join.privateWhy': 'A private {size} room on {map}. Enter the four-letter code its host shared.', 'join.codeShort': 'A room code has four letters.',
  'join.hidden.one': '1 room hidden by the filters', 'join.hidden.other': '{n} rooms hidden by the filters',
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
  'net.removed': 'You were removed from the match: the server stopped hearing from this browser. Join again any time.',
  'net.lost': 'Lost the connection to the match server.',

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
  'set.server': 'Server', 'set.serverNote': 'Stats are kept separately on each server.',
  'set.serverNext': 'Your current match stays on its server; the change applies from your next match.',
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
  'key.mouse': 'Mouse', 'key.lmb': 'LMB', 'key.mmb': 'MMB', 'key.rmb': 'RMB', 'key.mouseN': 'Mouse {n}',
  'key.wheelUp': 'Wheel ↑', 'key.wheelDown': 'Wheel ↓',
  // Key bindings (Controls tab): groups, actions, and the rebinding flow.
  'grp.movement': 'Movement', 'grp.combat': 'Combat', 'grp.equipment': 'Equipment', 'grp.vehicles': 'Vehicles', 'grp.interface': 'Interface',
  'act.forward': 'Move forward', 'act.back': 'Move back', 'act.left': 'Strafe left', 'act.right': 'Strafe right',
  'act.jump': 'Jump (stamina)', 'act.crouch': 'Crouch · slide', 'act.sprint': 'Sprint (stamina)',
  'act.fire': 'Fire', 'act.aim': 'Aim (zoom) · next spectated player', 'act.reload': 'Reload', 'act.use': 'Use: bomb, ammo crate, get in',
  'act.knife': 'Knife', 'act.secondary': 'Secondary', 'act.primary': 'Primary', 'act.grenade': 'Grenade', 'act.smoke': 'Smoke grenade',
  'act.lastWeapon': 'Last weapon', 'act.nextWeapon': 'Next weapon · scope zoom', 'act.prevWeapon': 'Previous weapon · scope zoom',
  'act.binoculars': 'Binoculars',
  'act.throttle': 'Accelerate · fly forward', 'act.brake': 'Brake, reverse · fly back', 'act.steerLeft': 'Steer left · fly left',
  'act.steerRight': 'Steer right · fly right', 'act.handbrake': 'Handbrake (drift)', 'act.climb': 'Helicopter climb',
  'act.descend': 'Helicopter descend', 'act.vehicleView': 'Toggle view (chase · seat)', 'act.exitVehicle': 'Get out',
  'act.store': 'Store', 'act.storePrevTab': 'Store: previous tab', 'act.storeNextTab': 'Store: next tab',
  'act.scoreboard': 'Scoreboard (hold)', 'act.chat': 'Chat (all)', 'act.teamChat': 'Team chat', 'act.menu': 'Menu (Esc too)',
  'act.fullscreen': 'Fullscreen', 'act.leave': 'Leave match (from the menu)', 'act.look': 'Look',
  'kb.intro': 'Click a key to change it; Esc cancels. The second column holds an optional extra key.',
  'kb.resetAll': 'Reset all to defaults', 'kb.reset': 'Reset', 'kb.resetTip': 'Reset {action} to {keys}',
  'kb.change': 'Change the key for {action}', 'kb.add': 'Add a second key for {action}', 'kb.press': 'Press a key…',
  'kb.pressFor': 'Press a key or mouse button for {action}', 'kb.escCancels': 'cancels', 'kb.cancel': 'Cancel', 'kb.remove': 'Remove this key',
  'kb.taken': '{key} is already used by {others}.', 'kb.swap': 'Swap', 'kb.swapGives': '{others} gets {key}.', 'kb.swapLoses': '{others} keeps its other key.',
  'kb.stranded': '{others} has no other key: change it first.',
  'kb.noSwap': '{others} cannot take {key} in exchange: pick another key.',
  'kb.p.escape': 'Esc is reserved: it always opens and closes the menu.', 'kb.p.os': 'That key belongs to the system.',
  'kb.p.capslock': 'Caps Lock toggles instead of being held, so it cannot be bound.',
  'kb.p.store': '{key} works the store, so actions used in the store cannot take it.',
  'kb.p.menu': '{key} works the menu, so actions used in the menu cannot take it.',
  'kb.p.wheel': 'The wheel only clicks: it cannot be used for {action}.', 'kb.p.invalid': 'That key cannot be bound.',
  'kb.reserved': 'Reserved: Esc (menu and cancel), the Cmd / Windows keys and Caps Lock. In the store the arrows, digits, Enter and Space pick and buy. Vehicle keys only work while you drive, so they can share keys with walking.',
  'kb.readonly': 'Key bindings need a keyboard and mouse: shown read-only on touch screens.',
  'kb.clash': 'Also bound to {others}',

  // ---- Touch controls (phones and tablets) ----
  'tc.fire': 'Fire', 'tc.aim': 'Aim', 'tc.jump': 'Jump', 'tc.crouch': 'Crouch', 'tc.reload': 'Reload', 'tc.use': 'Use',
  'tc.zoom': 'Zoom', 'tc.binoculars': 'Binos', 'tc.knife': 'Knife', 'tc.secondary': 'Secondary', 'tc.primary': 'Primary',
  'tc.grenade': 'Grenade', 'tc.smoke': 'Smoke', 'tc.handbrake': 'Drift', 'tc.climb': 'Up', 'tc.descend': 'Down', 'tc.view': 'View', 'tc.exit': 'Get out',
  'tc.spectate': 'Next', 'tc.menu': 'Menu', 'tc.scoreboard': 'Scores', 'tc.chat': 'Chat', 'tc.store': 'Store',
  'tc.custom1': 'Custom 1', 'tc.custom2': 'Custom 2', 'tc.stick': 'Move stick',
  'tc.use.vehicle': 'Get in', 'tc.use.crate': 'Ammo', 'tc.use.arm': 'Arm', 'tc.use.disarm': 'Defuse',
  'qc.title': 'Quick chat', 'qc.all': 'All', 'qc.team': 'Team', 'qc.type': 'Type a message…', 'qc.close': 'Close',
  'qc.backup': 'Need backup!', 'qc.spotted': 'Enemy spotted', 'qc.goA': 'Going to A', 'qc.goB': 'Going to B',
  'qc.defend': 'Hold the site', 'qc.niceShot': 'Nice shot!', 'qc.thanks': 'Thanks', 'qc.gg': 'Good game',
  'te.title': 'Edit touch layout', 'te.hint': 'Drag a control to move it, pinch or use the slider to resize it. Tap one to select it.',
  'te.size': 'Size', 'te.opacity': 'Opacity', 'te.hide': 'Hide', 'te.show': 'Show', 'te.action': 'Action',
  'te.left': 'Left-handed', 'te.reset': 'Reset', 'te.done': 'Done', 'te.flip': 'Move this bar to the other edge',
  'te.ctxLabel': 'Controls for', 'te.ctx.foot': 'On foot', 'te.ctx.car': 'Driving', 'te.ctx.heli': 'Helicopter', 'te.ctx.dead': 'Spectating',
  'ts.title': 'Touch controls', 'ts.mode': 'On-screen controls', 'ts.auto': 'Auto', 'ts.on': 'On', 'ts.off': 'Off',
  'ts.autoOn': 'Auto: on for this touch screen', 'ts.autoOff': 'Auto: off here (keyboard and mouse)',
  'ts.sens': 'Touch look speed', 'ts.edit': 'Edit touch layout', 'ts.sensDefault': 'Default {n}',
  'ts.autoAim': 'Auto-aim when firing',
  'ts.autoAimNote': 'Hold fire to aim down sights while you shoot; a quick tap fires from the hip. Snipers aim while you hold and fire when you let go.',
  'ts.note': 'Move, resize, hide or add buttons, set their opacity or switch to left-handed. Saved on this device.',
  'rot.title': 'Rotate to landscape', 'rot.sub': 'Turf War plays sideways', 'rot.sideways': 'Turn your phone sideways',
  'inst.title': 'Add to Home Screen — play full screen', 'inst.tipTitle': 'Playing on a phone',
  'inst.install': 'Install', 'inst.dismiss': 'Dismiss',
  'inst.prompt': 'Install the game: it opens full screen from your home screen.',
  'inst.ios': 'Tap Share {share} in the toolbar, then “Add to Home Screen”.',
  'inst.android': 'Open the browser menu ⋮ and tap “Install app” or “Add to Home screen”.',
  'inst.browser': 'It plays right here: just turn your phone sideways. For full screen, open it in your browser (⋯ → Open in browser).',
  'inst.inAppTitle': 'Playing inside an app', 'inst.openChrome': 'Open in Chrome',
  'inst.other': "Use your browser's menu → “Add to Home Screen”.",
  'inst.tip': 'Tip: turn your phone sideways to play · move and resize the buttons in Settings → Controls → Edit touch layout.',

  // ---- HUD ----
  'hud.hp': 'HP', 'hud.sta': 'STA', 'hud.kmh': 'KM/H', 'hud.alt': 'M ALT',
  'hud.released': 'Mouse released — the match continues', 'hud.clickResume': 'Click to resume', 'hud.leave': 'leave match',
  'hud.practice': 'PRACTICE', 'hud.warmup': 'WARMUP', 'hud.matchOver': 'MATCH OVER', 'hud.roundBuy': 'ROUND {n} · BUY',
  'hud.roundOver': 'ROUND OVER', 'hud.round': 'ROUND {n}',
  'hud.practiceSub': 'PRACTICE RANGE · FREE STORE', 'hud.modeSub': '{mode} · FIRST TO {n}',
  'hud.disarming': 'DISARMING {site}', 'hud.bombArmed': 'BOMB ARMED · {site} · {clock}', 'hud.arming': 'ARMING {site}',
  'hud.armSite': 'ARM A BOMB SITE', 'hud.defendSites': 'DEFEND THE BOMB SITES',
  'hud.knife': 'KNIFE', 'hud.headshot': 'Headshot', 'hud.spectating': 'SPECTATING', 'hud.next': 'NEXT', 'hud.deployNext': 'You join the fight at the start of the next round',
  'hud.alive': '{n}/{m} ALIVE', 'hud.player': 'Player', 'hud.k': 'K', 'hud.d': 'D', 'hud.a': 'A', 'hud.score': 'Score', 'hud.cash': 'Cash',
  'hud.bot': 'BOT', 'hud.boardHead': '{map} · {mode} · ROUND {n} · FIRST TO {m}',
  'hud.chatDead': '*DEAD*', 'hud.chatTeam': '*TEAM*', 'hud.chatAll': 'ALL', 'hud.chatTeamLabel': 'TEAM',
  'hud.matchDrawn': 'MATCH DRAWN', 'hud.winMatch': '{team} WIN THE MATCH', 'hud.draw': 'DRAW', 'hud.victory': 'VICTORY', 'hud.defeat': 'DEFEAT',
  'hud.newMatchIn': 'New match in {n}s', 'hud.playAgain': 'Play again', 'hud.leaveMatch': 'Leave match',
  'hud.leaderboard': 'Server leaderboard', 'hud.hs': 'HS', 'hud.rounds': 'Rounds', 'hud.matches': 'Matches',
  'hud.store': '{key} STORE', 'hud.storeLeft': '{key} STORE · {n}s',
  'hud.arming2': 'ARMING', 'hud.disarming2': 'DISARMING',
  'hud.passenger': 'PASSENGER', 'hud.exit': 'EXIT', 'hud.fly': 'FLY', 'hud.mouseTurn': 'MOUSE TURN', 'hud.up': 'UP', 'hud.down': 'DOWN',
  'hud.view': 'VIEW', 'hud.drive': 'DRIVE', 'hud.steer': 'STEER', 'hud.drift': 'DRIFT', 'hud.fire': 'FIRE',
  'hud.rideAlong': 'RIDE ALONG · {name}', 'hud.enterCar': 'DRIVE THE {name}', 'hud.enterScooter': 'RIDE {name}', 'hud.enterHeli': 'FLY {name}',
  'hud.holdDisarm': 'HOLD {key} TO DISARM THE BOMB', 'hud.holdArm': 'HOLD {key} TO ARM THE BOMB AT {site}',
  'hud.crate': 'AMMO CRATE', 'hud.youDied': 'YOU DIED',
  'hud.goal.elim': 'Eliminate the enemy team', 'hud.goal.attack': 'Arm the bomb or eliminate SWAT', 'hud.goal.defend': 'Defend the sites or eliminate the Militia',
  'hud.roundDraw': 'DRAW · ROUND REPLAYS', 'hud.winsRound': '{team} WINS THE ROUND',
  'hud.armedTitle': 'BOMB ARMED', 'hud.disarmedTitle': 'BOMB DISARMED', 'hud.site': 'Site {site}',
  'hud.winsMatch': '{team} wins the match', 'hud.newMatch': 'NEW MATCH',
  'chat.joined': '{name} joined {team}', 'chat.left': '{name} left the match', 'chat.switched': '{name} switched to {team}',
  'team.switch': 'Switch to {team}', 'team.cancel': 'Cancel the switch', 'team.now': 'You switch now.',
  'team.nextRound': 'Takes effect when the next round starts.', 'team.queued': 'You move to {team} when the next round starts.',
  'team.even': 'Only toward the side with fewer players: right now it does not have fewer.',
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
  'store.smoke': 'Smoke grenade', 'store.oneM18': 'You carry one M18 at a time — throw it to buy another',
  'store.cloud': 'Cloud', 'store.lasts': 'Lasts',
  'store.m18Note': 'Throw with {key}. A thick cloud nobody sees through — players or bots. Bullets still pass.',
  'store.m18Title': 'Smoke grenade · tactical · key {key}',
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
  'store.heNote': 'A bigger charge: much more damage in a tighter blast.', 'store.m67Note': 'Cook and throw with {key}. Kills pay $900.',
  'store.replaces': 'Replaces <b>{name}</b>', 'store.noChange': 'No stat change',
  'store.yourWeapon': 'Your equipped weapon', 'store.compared': 'Compared with your <b>{name}</b>',
  'store.f.magazine': 'Magazine', 'store.f.reload': 'Reload', 'store.f.fire': 'Fire', 'store.f.auto': 'Auto', 'store.f.semi': 'Semi',
  'store.f.zoom': 'Zoom', 'store.f.velocity': 'Velocity', 'store.customize': 'Customize attachments →',
  'store.heTitle': 'M67 upgrade · lasts the match', 'store.m67Title': 'Frag grenade · tactical · key {key}',
  'store.slotOn': '{slot} slot · on {weapon}', 'store.primaryKey': 'Primary · key {key}', 'store.secondaryKey': 'Secondary · key {key}',
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
  'leave.title': '確定離開對戰？', 'leave.why': '你會回到大廳，這場對戰會繼續進行。',
  'leave.go': '離開', 'leave.stay': '繼續遊戲',
  'gfx.lost': '畫面中斷了：瀏覽器失去了顯示卡。請重新整理以繼續遊戲。', 'gfx.reload': '重新整理',
  'cs.title': '取個呼號', 'cs.why': '會顯示在計分板與擊殺訊息上，之後可在大廳修改。',
  'cs.placeholder': '你的名字', 'cs.play': '開始', 'cs.close': '返回大廳',
  'cs.empty': '請先輸入呼號。', 'cs.own': '請取一個自己的名字，不要用系統給的。',
  'lobby.roomSize': '房間人數',
  'lobby.loading': '載入中…', 'lobby.loadingPct': '載入中 {n}%',
  'lobby.more': '更多玩法',
  'lobby.field.mode': '模式', 'lobby.field.map': '地圖', 'lobby.field.bots': '電腦玩家', 'lobby.field.size': '人數', 'lobby.field.skill': '電腦難度',
  'lobby.any': '不限',
  'lobby.chooseMap': '選擇地圖', 'lobby.mapsFor': '{size} 地圖', 'lobby.playing': '{n} 人在玩', 'lobby.noSites': '沒有炸彈點',
  'lobby.bots.on': '補滿空位', 'lobby.bots.off': '僅限真人',
  'lobby.skill.recruit': '新兵', 'lobby.skill.veteran': '老兵', 'lobby.skill.elite': '菁英',
  'lobby.solo': '單人對戰電腦', 'lobby.sub.range': '練習場',
  'lobby.roomCode': '房間代碼', 'lobby.codeShort': '代碼', 'lobby.codeHint': '輸入四碼代碼加入私人房間',
  'lobby.startMatch': '開始對戰',
  'lobby.botsHint': '離線自訂對戰：雙方空位都由電腦玩家補滿。採用「開設房間」中的模式、人數與地圖。',
  'lobby.rangeHint': '沒有電腦玩家、商店免費、不限回合：在「開設房間」選的地圖試遍每把槍與配件。',
  'lobby.controls': '操作說明', 'lobby.settings': '設定',
  'lobby.joining': '加入中…', 'lobby.starting': '啟動中…',
  'lobby.warmup': '暖身中', 'lobby.matchOver': '對戰結束', 'lobby.round': '第 {n} 回合',
  'lobby.connecting': '正在連線至對戰伺服器…',
  'lobby.liveRooms': '進行中的房間',
  'lobby.clearFilters': '顯示全部',
  'lobby.fixedMap': '固定此地圖', 'lobby.fixedMode': '固定此模式',
  'lobby.liveTitle': '已連線 · {db} · 電腦玩家補滿空位，真人加入時自動讓位',
  'lobby.roomCount.one': '1 個房間', 'lobby.roomCount.other': '{n} 個房間',
  'lobby.playerCount.one': '1 名玩家', 'lobby.playerCount.other': '{n} 名玩家',
  'lobby.roomAria': '{map} {mode} {size}，{n}/{max} 名玩家，{status}',
  'server.label': '伺服器', 'server.region.usEast': '美東', 'server.region.taipei': '台北', 'server.region.singapore': '新加坡', 'server.region.local': '本機',
  'server.ms': '{n} ms', 'server.ping': '延遲 {ms}', 'server.measuring': '正在測量延遲…',
  'server.pingTitle': '到{server}伺服器的延遲：往返時間，取最近 {n} 次的中位數',
  'server.choice.dev': '開發伺服器', 'server.change': '切換伺服器',
  'wake.head': '正在喚醒伺服器', 'wake.elapsed': '{n} 秒',
  'wake.body': '伺服器休眠中，正在喚醒…（約 30 秒）休眠是為了省成本。',
  'wake.loading': '快好了：伺服器已啟動，正在載入遊戲。',
  'wake.slow': '比平常久一點，仍在持續嘗試。',
  'wake.queued': '伺服器一啟動就自動加入…', 'wake.cancel': '取消', 'wake.waiting': '等待伺服器…',
  'wake.line': '正在喚醒伺服器… {n} 秒', 'wake.chip': '喚醒中',
  'wake.rooms': '正在喚醒伺服器…', 'wake.roomsSub': '伺服器醒來後（約 30 秒），房間就會出現在這裡。',
  'wake.downHead': '無法連上伺服器', 'wake.downBody': '3 分鐘內未能喚醒。仍可單人對戰電腦或進入練習場。',
  'wake.downChip': '無法連線', 'wake.retry': '重試',
  'lobby.ways': '線上玩法', 'lobby.offline': '離線',
  'lobby.openSource': '開放原始碼', 'lobby.openSourceTitle': 'GitHub 上的原始碼（在新分頁開啟）',
  'lobby.privacy': '隱私權', 'lobby.siteLinks': '關於本遊戲',
  'tab.quick': '快速遊戲', 'tab.quickSub': '免設定', 'tab.start': '開設房間', 'tab.startSub': '自訂規則',
  'tab.join': '加入房間', 'tab.joinSub': '房間列表 · 代碼',
  'quick.tag': '任意房間',
  'quick.noRooms': '目前沒有公開房間，按快速遊戲就會開一間。',
  'quick.about': '直接加入人數最多、還有空位的公開房間，不限人數、地圖與模式。沒有空房時，會開一間由電腦玩家補位的 6v6 房間（地圖隨機），其他玩家陸續加入。',
  'quick.joins': '將加入 {map} · {size} · {n}/{max}', 'quick.opens': '將開一間有電腦玩家的 6v6 新房間',
  'start.field.mode': '遊戲模式', 'start.field.visibility': '房間類型', 'start.go': '開始',
  'start.public': '公開', 'start.publicSub': '列在房間列表', 'start.private': '私人', 'start.privateSub': '憑代碼加入',
  'start.botsOn': '開', 'start.botsOff': '關',
  'start.hintPublic': '所有人都能在房間列表看到，快速遊戲也會帶人進來；地圖與模式固定。',
  'start.hintPrivate': '不列在房間列表：分享遊戲中顯示的 4 碼代碼即可加入。',
  'start.hintBotsOff': '無電腦玩家：空位保持空著。',
  'start.mapSwitchSize': '{map} 不開放 {size}，地圖已改為 {next}', 'start.mapSwitchMode': '{map} 沒有炸彈點，地圖已改為 {next}',
  'join.all': '全部', 'join.code': '私人房間代碼', 'join.empty': '目前沒有開放的房間', 'join.emptyFiltered': '沒有符合篩選條件的房間', 'join.noBots': '無電腦玩家',
  'join.private': '私人', 'join.enterCode': '輸入代碼', 'join.privateTitle': '私人房間',
  'join.privateWhy': '{map}的私人 {size} 房間，請輸入房主分享的四碼代碼。', 'join.codeShort': '房間代碼是四個字母。',
  'join.hidden.one': '篩選隱藏了 1 個房間', 'join.hidden.other': '篩選隱藏了 {n} 個房間',
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
  'net.removed': '你已被移出對戰：伺服器太久沒收到這個瀏覽器的訊息，可隨時重新加入。',
  'net.lost': '與對戰伺服器的連線中斷。',

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
  'set.server': '伺服器', 'set.serverNote': '各伺服器的戰績分開記錄。',
  'set.serverNext': '目前這場對戰會留在原本的伺服器，變更從下一場對戰開始生效。',
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
  'key.mouse': '滑鼠', 'key.lmb': '左鍵', 'key.mmb': '中鍵', 'key.rmb': '右鍵', 'key.mouseN': '滑鼠 {n} 鍵',
  'key.wheelUp': '滾輪 ↑', 'key.wheelDown': '滾輪 ↓',
  'grp.movement': '移動', 'grp.combat': '戰鬥', 'grp.equipment': '裝備', 'grp.vehicles': '載具', 'grp.interface': '介面',
  'act.forward': '向前移動', 'act.back': '向後移動', 'act.left': '向左移動', 'act.right': '向右移動',
  'act.jump': '跳躍（消耗體力）', 'act.crouch': '蹲下 · 滑行', 'act.sprint': '衝刺（消耗體力）',
  'act.fire': '射擊', 'act.aim': '瞄準（放大）· 觀戰時切換對象', 'act.reload': '換彈', 'act.use': '互動：炸彈、彈藥箱、上車',
  'act.knife': '刀', 'act.secondary': '副武器', 'act.primary': '主武器', 'act.grenade': '手榴彈', 'act.smoke': '煙霧彈',
  'act.lastWeapon': '切回上一把武器', 'act.nextWeapon': '下一把武器 · 狙擊鏡倍率', 'act.prevWeapon': '前一把武器 · 狙擊鏡倍率',
  'act.binoculars': '望遠鏡',
  'act.throttle': '加速 · 直升機前進', 'act.brake': '煞車、倒車 · 直升機後退', 'act.steerLeft': '左轉 · 直升機左移',
  'act.steerRight': '右轉 · 直升機右移', 'act.handbrake': '手煞車（甩尾）', 'act.climb': '直升機上升',
  'act.descend': '直升機下降', 'act.vehicleView': '切換視角（車後 · 駕駛座）', 'act.exitVehicle': '下車',
  'act.store': '商店', 'act.storePrevTab': '商店：上一個分頁', 'act.storeNextTab': '商店：下一個分頁',
  'act.scoreboard': '計分板（按住）', 'act.chat': '全體聊天', 'act.teamChat': '隊伍聊天', 'act.menu': '選單（Esc 亦可）',
  'act.fullscreen': '全螢幕', 'act.leave': '離開對戰（於選單中）', 'act.look': '轉動視角',
  'kb.intro': '點擊按鍵即可更改，按 Esc 取消。第二欄可另設一個按鍵。',
  'kb.resetAll': '全部恢復預設', 'kb.reset': '重設', 'kb.resetTip': '將「{action}」重設為 {keys}',
  'kb.change': '更改「{action}」的按鍵', 'kb.add': '為「{action}」新增第二個按鍵', 'kb.press': '請按下按鍵…',
  'kb.pressFor': '請為「{action}」按下按鍵或滑鼠按鈕', 'kb.escCancels': '取消', 'kb.cancel': '取消', 'kb.remove': '移除此按鍵',
  'kb.taken': '{key} 已用於「{others}」。', 'kb.swap': '交換', 'kb.swapGives': '「{others}」改用 {key}。', 'kb.swapLoses': '「{others}」保留另一個按鍵。',
  'kb.stranded': '「{others}」沒有其他按鍵，請先更改它。',
  'kb.noSwap': '「{others}」無法改用 {key}，請選擇其他按鍵。',
  'kb.p.escape': 'Esc 為保留鍵：固定用於開啟與關閉選單。', 'kb.p.os': '此按鍵由系統使用。',
  'kb.p.capslock': 'Caps Lock 是切換鍵而非按住，無法設定。',
  'kb.p.store': '{key} 用於商店操作，商店中可用的動作不能使用它。',
  'kb.p.menu': '{key} 用於選單操作，選單中可用的動作不能使用它。',
  'kb.p.wheel': '滾輪只能點按，無法用於「{action}」。', 'kb.p.invalid': '此按鍵無法設定。',
  'kb.reserved': '保留鍵：Esc（選單與取消）、Cmd／Windows 鍵與 Caps Lock。商店內以方向鍵、數字鍵、Enter 與空白鍵選擇及購買。載具按鍵只在駕駛時作用，因此可與步行按鍵相同。',
  'kb.readonly': '按鍵設定需要鍵盤與滑鼠，觸控裝置上僅供檢視。',
  'kb.clash': '同時綁定於「{others}」',

  'tc.fire': '射擊', 'tc.aim': '瞄準', 'tc.jump': '跳躍', 'tc.crouch': '蹲下', 'tc.reload': '換彈', 'tc.use': '互動',
  'tc.zoom': '倍率', 'tc.binoculars': '望遠鏡', 'tc.knife': '刀', 'tc.secondary': '副武器', 'tc.primary': '主武器',
  'tc.grenade': '手榴彈', 'tc.smoke': '煙霧', 'tc.handbrake': '甩尾', 'tc.climb': '上升', 'tc.descend': '下降', 'tc.view': '視角', 'tc.exit': '下車',
  'tc.spectate': '下一位', 'tc.menu': '選單', 'tc.scoreboard': '計分板', 'tc.chat': '聊天', 'tc.store': '商店',
  'tc.custom1': '自訂 1', 'tc.custom2': '自訂 2', 'tc.stick': '移動搖桿',
  'tc.use.vehicle': '上車', 'tc.use.crate': '彈藥', 'tc.use.arm': '安裝', 'tc.use.disarm': '拆除',
  'qc.title': '快速聊天', 'qc.all': '全體', 'qc.team': '隊伍', 'qc.type': '輸入訊息…', 'qc.close': '關閉',
  'qc.backup': '需要支援！', 'qc.spotted': '發現敵人', 'qc.goA': '前往 A 點', 'qc.goB': '前往 B 點',
  'qc.defend': '守住包點', 'qc.niceShot': '打得好！', 'qc.thanks': '謝謝', 'qc.gg': '打得不錯，GG',
  'te.title': '編輯觸控配置', 'te.hint': '拖曳按鈕即可移動，雙指縮放或用滑桿調整大小。輕點按鈕來選取。',
  'te.size': '大小', 'te.opacity': '透明度', 'te.hide': '隱藏', 'te.show': '顯示', 'te.action': '動作',
  'te.left': '左手模式', 'te.reset': '重設', 'te.done': '完成', 'te.flip': '把這列移到另一側',
  'te.ctxLabel': '顯示的操作', 'te.ctx.foot': '步行', 'te.ctx.car': '駕駛', 'te.ctx.heli': '直升機', 'te.ctx.dead': '觀戰',
  'ts.title': '觸控操作', 'ts.mode': '螢幕按鈕', 'ts.auto': '自動', 'ts.on': '開啟', 'ts.off': '關閉',
  'ts.autoOn': '自動：此觸控螢幕已開啟', 'ts.autoOff': '自動：此處關閉（鍵盤與滑鼠）',
  'ts.sens': '觸控視角速度', 'ts.edit': '編輯觸控配置', 'ts.sensDefault': '預設 {n}',
  'ts.autoAim': '按住開火自動瞄準',
  'ts.autoAimNote': '按住開火會舉槍瞄準並持續射擊，快速輕點則為腰射。狙擊槍按住時開鏡瞄準，放開時射擊。',
  'ts.note': '移動、縮放、隱藏或新增按鈕，調整透明度或切換左手模式。設定儲存在這台裝置上。',
  'rot.title': '請將手機轉為橫向', 'rot.sub': '角頭械鬥需要橫向遊玩', 'rot.sideways': '把手機橫過來玩',
  'inst.title': '加到主畫面，全螢幕玩', 'inst.tipTitle': '在手機上遊玩',
  'inst.install': '安裝', 'inst.dismiss': '不再顯示',
  'inst.prompt': '安裝遊戲：從主畫面開啟即為全螢幕。',
  'inst.ios': '點工具列的「分享」{share}，再選「加入主畫面」。',
  'inst.android': '開啟瀏覽器選單 ⋮，點「安裝應用程式」或「加到主畫面」。',
  'inst.browser': '在這裡就能玩：把手機橫過來即可。想要全螢幕，點右上角「⋯」→「在瀏覽器中開啟」。',
  'inst.inAppTitle': '正在 App 內的瀏覽器裡', 'inst.openChrome': '用 Chrome 開啟',
  'inst.other': '使用瀏覽器選單 →「加到主畫面」。',
  'inst.tip': '提示：橫握手機遊玩 · 在「設定 → 操作 → 編輯觸控配置」移動與縮放按鈕。',

  'hud.hp': '生命', 'hud.sta': '體力', 'hud.kmh': 'KM/H', 'hud.alt': '高度 M',
  'hud.released': '滑鼠已釋放 — 對戰仍在進行', 'hud.clickResume': '點擊繼續', 'hud.leave': '離開對戰',
  'hud.practice': '練習', 'hud.warmup': '暖身', 'hud.matchOver': '對戰結束', 'hud.roundBuy': '第 {n} 回合 · 購買',
  'hud.roundOver': '回合結束', 'hud.round': '第 {n} 回合',
  'hud.practiceSub': '練習場 · 免費商店', 'hud.modeSub': '{mode} · 先贏 {n} 回合',
  'hud.disarming': '拆除炸彈中 · {site}', 'hud.bombArmed': '炸彈已安裝 · {site} · {clock}', 'hud.arming': '安裝炸彈中 · {site}',
  'hud.armSite': '前往炸彈點安裝炸彈', 'hud.defendSites': '守住炸彈點',
  'hud.knife': '刀', 'hud.headshot': '爆頭', 'hud.spectating': '觀戰中', 'hud.next': '下一位', 'hud.deployNext': '下回合開始時就會出場',
  'hud.alive': '存活 {n}/{m}', 'hud.player': '玩家', 'hud.k': '殺', 'hud.d': '死', 'hud.a': '助', 'hud.score': '分數', 'hud.cash': '金錢',
  'hud.bot': '電腦', 'hud.boardHead': '{map} · {mode} · 第 {n} 回合 · 先贏 {m} 回合',
  'hud.chatDead': '*陣亡*', 'hud.chatTeam': '*隊伍*', 'hud.chatAll': '全體', 'hud.chatTeamLabel': '隊伍',
  'hud.matchDrawn': '對戰平手', 'hud.winMatch': '{team} 贏得對戰', 'hud.draw': '平手', 'hud.victory': '勝利', 'hud.defeat': '敗北',
  'hud.newMatchIn': '{n} 秒後開始新對戰', 'hud.playAgain': '再玩一次', 'hud.leaveMatch': '離開對戰',
  'hud.leaderboard': '伺服器排行榜', 'hud.hs': '爆頭', 'hud.rounds': '回合', 'hud.matches': '對戰',
  'hud.store': '{key} 商店', 'hud.storeLeft': '{key} 商店 · {n} 秒',
  'hud.arming2': '安裝中', 'hud.disarming2': '拆除中',
  'hud.passenger': '乘客', 'hud.exit': '下車', 'hud.fly': '飛行', 'hud.mouseTurn': '滑鼠轉向', 'hud.up': '上升', 'hud.down': '下降',
  'hud.view': '視角', 'hud.drive': '油門 / 煞車', 'hud.steer': '轉向', 'hud.drift': '甩尾', 'hud.fire': '射擊',
  'hud.rideAlong': '搭乘 · {name}', 'hud.enterCar': '駕駛{name}', 'hud.enterScooter': '騎乘{name}', 'hud.enterHeli': '駕駛{name}',
  'hud.holdDisarm': '按住 {key} 拆除炸彈', 'hud.holdArm': '按住 {key} 在 {site} 點安裝炸彈',
  'hud.crate': '彈藥箱', 'hud.youDied': '你陣亡了',
  'hud.goal.elim': '殲滅敵方隊伍', 'hud.goal.attack': '安裝炸彈，或殲滅特警', 'hud.goal.defend': '守住炸彈點，或殲滅民兵',
  'hud.roundDraw': '平手 · 本回合重打', 'hud.winsRound': '{team} 贏得本回合',
  'hud.armedTitle': '炸彈已安裝', 'hud.disarmedTitle': '炸彈已拆除', 'hud.site': '{site} 點',
  'hud.winsMatch': '{team} 贏得對戰', 'hud.newMatch': '新對戰',
  'chat.joined': '{name} 加入了{team}', 'chat.left': '{name} 離開了對戰', 'chat.switched': '{name} 換到{team}',
  'team.switch': '換到{team}', 'team.cancel': '取消換隊', 'team.now': '立即換隊。',
  'team.nextRound': '下回合開始時生效。', 'team.queued': '下回合開始時會換到{team}。',
  'team.even': '只能換到真人較少的一方，對方目前沒有比較少。',
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
  'store.smoke': '煙霧彈', 'store.oneM18': '一次只能攜帶一顆 M18 — 丟出後才能再買',
  'store.cloud': '煙幕', 'store.lasts': '持續',
  'store.m18Note': '按 {key} 投擲。濃煙擋住所有視線，玩家和機器人都看不穿，但子彈照樣穿過。',
  'store.m18Title': '煙霧彈 · 戰術裝備 · 按鍵 {key}',
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
  'store.heNote': '加大裝藥：爆炸範圍縮小，但傷害大幅提升。', 'store.m67Note': '按 {key} 拔插銷並投擲。擊殺獎勵 $900。',
  'store.replaces': '取代 <b>{name}</b>', 'store.noChange': '數值不變',
  'store.yourWeapon': '你目前裝備的武器', 'store.compared': '與你的 <b>{name}</b> 比較',
  'store.f.magazine': '彈匣', 'store.f.reload': '換彈', 'store.f.fire': '射擊模式', 'store.f.auto': '全自動', 'store.f.semi': '半自動',
  'store.f.zoom': '放大倍率', 'store.f.velocity': '初速', 'store.customize': '自訂配件 →',
  'store.heTitle': 'M67 升級 · 整場有效', 'store.m67Title': '破片手榴彈 · 戰術裝備 · 按鍵 {key}',
  'store.slotOn': '{slot}槽 · 裝於 {weapon}', 'store.primaryKey': '主武器 · 按鍵 {key}', 'store.secondaryKey': '副武器 · 按鍵 {key}',
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

/** Map names. */
const MAPS_ZH: Record<MapId, { name: string }> = {
  crane: { name: '起重機' },
  tower: { name: '塔樓' },
  warehouse: { name: '倉庫' },
  pipeline: { name: '輸油管' },
  courtyard: { name: '庭園' },
  timbertown: { name: '伐木鎮' },
  cinder: { name: '灰燼盆地' },
  frostline: { name: '霜線前哨' },
  verdant: { name: '翠綠分水嶺' },
  ochre: { name: '赭石舊城' },
  citadel: { name: '山城要塞' },
  railyard: { name: '鐵道貨場' },
  skyline: { name: '天際屋頂' },
  meridian: { name: '子午線街區' },
  taipei: { name: '西門町' },
  xinyi: { name: '台北101・信義' },
  taipei101: { name: '台北101・88F' },
  memorial: { name: '中正紀念堂' },
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
export function plural(base: 'lobby.roomCount' | 'lobby.playerCount' | 'lobby.bombSites' | 'net.players' | 'join.hidden', n: number) {
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
