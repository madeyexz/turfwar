// First: it notes whether localStorage was populated before any other module writes to it.
import './visit';
import { inject } from '@vercel/analytics';
import { RETIRED_MAPS, loadMap, mapSummaries } from '../shared/maps/index';
import { cleanCode, notCodeLetters, hasSites, listOrder, mapsFor, pickAnyRoom, ROOM_SIZES, roomFull, sizeLabel } from '../shared/match/rooms';
import { ELIMINATION, SABOTAGE, type Mode, type Team } from '../shared/match/state';
import { assetUrl } from './assetUrl';
import { groundSets, loadAssets, type Assets } from './assets';
import { challengeMap, parseChallenge, parseInvite, type Challenge } from './game/challenge';
import { invitedFriends, onSkinChange } from './game/skins';
import { GOLD_INVITES } from '../shared/skins';
import type { MatchSummary } from './game/matchstats';
import './ui/share.css';
import { Audio } from './audio';
import { Game } from './game/game';
import { setChatDisabled, settings } from './game/settings';
import { loadLayout, matches } from './game/keybinds';
import type { GameLink } from './game/link';
import { OfflineLink } from './game/offline';
import { Bench, BENCH_SECONDS, benchReport, type BenchResult } from './game/bench';
import { onlineAvailable, connectOnline, watchRooms, ConnectError, OnlineLink, type OnlineEntry, type PublicRoom } from './net/online';
import { PING_WINDOW, PingMonitor, hostAnswers, pingAllowed, pingTone, pingUrl, serverHost, serverRegion } from './net/ping';
import { currentServer, gameServerList, onServer, type GameServer, type ServerId } from './net/servers';
import { ConnectDriver, connectSeconds, type ConnectState } from './net/connect';
import { benchFinished, matchJoined, matchLeft, matchNote, setSuper, startAnalytics, track, type PlayKind, type Exit, type Reason } from './analytics';
import { frameTook, lobbyReady, matchFrameStats, matchStarted, noteArrival, playFailed, playPressed } from './growth';
import { LevelView } from './render/level';
import { THEMES } from './render/materials';
import { QUALITY, Renderer } from './render/renderer';
import { renderTheme, THEME_START } from './theme';
import { SkinPanel } from './ui/skinpanel';
import { SettingsMenu, type GraphicsQuality, type SettingsFocus, type SettingsTab } from './ui/settingsmenu';
import { cjkFontReady } from './ui/fonts';
import { drawMapThumb } from './ui/mapthumb';
import { acceptTerms } from './game/consent';
import { L, applyI18n, escapeHtml as esc, isZh, lang, mapName as localMapName, modeName, onLang, plural, serverError, sizeName, t, type Key } from './ui/i18n';
import './style.css';
import './menu.css';
import './ui/lang-zh.css';
import { currentDeviceKind, defaultQuality, gpuRenderer, graphicsHelp, inAppBrowserName, isWebglFailure, readEnv } from './game/device';
import { onTouchLayout, touchActive, touchAimAssist } from './game/touchlayout';
import { InstallBanner } from './ui/installhint';
import { isSideways, onSideways, watchSideways } from './ui/viewport';
import { mountProgressBadge } from './ui/progressbadge';
import { levelOf, loadProgress, onProgress } from './game/progress';
import { mountNews } from './ui/news';
import { mountPrivacyNotice } from './ui/privacynotice';
import { askCallsign, cleanCallsign, madeUpCallsign } from './ui/callsign';
import { ask, confirmDialog } from './ui/ask';
import { reportBootFailure, watchClientErrors } from './errors';
import { registerServiceWorker, warmServiceWorker } from './pwa';
import { CRAZYGAMES, crazyGameplay, crazyInstantMultiplayer, crazyLeftRoom, crazyLinkPlace, crazyLoadingStop, crazyMidgameAd, crazyRoom, crazySettings, crazyUser, linkPlace, onCrazyJoinRoom, onCrazySettings } from './crazygames';

// Vercel Web Analytics exists only on the website (CrazyGames serves the files themselves).
if (!CRAZYGAMES) inject();
registerServiceWorker();

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
/** Everything the lobby remembers lives under `lawbreaker.*` (the HUD reads `lawbreaker.crosshair`). */
const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(`lawbreaker.${k}`) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`lawbreaker.${k}`, v); } catch { /* storage disabled */ } },
};

/** Room sizes (soldiers per team; bots fill every slot a human does not). 24v24 plays on big maps only. */
const SIZES = ROOM_SIZES;
type SizeId = (typeof SIZES)[number]['id'];
const sizeOf = (id: string) => SIZES.find(s => s.id === id) ?? SIZES[1];
const MODE_TAGS: Record<Mode, string> = { elimination: 'E', sabotage: 'S' };
/**
 * The lobby's three online views: Quick Play (no setup), Start a Server (a form) and Join a Server
 * (the live room list and a private room code). Solo and Practice sit under all three.
 */
type Tab = 'quick' | 'start' | 'join';
const TABS: readonly Tab[] = ['quick', 'start', 'join'];
/** Ways into a match: Quick Play, Start, a listed room, a code, and offline Solo and Practice. */
type Action = 'quick' | 'start' | 'room' | 'code' | 'solo' | 'range';
/** How the match is reached, as storage and `?mode=` speak it. */
const modeOf = (a: Action) => a === 'solo' ? 'offline' : a === 'range' ? 'lab' : 'online';

const menu = document.createElement('div');
menu.id = 'menu';
const maps = mapSummaries();
const mapName = (id: string) => localMapName(id, maps.find(m => m.id === id)?.name ?? id);
/**
 * The game server the lobby shows: the one chosen in Settings (src/net/servers.ts). A choice made in
 * the lobby applies at once; one made in a match waits until the lobby is back (`followServer`).
 */
let server: GameServer | undefined = currentServer();
/** More than one server to choose from: the server chips open Settings on the choice. */
const choosable = gameServerList().length > 1;
const online = onlineAvailable();
/** Featured first in the map row's shortcuts: Taipei's two maps, then the usual order. */
const FEATURED = ['taipei', 'xinyi', ...maps.map(m => m.id).filter(id => id !== 'taipei' && id !== 'xinyi')];

const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.84 1.84M7.34 16.66 5.5 18.5M18.5 18.5l-1.84-1.84M7.34 7.34 5.5 5.5"/><circle cx="12" cy="12" r="6.4"/></svg>';
/** A T-shirt: the 外觀 (skins) dialog. */
const SHIRT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3.5 3 6.5l2 4 2.2-1V20.5h9.6V9.5l2.2 1 2-4-5.5-3c-.6 1.6-1.9 2.6-3.5 2.6S9.1 5.1 8.5 3.5z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const CARET = '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
/** GitHub's mark, for the footer's source link. */
const GITHUB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"/></svg>';
/** Discord's mark (Simple Icons, CC0), for the lobby's community button. */
const DISCORD = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
/** The public repository and the privacy page, linked from the lobby's footer. */
const REPO_URL = 'https://github.com/madeyexz/turfwar';
/** The players' Discord server, linked from the lobby's top bar. */
const DISCORD_URL = 'https://discord.gg/ugFv3GzwcD';
/** The website, where the CrazyGames build links its privacy page (CrazyGames serves the game from its own address). */
const SITE_URL = 'https://turfwar.ianhsiao.me';
/**
 * The privacy page in the lobby's language (a `?lang=` visit passes it on; otherwise the page reads the saved choice).
 * On CrazyGames it is our website's page, always with the language (the saved choice lives on their address).
 */
/** "By pressing Play you accept the Terms and Privacy Policy" under the ways to play (not in the CrazyGames build). */
const termsHref = () => `/terms${params.get('lang') ? `?lang=${lang()}` : ''}`;
function renderClickwrap() {
  const el = document.getElementById('clickwrap');
  if (!el) return;
  el.innerHTML = esc(t('lobby.clickwrap', { terms: '\u0001', privacy: '\u0002' }))
    .replace('\u0001', `<a href="${termsHref()}">${esc(t('lobby.terms'))}</a>`).replace('\u0002', `<a href="${privacyHref()}">${esc(t('lobby.privacyPolicy'))}</a>`);
}
const privacyHref = () => CRAZYGAMES ? `${SITE_URL}/privacy?lang=${lang()}` : `/privacy${params.get('lang') ? `?lang=${lang()}` : ''}`;
/** The static about page (how to play, modes, maps, FAQ; crawlable text for search engines, docs/SEO.md) in the lobby's language. */
const aboutHref = () => isZh() ? '/about' : '/en/about';
const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const TAB_ICONS: Record<Tab, string> = {
  quick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  join: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
};

/** Segmented buttons; `items` are [value, label HTML] (labels built with `L` follow the language). */
const choice = (group: string, attr: string, items: [string, string][], label: Key) =>
  `<div class="choices segmented" id="${group}" style="--n:${items.length}" role="group" aria-label="${t(label)}" data-i18n-aria-label="${label}">${items.map(([v, text]) => `<button type="button" class="choice" data-${attr}="${v}"><b>${text}</b></button>`).join('')}</div>`;
/** Segmented buttons with a second line: `items` are [value, label HTML, small HTML]. */
const choice2 = (group: string, attr: string, items: [string, string, string][], label: Key, cls = '') =>
  `<div class="choices segmented ${cls}" id="${group}" style="--n:${items.length}" role="group" aria-label="${t(label)}" data-i18n-aria-label="${label}">${items.map(([v, text, small]) => `<button type="button" class="choice" data-${attr}="${v}"><b>${text}</b><small>${small}</small></button>`).join('')}</div>`;
const sizeItems = (): [string, string, string][] => SIZES.map(s => [s.id, s.label, `${L(`size.${s.id}`)}${s.perTeam > 12 ? ` · ${L('lobby.bigMaps')}` : ''}`]);
const modeTag = (m: Mode) => `<span class="mtag">[${MODE_TAGS[m]}]</span> ${L(`mode.${m}`)}`;
const pop = (id: string, label: Key, body: string) =>
  `<div class="pop" id="${id}" role="dialog" aria-label="${t(label)}" data-i18n-aria-label="${label}" hidden>${body}</div>`;
const field = (label: Key, body: string) => `<div class="frow">${L(label, 'span', 'class="label"')}${body}</div>`;
/** The line under a big button: a status dot, what it will do, and the ping (or `tail` in its place). */
const line = (id: string, tail = `<span class="ping" id="${id}-ping"></span>`) =>
  `<p class="rooms-line" id="${id}-line"><span class="conn"><i></i></span><span class="line-text" id="${id}-hint"></span>${tail}</p>`;
/** "Server · Taipei · 30 ms ▾": which server the lobby shows; with a choice of servers it opens Settings on it. */
const serverChip = (id: string) => `<button type="button" class="server-chip" id="${id}"${choosable ? ' aria-haspopup="dialog"' : ' disabled'} hidden></button>`;
const deploy = (id: string, label: Key, right = '', title?: Key) =>
  `<button type="button" class="deploy" id="${id}"${title ? ` title="${t(title)}" data-i18n-title="${title}"` : ''} disabled><span class="deploy-l">${PLAY}<span class="deploy-t" data-label="${label}">${t('lobby.loading')}</span></span><span class="deploy-r">${right}</span></button>`;

/*
 * Top: the name, team, controls and settings. Left panel: the three online views as tabs (Quick
 * Play, Start a Server, Join a Server), then the offline row (Solo, Practice). Right: the live
 * battlefield backdrop with the map in view. The map picker and Solo's options are popovers.
 */
menu.innerHTML = `
  <header class="top">
    <button type="button" class="mark" id="tab-quick" data-tab="quick" aria-label="${t('lobby.home')}" data-i18n-aria-label="lobby.home"><img src="${assetUrl('icons/icon-192.png')}" width="40" height="40" alt=""><span class="mark-back" aria-hidden="true">‹</span><span class="mark-name">${L('brand.short')}</span></button>
    <div class="who">
      <button type="button" class="profile" id="open-profile" aria-haspopup="dialog" aria-expanded="false" aria-controls="profile-pop"><b id="profile-name"></b><span class="dot" aria-hidden="true">·</span><span id="profile-lv"></span>${CARET}</button>
      <div class="icons">
        <a class="icon-btn discord" id="discord-top" href="${DISCORD_URL}" target="_blank" rel="noopener" data-tip="${t('lobby.discord')}" data-i18n-tip="lobby.discord" aria-label="${t('lobby.discordTitle')}" data-i18n-aria-label="lobby.discordTitle">${DISCORD}</a>
        <button type="button" class="icon-btn" id="open-skins" data-tip="${t('skin.open')}" data-i18n-tip="skin.open" aria-label="${t('skin.title')}" data-i18n-aria-label="skin.title" aria-haspopup="dialog">${SHIRT}</button>
        <button type="button" class="icon-btn" id="open-controls" data-tip="${t('lobby.controls')}" data-i18n-tip="lobby.controls" aria-label="${t('lobby.controls')}" data-i18n-aria-label="lobby.controls" aria-haspopup="dialog">?</button>
        <button type="button" class="icon-btn" id="open-settings" data-tip="${t('lobby.settings')}" data-i18n-tip="lobby.settings" aria-label="${t('lobby.settings')}" data-i18n-aria-label="lobby.settings" aria-haspopup="dialog">${GEAR}</button>
      </div>
    </div>
  </header>
  <section class="side">
    <h1 class="logo" id="logo"></h1>
    <nav class="ways" id="tabs" aria-label="${t('lobby.ways')}" data-i18n-aria-label="lobby.ways">
      ${deploy('quick-go', 'tab.quick', L('quick.tag'), 'quick.about')}
      ${line('quick', serverChip('quick-server'))}
      <button type="button" class="way" id="invite-go" disabled><b>${t('lobby.invite')}</b><span class="ig-goal" id="invite-goal"></span></button>
      <button type="button" class="way" id="tab-start" data-tab="start" aria-controls="view-start">${L('tab.start', 'b')}</button>
      <button type="button" class="way" id="tab-join" data-tab="join" aria-controls="view-join">${L('tab.join', 'b')}</button>
      <button type="button" class="way" id="open-solo" aria-haspopup="dialog" aria-expanded="false" aria-controls="solo-pop">${L('lobby.solo', 'b')}</button>
      <button type="button" class="way" id="go-range" title="${t('lobby.rangeHint')}" data-i18n-title="lobby.rangeHint">${L('lobby.sub.range', 'b')}</button>
    </nav>
    ${CRAZYGAMES ? '' : '<p class="clickwrap" id="clickwrap"></p>'}
    <div class="unreachable" id="unreachable" hidden>
      <div class="unreachable-say" role="status" aria-live="polite">
        <b class="unreachable-head"><span class="conn down"><i></i></span><span id="unreachable-title"></span></b>
        <p id="unreachable-body"></p>
      </div>
      <button type="button" class="sub unreachable-retry" id="unreachable-retry"></button>
    </div>
    <p class="unavailable" id="online-off"></p>
    <div class="status" id="status" role="status"></div>
  </section>
  <section class="page">
    <div class="view" id="view-start" aria-labelledby="start-title" hidden>
      <h2 class="page-head" id="start-title">${L('tab.start')}</h2>
      <div class="filters" role="group" aria-label="${t('tab.start')}" data-i18n-aria-label="tab.start">
        ${field('start.field.mode', choice('smodes', 'smode', [['elimination', modeTag('elimination')], ['sabotage', modeTag('sabotage')]], 'start.field.mode'))}
        ${field('lobby.field.size', choice2('ssizes', 'ssize', sizeItems(), 'lobby.roomSize', 'sizes'))}
        ${field('lobby.field.map', `<div class="mapline">
          <div class="map-grid" id="map-grid" role="group" aria-label="${t('lobby.field.map')}" data-i18n-aria-label="lobby.field.map"></div>
          <p class="notice" id="map-notice" role="status"></p>
        </div>`)}
        ${field('start.field.visibility', choice2('svis', 'svis', [['public', L('start.public'), L('start.publicSub')], ['private', L('start.private'), L('start.privateSub')]], 'start.field.visibility'))}
        ${field('lobby.field.bots', choice2('sbots', 'sbots', [['on', L('start.botsOn'), L('lobby.bots.on')], ['off', L('start.botsOff'), L('lobby.bots.off')]], 'lobby.field.bots'))}
      </div>
      ${deploy('start-go', 'start.go', '<span id="start-summary"></span>')}
      ${line('start')}
    </div>

    <div class="view" id="view-join" aria-labelledby="join-title" hidden>
      <h2 class="page-head" id="join-title">${L('tab.join')}<span class="count" id="rooms-count"></span></h2>
      <div class="filters join-filters">
        ${field('lobby.field.size', choice('jsizes', 'jsize', [['', L('join.all')], ...SIZES.map(s => [s.id, s.label] as [string, string])], 'lobby.roomSize'))}
        ${field('lobby.field.mode', choice('jmodes', 'jmode', [['', L('join.all')], ['elimination', `<span class="mtag">[E]</span><span class="jname"> ${L('mode.elimination')}</span>`], ['sabotage', `<span class="mtag">[S]</span><span class="jname"> ${L('mode.sabotage')}</span>`]], 'lobby.field.mode'))}
      </div>
      <section class="browser" id="browser" aria-labelledby="join-title">
        <div class="browser-head"><b id="rooms-title" data-i18n="lobby.liveRooms">${t('lobby.liveRooms')}</b>${serverChip('rooms-server')}</div>
        <div class="browser-rows" id="rooms" role="list"></div>
        <div class="browser-foot" id="rooms-foot"></div>
      </section>
      <div class="code-row">
        <label class="label" for="roomcode" data-i18n="join.code">${t('join.code')}</label>
        <div class="code-box" title="${t('lobby.codeHint')}" data-i18n-title="lobby.codeHint">
          <span class="hash" aria-hidden="true">#</span>
          <input type="text" id="roomcode" maxlength="4" autocomplete="off" spellcheck="false" placeholder="${t('lobby.codeShort')}" data-i18n-placeholder="lobby.codeShort" aria-label="${t('lobby.roomCode')}" data-i18n-aria-label="lobby.roomCode">
          <button type="button" class="code-go" id="join-go" disabled>${t('common.join')}</button>
        </div>
      </div>
    </div>
  </section>
  <section class="news" id="news" hidden></section>
  <footer class="site-links" aria-label="${t('lobby.siteLinks')}" data-i18n-aria-label="lobby.siteLinks">
    ${CRAZYGAMES ? '' : `<a href="${REPO_URL}" target="_blank" rel="noopener" title="${t('lobby.openSourceTitle')}" data-i18n-title="lobby.openSourceTitle">${GITHUB}${L('lobby.openSource')}</a>
    <span class="dot" aria-hidden="true">·</span>
    <a href="${aboutHref()}" id="about-link">${L('lobby.about')}</a>
    <span class="dot" aria-hidden="true">·</span>`}
    <a href="${privacyHref()}" id="privacy-link"${CRAZYGAMES ? ' target="_blank" rel="noopener"' : ''}>${L('lobby.privacy')}</a>
  </footer>
  ${pop('profile-pop', 'lobby.profile', `<label class="callsign">${L('lobby.callsign', 'span', 'class="label"')}<input type="text" id="callsign" maxlength="16" autocomplete="off" spellcheck="false"></label>
    <div class="prog" id="prog"></div>
    <div class="field">${L('lobby.team', 'span', 'class="label"')}${choice('teams', 'team', [['auto', L('lobby.auto')], ['0', L('team.0', 'span', 'class="swat"')], ['1', L('team.1', 'span', 'class="militia"')]], 'lobby.team')}</div>
    <div class="field">${L('set.server', 'span', 'class="label"')}${serverChip('profile-server')}</div>`)}
  ${pop('solo-pop', 'lobby.solo', `<div class="pop-head"><b>${L('lobby.solo')}</b><small class="rules" id="solo-rules"></small></div>
    <div class="field">${L('start.field.mode', 'span', 'class="label"')}${choice('solo-modes', 'smode', [['elimination', modeTag('elimination')], ['sabotage', modeTag('sabotage')]], 'start.field.mode')}</div>
    <div class="field">${L('lobby.field.size', 'span', 'class="label"')}${choice('solo-sizes', 'ssize', SIZES.map(s => [s.id, s.label] as [string, string]), 'lobby.roomSize')}</div>
    <div class="field">${L('lobby.field.map', 'span', 'class="label"')}<div class="map-grid" id="solo-maps" role="group" aria-label="${t('lobby.field.map')}" data-i18n-aria-label="lobby.field.map"></div></div>
    <div class="field">${L('lobby.field.skill', 'span', 'class="label"')}${choice('skills', 'skill', [['0.25', L('lobby.skill.recruit')], ['0.45', L('lobby.skill.veteran')], ['0.75', L('lobby.skill.elite')]], 'lobby.field.skill')}</div>
    <button type="button" class="go" id="solo-go">${t('lobby.startMatch')}</button>${L('lobby.botsHint', 'p', 'class="hint"')}`)}`;
app.appendChild(menu);
renderClickwrap();
document.body.classList.add('menu-open');

// ---- Phones and tablets: touch controls, the rotate prompt and the install hint. ----
const applyTouchClass = () => document.body.classList.toggle('touch', touchActive());
applyTouchClass();
onTouchLayout(applyTouchClass);
const rotate = document.createElement('div');
rotate.id = 'rotate';
rotate.setAttribute('role', 'alert');
const renderRotate = () => {
  rotate.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21 37h6"/></svg><b>${esc(t('rot.title'))}</b>`;
};
renderRotate();
document.body.appendChild(rotate);
// A screen that stays upright in a match (in-app browsers, rotation lock) plays sideways: the page turns
// and a short tip asks the player to turn the phone.
onSideways(on => {
  document.getElementById('sideways-tip')?.remove();
  if (!on) return;
  const tip = document.createElement('div');
  tip.id = 'sideways-tip';
  tip.setAttribute('role', 'status');
  tip.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="15" y="6" width="18" height="36" rx="3"/><path d="M21 37h6"/></svg><span>${esc(t('rot.sideways'))}</span>`;
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 4600);
});
watchSideways();
// Inside the lobby, so it goes away with it during a match.
// (Not on CrazyGames: the game is theirs to install there.)
if (!params.has('bench') && !CRAZYGAMES) new InstallBanner(menu);
// Level and the day's goal in the profile popover (game/progress.ts); the chip shows the level.
mountProgressBadge(menu.querySelector<HTMLElement>('#prog')!);
onProgress(() => renderProfile());
// 最新更新: the newest entry of src/ui/news.ts.
mountNews(menu.querySelector<HTMLElement>('#news')!);
// CrazyGames: a first-visit note on what the game collects, with the privacy page (src/ui/privacynotice.ts).
if (CRAZYGAMES && !params.has('bench')) mountPrivacyNotice(menu, privacyHref);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => menu.querySelector<T>(sel)!;
const select = (group: string, attr: string, value: string) => menu.querySelectorAll<HTMLButtonElement>(`#${group} [data-${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));

// ---- Initial choices: URL flags first, then what this browser remembered. ----
const MODE_ALIASES: Record<string, string> = { solo: 'offline', practice: 'lab' };
let startMode = params.get('mode') ?? store.get('mode', online.ok ? 'online' : 'offline');
startMode = MODE_ALIASES[startMode] ?? startMode;
const isTab = (v: string | null): v is Tab => !!v && (TABS as readonly string[]).includes(v);
let tab: Tab = isTab(params.get('tab')) ? params.get('tab') as Tab : 'quick';
/**
 * Start a Server's form (Solo and Practice use it too): mode, size, map, public or private, bots.
 * Remembered under `start.*`; a first visit takes the older lobby's size and filters.
 */
let size: SizeId = sizeOf(params.get('size') ?? store.get('start.size', store.get('size', 'squad'))).id;
let mode: Mode = (params.get('game') ?? store.get('start.mode', store.get('lobby.mode', ''))) === 'sabotage' ? 'sabotage' : 'elimination';
let map = params.get('map') ?? store.get('start.map', store.get('lobby.map', ''));
let isPublic = store.get('start.public', '1') !== '0';
let bots = store.get('start.bots', store.get('botsFill', 'on')) !== 'off';
// A remembered map that has since been retired is dropped (a ?map= link still opens it).
if (map && (!maps.some(m => m.id === map) || (RETIRED_MAPS.has(map) && !params.get('map')))) map = '';
// A map from the URL picks the size that plays it (?map=meridian is a 24v24 map) and drops a mode it cannot host.
if (params.get('map') && map) {
  if (!mapsFor(sizeOf(size).perTeam).includes(map) && !params.get('size')) size = SIZES.find(s => mapsFor(s.perTeam).includes(map))?.id ?? size;
  if (mode === 'sabotage' && !hasSites(map)) mode = 'elimination';
}
/** Join a Server's optional list filters ('' = all; every visit starts with every room listed). */
let joinSize: SizeId | '' = '';
let joinMode: Mode | '' = '';
let team = params.get('team') ?? store.get('team', 'auto');
let skill = params.get('skill') ?? store.get('skill', '0.45');
// Phones, tablets and weak graphics (Intel integrated, software) start on low unless the player chose a preset.
let quality = (params.get('quality') ?? store.get('quality', '')) as keyof typeof QUALITY;
if (!QUALITY[quality]) quality = defaultQuality(touchActive(), gpuRenderer());
/** ?bench: scripted solo run that measures frame times on this device (Elimination, Squad unless ?size). */
const benchMode = params.has('bench');
if (benchMode) { mode = 'elimination'; size = sizeOf(params.get('size') ?? 'squad').id; }
const callsign = $<HTMLInputElement>('#callsign');
callsign.value = params.get('name') ?? store.get('name', t('lobby.defaultName', { n: Math.floor(Math.random() * 900 + 100) }));
const roomCode = $<HTMLInputElement>('#roomcode');
roomCode.value = cleanCode(params.get('room') ?? '');
if (roomCode.value && !params.get('tab')) tab = 'join';
const status = $('#status');
if (!online.ok) {
  menu.classList.add('no-server');
  $('#online-off').dataset.i18n = 'lobby.noServer';
  $('#online-off').textContent = t('lobby.noServer');
}

const perTeam = () => sizeOf(size).perTeam;
/** Maps the form's size and mode can play. */
const validMaps = () => mapsFor(perTeam(), mode);
const mapOk = (id: string) => validMaps().includes(id);
/** The first featured map the form can play: where a map the form cannot host moves to. */
const firstMap = () => FEATURED.find(mapOk) ?? validMaps()[0];
if (!mapOk(map)) map = firstMap();

// ---- Live rooms: a light subscription to the server's room rows while the lobby is open. ----
/*
 * The connection driver (src/net/connect.ts) owns the rooms connection: it pings and connects, and gives
 * up (unreachable, Retry) after 30 s. Play buttons pressed meanwhile are queued and run once it is up.
 */
/** A play action held until the server is up; `retried`: it already failed to reach the server once. */
interface Queued { action: Action; room: number; retried: boolean }
let rooms: PublicRoom[] = [];
/** Pings and connects reach the chosen server (choosing another stops the driver and starts it again). */
const lobbyConn = new ConnectDriver<Queued>({
  ping: signal => { const url = server && pingUrl(server.uri); return url ? hostAnswers(url, signal) : Promise.resolve(false); },
  connect: lost => watchRooms(list => { rooms = list; refresh(); }, lost),
}, s => onLobbyConn(s), q => run(q.action, q.room, q.retried));
const phase = () => lobbyConn.state.phase;
/** What the screen last showed of the connection state: a change redraws everything, a tick only the timer. */
let connKey = '';
/** "Server unreachable" is reported to analytics once per page, not on every attempt. */
let unreachableReported = false;
/** The lobby has been connected once on this page (a later connect is a reconnect after a drop). */
let wasReady = false;
function onLobbyConn(s: ConnectState<Queued>) {
  pings.setActive(pingOn && s.phase === 'ready');
  const key = `${s.phase}|${s.queued?.action ?? ''}`;
  if (key === connKey) { renderQuick(); renderStart(); return; }
  const [was, queued] = connKey.split('|');
  connKey = key;
  // A new attempt (or a dropped connection): the old room list is stale. (Stopping keeps it: the
  // room being joined stays on screen while the game connects.)
  if (s.phase !== was && s.phase !== 'ready' && s.phase !== 'idle') rooms = [];
  if (s.phase === 'ready' && was !== 'ready' && (s.slow || s.failures > 0)) {
    const tm = lobbyConn.timings;
    track('connect_slow', {
      seconds: connectSeconds(s, performance.now()), queued: !!queued, failures: s.failures, reconnect: wasReady,
      ...(tm.pingMs !== undefined ? { ping_ms: tm.pingMs, ping_ok: !!tm.pingOk } : {}),
      ...(tm.connectMs !== undefined ? { connect_ms: tm.connectMs } : {}), ...(tm.importMs !== undefined ? { import_ms: tm.importMs } : {}),
    });
  }
  if (s.phase === 'ready') wasReady = true;
  if (s.phase === 'unreachable' && !unreachableReported) { unreachableReported = true; track('error_shown', { where: 'rooms', message: 'server unreachable' }); }
  refresh();
}
function watchLobbyRooms() {
  if (!online.ok || benchMode) { refresh(); return; }
  // A server chosen during a match applies now.
  if (followServer()) lobbyConn.stop();
  lobbyConn.start();
  refresh();
}
/** Analytics super properties for the lobby's server: its database, host and the choice (tw/us). */
const serverProps = () => ({
  online_db: online.ok ? server?.database ?? '' : '', server_host: online.ok && server ? serverHost(server.uri) : '', server_choice: server?.id ?? '',
});
/**
 * The lobby follows the chosen server: pings (the old server is no longer pinged), the room list, the chips and the analytics super properties. True when it changed.
 */
function followServer() {
  const next = currentServer();
  if (next === server) return false;
  pings.untrack(server?.uri);
  server = next;
  rooms = [];
  if (pingOn) pings.track(server?.uri);
  setSuper(serverProps());
  return true;
}
/**
 * A server chosen in Settings: in the lobby, the room list, chips and ping switch at once, and the
 * new server is woken if it scales to zero (a play action waiting for the old one is dropped). In a match,
 * or while joining one, the lobby picks it up when it is back on screen.
 */
onServer(() => {
  if (game || starting || !inMenu) return;
  const watching = phase() !== 'idle';
  if (!followServer()) return;
  lobbyConn.stop();
  if (watching) watchLobbyRooms(); else refresh();
});
function unwatchRooms() {
  lobbyConn.stop();
  pings.setActive(false);
}
/**
 * A lobby left in a background tab lets go of the server: after 5 minutes hidden it disconnects, and
 * on coming back it reconnects with a fresh socket (a phone's may have died meanwhile), and a lobby nobody is
 * looking at holds no connection. Not while a play action waits.
 */
const HIDDEN_LOBBY_MS = 5 * 60_000;
let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('visibilitychange', () => {
  clearTimeout(hiddenTimer);
  if (!online.ok || benchMode || !inMenu) return;
  if (document.visibilityState === 'hidden') {
    hiddenTimer = setTimeout(() => { if (inMenu && document.visibilityState === 'hidden' && !lobbyConn.state.queued) unwatchRooms(); }, HIDDEN_LOBBY_MS);
  } else if (phase() === 'idle') watchLobbyRooms();
});

// ---- Ping: round trip to each room's server, measured only while the lobby is on screen. ----
const pings = new PingMonitor(() => renderPings());
const pingOn = online.ok && !benchMode && pingAllowed(location.search);
if (pingOn) pings.track(server?.uri);
/**
 * Every server choice's ping beside it in Settings: measured only while that dialog is open in the
 * lobby.
 */
const choicePings = new PingMonitor(() => options.refreshPings());
if (pingOn && choosable) for (const s of gameServerList()) choicePings.track(s.uri);
/** A room row's ping: "190 ms" ("—" while measuring); the class colours it. */
function pingHtml(uri: string | undefined) {
  const ms = pings.get(uri);
  return ms === undefined ? '—' : `${ms}<small> ms</small>`;
}
const pingClass = (uri: string | undefined) => { const ms = pings.get(uri); return `ping${ms === undefined ? '' : ` ${pingTone(ms)}`}`; };
/** The chosen server by its name in Settings ("Taipei", "US East", "Dev server"); any other by its region. */
const serverName = (uri: string) => server && uri === server.uri ? t(server.label) : serverRegion(uri);
const pingTitle = (uri: string | undefined) => uri ? t('server.pingTitle', { server: serverName(uri), n: PING_WINDOW }) : '';
/** "Server · Taipei · 30 ms ▾" for the chips; "unreachable" instead of the ping when the server cannot be reached. */
function chipHtml(uri: string) {
  const ms = pings.get(uri), p = phase();
  const value = p === 'unreachable' ? `<span class="ping">${esc(t('connect.downChip'))}</span>`
    : `<span class="${pingClass(uri)}">${ms === undefined ? '—' : esc(t('server.ms', { n: ms }))}</span>`;
  return `<span class="server-word">${esc(t('server.label'))} · </span>${esc(serverName(uri))} · ${value}${choosable ? CARET : ''}`;
}
/** Updates the ping cells, the server chips and the lines under the big buttons in place (samples arrive every 4 s). */
function renderPings() {
  menu.querySelectorAll<HTMLElement>('#rooms [data-ping], #quick-rooms [data-ping]').forEach(el => { el.className = pingClass(el.dataset.ping); el.innerHTML = pingHtml(el.dataset.ping); });
  const live = pingOn && !!server && phase() === 'ready';
  // The chips show from the first connection attempt (so the server can be changed meanwhile) and
  // say when the server could not be reached, never an error.
  const chips = pingOn && !!server && phase() !== 'idle';
  for (const chip of [$('#rooms-server'), $('#quick-server'), $('#profile-server')]) {
    chip.hidden = !chips;
    if (!chips || !server) continue;
    const change = choosable ? t('server.change') : '';
    chip.title = [live ? pingTitle(server.uri) : '', change].filter(Boolean).join(' · ');
    const html = chipHtml(server.uri);
    if (chip.dataset.html !== html) { chip.dataset.html = html; chip.innerHTML = html; }
  }
  // Quick Play goes to its target room's server; a started room opens on the chosen server.
  const lines: [string, string | undefined][] = [['#start-ping', server?.uri]];
  for (const [sel, uri] of lines) {
    const el = $(sel), ms = pings.get(uri);
    el.hidden = !live;
    el.className = pingClass(uri);
    el.title = pingTitle(uri);
    el.textContent = ms === undefined ? t('server.measuring') : t('server.ping', { ms: t('server.ms', { n: ms }) });
  }
}

const roomStatus = (r: PublicRoom) => r.phase === 'warmup' ? t('lobby.warmup') : r.phase === 'ended' ? t('lobby.matchOver') : t('lobby.round', { n: r.round });
const players = (n: number, max: number) => t('common.players', { n, max });
const modeLabel = (m: Mode) => `[${MODE_TAGS[m]}] ${modeName(m)}`;
/** The room Quick Play would put us in: the fullest open public room, the lower ping on a tie (the server picks the same way, by fullness). */
const quickTarget = () => pickAnyRoom(rooms, r => pings.get(r.server));
/** A room list's order: public rooms (joinable first, then the most players, then the lowest ping), then private ones the same way. */
const listed = (list: readonly PublicRoom[]) => {
  const ping = (r: PublicRoom) => pings.get(r.server);
  return [...listOrder(list.filter(r => !r.private), ping), ...listOrder(list.filter(r => r.private), ping)];
};
/** Rooms Join a Server lists (every room unless its filters narrow them). */
const shownRooms = () => listed(rooms.filter(r => (!joinSize || r.size === sizeOf(joinSize).perTeam) && (!joinMode || r.mode === joinMode)));
/** Humans in public rooms of the form's size per map: the map picker's live counts. */
function liveByMap() {
  const counts = new Map<string, number>();
  for (const r of rooms) if (r.size === perTeam()) counts.set(r.mapId, (counts.get(r.mapId) ?? 0) + r.humans);
  return counts;
}
/** The form in a few words: "6v6 · Sabotage · Ximending". */
const rulesText = () => [sizeOf(size).label, modeName(mode), mapName(map)].join(' · ');

/**
 * The brand lockup: the game's name in the current language, large, with its second half in the
 * accent (角頭|械鬥, TURF WAR|TAIPEI), and the other language's name and the two sides under it.
 */
const CJK_RE = /[\u3400-\u9fff]/;
function renderBrand() {
  const name = t('brand.name'), alt = t('brand.alt'), logo = $('#logo');
  if (logo.dataset.name === name) return;
  logo.dataset.name = name;
  const split = (s: string) => CJK_RE.test(s) ? [s.slice(0, 2), s.slice(2)] : s.split(/:\s*/);
  const [a, b = ''] = split(name);
  const cjk = (s: string) => CJK_RE.test(s) ? ' lang="zh-TW"' : ' lang="en"';
  logo.innerHTML = `<span class="logo-name${CJK_RE.test(name) ? ' cjk' : ''}"${cjk(name)}>${esc(a)}<em>${esc(b)}</em></span>
    <small class="logo-sub"><span class="logo-alt${CJK_RE.test(alt) ? ' cjk' : ''}"${cjk(alt)}>${esc(alt)}</span><i aria-hidden="true"></i><span>${esc(t('lobby.title'))} <b>${esc(t('lobby.titleVs'))}</b></span></small>`;
  logo.setAttribute('aria-label', `${name} · ${alt}`);
}

// ---- Rendering: everything on screen follows the tab, the form, the rooms and the language. ----
let ready = false;
let starting: Action | undefined;
/** The page was opened from an invite or challenge link still waiting to be accepted: the big white button accepts it (Not now gives Quick Play back). */
let waitingLink: 'invite' | 'challenge' | undefined;
/** The start under way is 邀請朋友's private room (its button says so). */
let inviteStarting = false;
let loadFraction = -1;
let joiningRoom = -1;
const loadingText = () => loadFraction < 0 ? t('lobby.loading') : t('lobby.loadingPct', { n: (loadFraction * 100).toFixed(0) });

/** The home screen (`quick`) or a page over the blurred city (Create room, Join room); the menu marks the open page. */
function renderTabs() {
  for (const id of TABS) {
    const on = id === tab;
    if (id === 'quick') continue;
    $(`#tab-${id}`).setAttribute('aria-current', on ? 'page' : 'false');
    $(`#view-${id}`).hidden = !on;
  }
  menu.dataset.tab = tab;
}

/** The profile chip: the callsign and level (the popover holds the callsign field, progress, team and server). */
function renderProfile() {
  $('#profile-name').textContent = callsign.value.trim() || t('lobby.fallbackName');
  $('#profile-lv').textContent = t('prog.level', { n: levelOf(loadProgress().xp).level });
}

/** The queued action (pressed before the server answered), if any. */
const queuedAction = () => lobbyConn.state.queued?.action;
/** A big button's label: loading, the action under way, waiting for the server, or its name. It stays usable while connecting. */
function renderDeploy(btn: HTMLButtonElement, action: Action, busyText: string, enabled: boolean) {
  const label = btn.querySelector<HTMLElement>('.deploy-t')!;
  const queued = queuedAction() === action;
  const linked = action === 'quick' && waitingLink;
  label.textContent = !ready ? loadingText() : starting ? (starting === action ? busyText : t(label.dataset.label as Key)) : linked ? t(waitingLink === 'invite' ? 'invite.joinFriend' : 'chal.accept') : queued ? t('connect.waiting') : t(label.dataset.label as Key);
  btn.disabled = !ready || !!starting || (!enabled && !linked);
  btn.classList.toggle('queued', queued && !starting);
}

/** The status dot and text under a big button: connecting (or waiting to join), unreachable, or what it will do. */
function renderLine(id: string, action: Action, liveText: string) {
  const el = $(`#${id}-line`);
  el.hidden = !online.ok;
  if (!online.ok) return;
  const p = phase();
  const [state, text] = p === 'ready' ? ['live', liveText]
    : p === 'unreachable' ? ['down', t('connect.downHead')]
    : ['wait', queuedAction() === action ? t('connect.queued') : t('lobby.connecting')];
  el.querySelector('.conn')!.className = `conn ${state}`;
  el.title = p === 'ready' ? t('lobby.liveTitle') : '';
  setText($(`#${id}-hint`), text);
}

/** Text that only changes when it differs (live regions should not re-announce). */
function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }

/** The card over the tabs' views when the server cannot be reached (after 30 s of trying): "Can't reach the server" with Retry. */
function renderUnreachable() {
  const box = $('#unreachable');
  box.hidden = !online.ok || phase() !== 'unreachable';
  if (box.hidden) return;
  setText($('#unreachable-title'), t('connect.downHead'));
  setText($('#unreachable-body'), t('connect.downBody'));
  setText($('#unreachable-retry'), t('connect.retry'));
}

/** 邀請朋友 under Quick Play: opens a private room to send; its corner counts friends toward the 金拖. */
function renderInvite() {
  const btn = $<HTMLButtonElement>('#invite-go');
  btn.hidden = !online.ok;
  btn.disabled = !ready || !!starting;
  btn.querySelector('b')!.textContent = inviteStarting && starting ? t('invite.opening') : t('lobby.invite');
  btn.title = t('invite.sub');
  const have = invitedFriends();
  const goal = $('#invite-goal');
  goal.textContent = have >= GOLD_INVITES ? t('invite.goalDone') : t('invite.goal', { have, n: GOLD_INVITES });
  goal.classList.toggle('done', have >= GOLD_INVITES);
}

/** QUICK PLAY: where it would put you (or that it opens a 6v6 with bots) beside the server chip, and every live room to pick from. */
function renderQuick() {
  renderDeploy($<HTMLButtonElement>('#quick-go'), 'quick', t('lobby.joining'), online.ok);
  renderInvite();
  const target = quickTarget();
  renderLine('quick', 'quick', target ? t('quick.joins', { map: mapName(target.mapId), size: sizeLabel(target.size), n: target.humans, max: target.size * 2 }) : t('quick.opens'));
}

/** START A SERVER: the form, the button and what the room will be. */
function renderStart() {
  select('smodes', 'smode', mode);
  select('ssizes', 'ssize', size);
  select('svis', 'svis', isPublic ? 'public' : 'private');
  select('sbots', 'sbots', bots ? 'on' : 'off');
  renderMapGrid();
  renderDeploy($<HTMLButtonElement>('#start-go'), 'start', t('lobby.starting'), online.ok);
  $('#start-summary').textContent = ready ? `${sizeOf(size).label} · ${t(isPublic ? 'start.public' : 'start.private')}` : '';
  renderLine('start', 'start', t(isPublic ? 'start.hintPublic' : 'start.hintPrivate'));
}

/** A room list's header totals: every public room and everyone in them (whatever filters show). */
function roomTotals() {
  const humans = rooms.reduce((n, r) => n + r.humans, 0);
  return phase() === 'ready' && rooms.length ? `<span class="conn live"><i></i>${plural('lobby.roomCount', rooms.length)} · ${plural('lobby.playerCount', humans)}</span>` : '';
}

/**
 * A live room list: fixed-height rows, each with its ping and JOIN (Join a Server's filtered list,
 * Quick Play's full one). Without rooms it says why: no server, unreachable (Retry),
 * connecting, else `none`. `target` marks the room Quick Play would put you in.
 */
function renderRoomRows(list: HTMLElement, shown: PublicRoom[], none: string, target?: PublicRoom) {
  for (const r of shown) if (pingOn) pings.track(r.server);
  // Keep keyboard focus on the same JOIN button across live updates.
  const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-joinroom]') as HTMLElement | null;
  const focusRoom = focused && list.contains(focused) ? focused.dataset.joinroom : undefined;
  if (!shown.length) {
    const p = phase();
    // The list always says why it is empty (never an empty box); an unreachable server offers Retry.
    const html = !online.ok ? `<div class="empty">${esc(t('lobby.noServer'))}</div>`
      : p === 'unreachable' ? `<div class="empty"><p>${esc(t('connect.downHead'))}</p><button type="button" class="sub" data-unreachable-retry>${esc(t('connect.retry'))}</button></div>`
      : p !== 'ready' ? `<div class="empty">${esc(t('lobby.connecting'))}</div>`
      : none;
    // (Unchanged markup is left alone, so a focused Retry keeps its focus.)
    if (list.dataset.html !== html) { list.dataset.html = html; list.innerHTML = html; }
    return;
  }
  list.dataset.html = '';
  list.innerHTML = shown.map(r => {
    const m = maps.find(x => x.id === r.mapId);
    const aria = t('lobby.roomAria', { map: mapName(r.mapId), mode: modeName(r.mode), size: sizeLabel(r.size), n: r.humans, max: r.size * 2, status: roomStatus(r) });
    const busy = !ready || !!starting || roomFull(r);
    const lock = r.fixedMap || r.fixedMode ? `<span class="fixed" title="${esc([r.fixedMap ? t('lobby.fixedMap') : '', r.fixedMode ? t('lobby.fixedMode') : ''].filter(Boolean).join(' · '))}">${LOCK}</span>` : '';
    // A private room is listed without its code: its button asks for the code (the host shares it).
    const priv = r.private ? `<span class="priv">${LOCK}${esc(t('join.private'))}</span>` : '';
    const button = r.private
      ? `<button type="button" class="join" data-coderoom="${r.room}" aria-label="${esc(`${roomFull(r) ? t('common.full') : t('join.enterCode')} · ${t('join.private')} · ${aria}`)}"${busy ? ' disabled' : ''}>${starting === 'code' && joiningRoom === r.room ? t('lobby.joining') : roomFull(r) ? t('common.full') : t('join.enterCode')}</button>`
      : `<button type="button" class="join" data-joinroom="${r.room}" aria-label="${esc(`${roomFull(r) ? t('common.full') : t('common.join')} · ${aria}`)}"${busy ? ' disabled' : ''}>${starting === 'room' && joiningRoom === r.room ? t('lobby.joining') : roomFull(r) ? t('common.full') : t('common.join')}</button>`;
    return `<div class="room${roomFull(r) ? ' full' : ''}${r === target ? ' target' : ''}${r.private ? ' private' : ''}" role="listitem" data-room="${r.room}"${r.private ? ' data-private="1"' : ''} data-theme="${m?.theme ?? ''}">
      <span class="srv"><span class="srv-name"><b>${esc(mapName(r.mapId))}</b>${lock}${priv}</span><small class="state ${r.phase}">${esc(roomStatus(r))}${r.noBots ? ` · ${esc(t('join.noBots'))}` : ''}</small></span>
      <span class="mode" title="${esc(modeName(r.mode))}"><span class="mtag">[${MODE_TAGS[r.mode]}]</span><span class="mname"> ${esc(modeName(r.mode))}</span></span>
      <span class="size">${sizeLabel(r.size)}</span>
      <span class="players">${r.humans}/${r.size * 2}</span>
      <span class="${pingClass(r.server)}" data-ping="${esc(r.server)}" title="${esc(pingTitle(r.server))}">${pingHtml(r.server)}</span>
      ${button}
    </div>`;
  }).join('');
  if (focusRoom) list.querySelector<HTMLElement>(`[data-joinroom="${focusRoom}"]`)?.focus({ preventScroll: true });
}

/** JOIN A SERVER: the filters, the live rooms they show (fixed-height rows in a box that keeps its size) and the code box. */
function renderJoin() {
  select('jsizes', 'jsize', joinSize);
  select('jmodes', 'jmode', joinMode);
  const shown = shownRooms();
  // Header totals: every public room and everyone in them, whatever the filters show.
  $('#rooms-count').innerHTML = roomTotals();
  renderRoomRows($('#rooms'), shown, rooms.length
    ? `<div class="empty"><p>${esc(t('join.emptyFiltered'))}</p><button type="button" class="link" data-clear>${esc(t('lobby.clearFilters'))}</button></div>`
    : `<div class="empty"><p>${esc(t('join.empty'))}</p><div class="empty-go"><button type="button" class="sub" data-go="quick">${esc(t('tab.quick'))}</button><button type="button" class="sub" data-go="start">${esc(t('tab.start'))}</button></div></div>`);
  // How many rooms the filters hide.
  const foot = $('#rooms-foot');
  const hiddenRooms = rooms.length - shown.length;
  const html = shown.length && hiddenRooms
    ? `<span>${esc(plural('join.hidden', hiddenRooms))}</span><span class="dot" aria-hidden="true">·</span><button type="button" class="link" data-clear>${esc(t('lobby.clearFilters'))}</button>` : '';
  if (foot.innerHTML !== html) foot.innerHTML = html;
  const join = $<HTMLButtonElement>('#join-go');
  roomCode.disabled = !online.ok;
  join.disabled = !ready || !!starting || !online.ok || roomCode.value.length < 4;
  join.textContent = starting === 'code' || queuedAction() === 'code' ? '…' : t('common.join');
}

/** The backdrop's map: Quick Play's target, the form's map, or the first listed room. */
const shownMap = () => tab === 'start' ? map : tab === 'join' ? shownRooms()[0]?.mapId ?? map : quickTarget()?.mapId ?? map;


function renderOthers() {
  select('teams', 'team', team);
  select('skills', 'skill', skill);
  const offlineBusy = !ready || !!starting;
  const solo = $<HTMLButtonElement>('#solo-go'), range = $<HTMLButtonElement>('#go-range');
  solo.disabled = offlineBusy;
  solo.textContent = !ready ? loadingText() : starting === 'solo' ? t('lobby.starting') : t('lobby.startMatch');
  range.disabled = offlineBusy;
  $('#solo-rules').textContent = rulesText();
  // Solo's own mode, size and map: the same choices as 開設房間 (one form, remembered for both).
  select('solo-modes', 'smode', mode);
  select('solo-sizes', 'ssize', size);
  if (openPop?.id === 'solo-pop') renderMapGrid($('#solo-maps'));
}

/** Everything on screen follows the current choices. */
function refresh() {
  renderBrand();
  renderProfile();
  renderTabs();
  renderUnreachable();
  renderQuick();
  renderStart();
  renderJoin();
  renderPings();
  renderOthers();
  showBackdrop();
}

// ---- The form and the filters ----
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** A short note in the map row (e.g. why the map changed); it fades after a few seconds. */
function notice(text: string) {
  const el = $('#map-notice');
  el.textContent = text;
  menu.classList.toggle('noticing', !!text);
  clearTimeout(noticeTimer);
  if (text) noticeTimer = setTimeout(() => notice(''), 4500);
}
/** After a size or mode change: a map the form cannot host moves to the first one it can, with a note. */
function checkMap(reason: 'size' | 'mode') {
  if (mapOk(map)) return;
  const was = mapName(map);
  map = firstMap();
  notice(reason === 'size' ? t('start.mapSwitchSize', { map: was, size: sizeOf(size).label, next: mapName(map) }) : t('start.mapSwitchMode', { map: was, next: mapName(map) }));
}
function saveForm() {
  if (benchMode) return;
  store.set('start.size', size); store.set('start.mode', mode); store.set('start.map', map);
  store.set('start.public', isPublic ? '1' : '0'); store.set('start.bots', bots ? 'on' : 'off');
}
const changed = () => { saveForm(); refresh(); };
function setTab(next: Tab, focus = false) {
  tab = next;
  closePop(false);
  refresh();
  if (focus) $(`#tab-${next}`).focus({ preventScroll: true });
}

const audio = new Audio();
const onClick = (attr: string, fn: (value: string, el: HTMLElement) => void) => menu.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(`[data-${attr}]`);
  // The menu itself carries data-tab (for styling): only its descendants are controls.
  if (!el || el === menu || !menu.contains(el) || (el as HTMLButtonElement).disabled) return;
  fn(el.dataset[attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]!, el);
  audio.ui();
});
onClick('tab', v => setTab(v as Tab));
onClick('go', v => setTab(v as Tab, true));
onClick('smode', v => { mode = v === 'sabotage' ? 'sabotage' : 'elimination'; checkMap('mode'); changed(); });
onClick('ssize', v => { size = sizeOf(v).id; checkMap('size'); changed(); });
onClick('svis', v => { isPublic = v !== 'private'; changed(); });
onClick('sbots', v => { bots = v !== 'off'; changed(); });
onClick('pick', v => { if (mapOk(v)) map = v; notice(''); changed(); });
onClick('jsize', v => { joinSize = SIZES.some(s => s.id === v) ? v as SizeId : ''; changed(); });
onClick('jmode', v => { joinMode = v === 'elimination' || v === 'sabotage' ? v : ''; changed(); });
onClick('clear', () => { joinSize = ''; joinMode = ''; changed(); });
onClick('team', v => { team = v; select('teams', 'team', team); });
onClick('skill', v => { skill = v; select('skills', 'skill', skill); });
onClick('joinroom', v => run('room', Number(v)));
onClick('coderoom', v => askRoomCode(Number(v)));
onClick('unreachable-retry', () => lobbyConn.retry());
$('#unreachable-retry').addEventListener('click', () => { audio.ui(); lobbyConn.retry(); });
roomCode.addEventListener('input', () => {
  const typed = roomCode.value;
  roomCode.value = cleanCode(typed).replace(/[ILO]/g, '');
  // Codes never have I, L, O or digits: say so rather than drop the key silently.
  if (notCodeLetters(typed)) status.textContent = t('join.noLookalikes');
  renderJoin();
});
// A code already in the box (an earlier room's) is replaced by typing, not kept by the 4-letter limit.
roomCode.addEventListener('focus', () => roomCode.select());
callsign.addEventListener('input', renderProfile);
$('#quick-go').addEventListener('click', () => { audio.ui(); quickPressed(); });
/** The big white button: the link the page was opened with if one waits, else Quick Play. */
function quickPressed() {
  if (waitingLink === 'invite') acceptInvite();
  else if (waitingLink === 'challenge') acceptChallenge();
  else run('quick');
}
$('#invite-go').addEventListener('click', () => { audio.ui(); openInviteRoom(); });
$('#start-go').addEventListener('click', () => { audio.ui(); run('start'); });
$('#go-range').addEventListener('click', () => { audio.ui(); run('range'); });
$('#join-go').addEventListener('click', () => { audio.ui(); run('code'); });
$('#solo-go').addEventListener('click', () => { audio.ui(); run('solo'); });
for (const id of ['#rooms']) $(id).addEventListener('dblclick', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('.room');
  if (row) { if (row.dataset.private) askRoomCode(Number(row.dataset.room)); else run('room', Number(row.dataset.room)); }
});
/** A listed private room: ask for its code (the host shares it), then join by code like the Join a Server box. */
function askRoomCode(room: number) {
  const r = rooms.find(x => x.room === room && x.private);
  if (!r || !ready || starting || roomFull(r)) return;
  ask({
    title: t('join.privateTitle'), why: t('join.privateWhy', { map: mapName(r.mapId), size: sizeLabel(r.size) }),
    label: t('lobby.roomCode'), placeholder: t('lobby.codeShort'), go: t('common.join'), close: t('cs.close'), maxLength: 4,
    attrs: 'autocomplete="off" autocapitalize="characters"', clean: cleanCode,
    check: code => code.length === 4 ? { ok: code } : { error: t('join.codeShort') },
    // (The room rides along only to mark its row as joining; the code decides where we go.)
    done: code => { roomCode.value = code; run('code', room); },
  });
}
// The menu: up and down arrows move between its items.
$('#tabs').addEventListener('keydown', e => {
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  const items = Array.from($('#tabs').querySelectorAll<HTMLButtonElement>('button:not(:disabled):not(.server-chip)'));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  items[(i + step + items.length) % items.length].focus();
});

// ---- Popovers: the map picker and Solo. One open at a time; Esc or a click outside closes. ----
let openPop: HTMLElement | undefined;
let popAnchor: HTMLElement | undefined;
function placePop() {
  if (!openPop || !popAnchor) return;
  const a = popAnchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight, margin = 12;
  const p = openPop;
  if (vw <= 700) { p.classList.add('sheet'); p.style.left = p.style.top = ''; return; }
  p.classList.remove('sheet');
  const w = p.offsetWidth, h = p.offsetHeight;
  const left = Math.max(margin, Math.min(a.left, vw - w - margin));
  // Below the anchor if it fits, else above; failing both, beside the panel (over the backdrop), else as low as fits.
  const below = a.bottom + 6, above = a.top - 6 - h;
  // (A sideways phone's compact lobby lays the panel's children out without the panel's own box.)
  const side = $('#tabs').getBoundingClientRect().right + margin;
  const clampTop = (y: number) => Math.max(margin, Math.min(y, vh - h - margin));
  // The menu's popovers (Solo) open beside the menu, over the city, so the menu stays in view.
  const [x, y] = popAnchor.closest('.ways') && side + w <= vw - margin ? [side, clampTop(a.top - 40)]
    : below + h <= vh - margin ? [left, below] : above >= margin ? [left, above]
    : side + w <= vw - margin ? [side, clampTop(a.top - 60)] : [left, clampTop(vh)];
  p.style.left = `${x}px`; p.style.top = `${y}px`;
}
function showPop(id: string, anchor: HTMLElement) {
  if (openPop?.id === id) { closePop(); return; }
  closePop(false);
  openPop = $(`#${id}`); popAnchor = anchor;
  openPop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  placePop();
  const first = openPop.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="true"]') ?? openPop.querySelector<HTMLElement>('button:not(:disabled)');
  first?.focus({ preventScroll: true });
}
function closePop(restore = true) {
  if (!openPop) return;
  openPop.hidden = true;
  popAnchor?.setAttribute('aria-expanded', 'false');
  if (restore && popAnchor && openPop.contains(document.activeElement)) popAnchor.focus({ preventScroll: true });
  openPop = undefined; popAnchor = undefined;
}
$('#open-solo').addEventListener('click', e => { audio.ui(); showPop('solo-pop', e.currentTarget as HTMLElement); renderMapGrid($('#solo-maps')); placePop(); });
$('#open-profile').addEventListener('click', e => { audio.ui(); showPop('profile-pop', e.currentTarget as HTMLElement); });
document.addEventListener('pointerdown', e => {
  if (!openPop) return;
  const target = e.target as Node;
  if (openPop.contains(target) || popAnchor?.contains(target)) return;
  closePop(false);
});
addEventListener('resize', placePop);
menu.addEventListener('scroll', placePop, true);
menu.addEventListener('focusout', e => {
  // Tabbing out of a popover closes it.
  const next = e.relatedTarget as Node | null;
  if (openPop && next && !openPop.contains(next) && next !== popAnchor) closePop(false);
});

/**
 * A map card's picture: the map's screenshot (public/media/maps/<id>.webp, shot by scripts/mapshots.ts),
 * or its top-down plan when there is none or it fails to load. Kept per map and per row (開設房間's
 * and Solo's each hold their own), so redraws (live counts arrive often) move the same loaded element
 * instead of loading it again.
 */
const thumbs = new Map<string, HTMLElement>();
function plan(id: string) {
  const c = document.createElement('canvas');
  c.width = 168; c.height = 96;
  drawMapThumb(c, id);
  return c;
}
function thumb(id: string, row: string) {
  const key = `${row}:${id}`;
  let el = thumbs.get(key);
  if (!el) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.width = 480; img.height = 270;
    img.addEventListener('error', () => { const c = plan(id); thumbs.set(key, c); img.replaceWith(c); }, { once: true });
    img.src = assetUrl(`media/maps/${id}.webp`);
    thumbs.set(key, el = img);
  }
  if (el instanceof HTMLImageElement) el.alt = mapName(id);
  return el;
}
/**
 * A row of map picture cards (開設房間's and Solo's): every map the form's size plays, with its picture, its
 * bomb sites in Sabotage and who is playing; maps the mode cannot host are disabled. Rebuilt only when what it shows changes.
 */
function renderMapGrid(grid = $('#map-grid')) {
  const live = liveByMap();
  // Under the name: the bomb sites in Sabotage, nothing in Elimination (the line keeps its height either way).
  const sites = (m: (typeof maps)[number]) => mode === 'sabotage' ? t(m.sites > 1 ? 'lobby.sitesAB' : m.sites ? 'lobby.siteA' : 'lobby.noSites') : '';
  const fits = mapsFor(perTeam());
  const key = `${fits.join()}|${map}|${mode}|${[...live].join()}|${isZh()}`;
  if (grid.dataset.key === key) return;
  grid.dataset.key = key;
  // The featured maps first (Ximending, Xinyi), as Quick Play rotates them.
  grid.innerHTML = maps.filter(m => fits.includes(m.id)).sort((a, b) => FEATURED.indexOf(a.id) - FEATURED.indexOf(b.id)).map(m => {
    const ok = mapOk(m.id), n = live.get(m.id) ?? 0, note = ok ? sites(m) : t('lobby.noSites');
    return `<button type="button" class="mcard" data-pick="${m.id}" data-theme="${m.theme}" aria-pressed="${m.id === map}"${ok ? '' : ` disabled title="${esc(t('lobby.noSites'))}"`}>
      <span class="thumb" data-thumb="${m.id}"></span>
      <b>${esc(mapName(m.id))}</b>
      <small>${note ? esc(note) : '&nbsp;'}</small>
      <span class="live${n ? ' on' : ''}">${n ? `<i></i>${esc(t('lobby.playing', { n }))}` : '&nbsp;'}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll<HTMLElement>('[data-thumb]').forEach(el => el.appendChild(thumb(el.dataset.thumb!, grid.id)));
  grid.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
// Arrow keys move through the map cards (by rows and columns as laid out).
for (const id of ['#map-grid', '#solo-maps']) $(id).addEventListener('keydown', e => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const cards = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.mcard:not(:disabled)'));
  const i = cards.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const r = cards[i].getBoundingClientRect();
  let next = i;
  if (e.key === 'ArrowLeft') next = Math.max(0, i - 1);
  else if (e.key === 'ArrowRight') next = Math.min(cards.length - 1, i + 1);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = cards.length - 1;
  else {
    // The nearest card in the next row up or down.
    const down = e.key === 'ArrowDown';
    let best = Infinity;
    cards.forEach((c, j) => {
      const q = c.getBoundingClientRect();
      if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) return;
      const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
      if (d < best) { best = d; next = j; }
    });
  }
  cards[next].focus();
});

// ---- Settings and controls: the gear (and ?) open the shared settings menu in its lobby mode. ----
// Key labels follow the keyboard layout where the browser tells us (AZERTY shows A on KeyQ).
void loadLayout();
const clamp01 = (v: string) => Math.max(0, Math.min(1, Number(v) || 0));
const options = new SettingsMenu(document.body, {
  sensitivity: () => undefined, // `settings` is already updated; the next match reads it.
  crosshair: () => undefined, // Saved; the HUD reads `lawbreaker.crosshair` when a match starts.
  quality: q => { quality = q; renderer?.applyQuality(QUALITY[q]); },
  volume: v => audio.setVolume(v),
}, {
  lobby: {
    current: () => ({ volume: audio.volume, music: audio.musicVolume, quality: quality as GraphicsQuality }),
    music: v => audio.setMusicVolume(v),
    previewVolume: () => audio.cash(),
    bench: { label: () => t('lobby.bench', { n: BENCH_SECONDS }), run: () => { location.search = `?bench&map=${shownMap()}&quality=${quality}${params.get('lang') ? `&lang=${params.get('lang')}` : ''}`; } },
    credits: () => t('lobby.credits'),
    // The chosen server's ping is already warm in the lobby's own monitor (the same value as its chips).
    serverPing: s => pings.get(s.uri) ?? choicePings.get(s.uri),
    onClose: () => choicePings.setActive(false),
  },
});

// Language switch (Settings): the lobby's own text follows at once.
onLang(next => {
  renderRotate();
  setSuper({ lang: next });
  track('language_changed', { to: next }, { set: { lang: next } });
  applyI18n(menu);
  $<HTMLAnchorElement>('#privacy-link').href = privacyHref();
  renderClickwrap();
  const about = menu.querySelector<HTMLAnchorElement>('#about-link');
  if (about) about.href = aboutHref();
  $('#map-grid').dataset.key = '';
  if (benchPanel) { benchPanel.remove(); if (benchResult) showBenchResult(benchResult); }
  refresh();
});
const openOptions = (tab: SettingsTab, focus?: SettingsFocus) => {
  audio.ui(); closePop(false);
  choicePings.setActive(pingOn && choosable);
  options.show(false, tab, focus);
};
for (const id of ['#quick-server', '#rooms-server', '#profile-server']) $(id).addEventListener('click', () => openOptions('options', 'server'));
$('#open-settings').addEventListener('click', () => openOptions('options'));
// 外觀: the knife skin and Militia character (src/ui/skinpanel.ts), previewed on the lobby's loaded models.
const skinPanel = new SkinPanel(document.body, () => assets);
$('#open-skins').addEventListener('click', () => { if (assets) skinPanel.show(); });
skinPanel.onInvite = openInviteRoom;
// A friend arriving moves the 金拖 count on the invite button.
onSkinChange(() => { if (ready) renderInvite(); });
$('#discord-top').addEventListener('click', () => track('discord_clicked', { where: 'lobby' }));
$('#open-controls').addEventListener('click', () => openOptions('controls'));

/**
 * Options from storage into `settings` and the audio. Runs at start and again on returning to the
 * lobby: the in-game menu changes the same keys mid-match.
 */
function syncOptions() {
  settings.sensitivity = Math.max(0.2, Math.min(3, Number(store.get('sensitivity', '1')) || 1));
  settings.fov = Math.max(65, Math.min(95, Number(store.get('fov', '78')) || 78));
  settings.adsSensitivity = Math.max(0.5, Math.min(1.5, Number(store.get('adsSensitivity', '1')) || 1));
  audio.setVolume(clamp01(store.get('volume', '0.8')));
  audio.setMusicVolume(clamp01(store.get('music', '0.6')));
  if (game || ready) { const q = store.get('quality', quality) as keyof typeof QUALITY; if (QUALITY[q]) quality = q; }
}

let assets: Assets;
let renderer: Renderer;
let game: Game | undefined;
let backdrop: LevelView | undefined;
let backdropMap: string | undefined;
let bench: Bench | undefined;
let benchBanner: HTMLElement | undefined;
let theme: Promise<AudioBuffer> | undefined;
let inMenu = !benchMode;
let gestured = false;

syncOptions();
refresh();
watchLobbyRooms();
track('lobby_view', {});
// Analytics loads once the lobby is on screen, when the browser is idle: never in the way of the game.
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500));
idle(() => startAnalytics({ lang: lang(), ...serverProps() }));

/** Loops the menu theme once the player has interacted (browsers block audio before a gesture). */
function menuMusic() {
  if (!inMenu || !gestured || !theme) return;
  audio.start();
  void theme.then(buffer => { if (inMenu) audio.playMusic(buffer, THEME_START); }, () => undefined);
}
for (const type of ['pointerdown', 'keydown'] as const) document.addEventListener(type, () => { gestured = true; menuMusic(); });

function showBackdrop() {
  const id = shownMap();
  if (!assets || game || backdropMap === id) return;
  if (backdrop) renderer.scene.remove(backdrop.group);
  const def = loadMap(id).def;
  renderer.setTheme(THEMES[def.theme], def.sun);
  backdrop = new LevelView(assets, def, THEMES[def.theme]);
  backdropMap = id;
  renderer.scene.add(backdrop.group);
}

/**
 * A player still on the made-up callsign is asked for one before playing (automation and `?name=` skip it).
 * Not on CrazyGames: new players land in play with one tap there, as a logged-in player's CrazyGames name or a made-up one.
 */
const needsCallsign = () => !CRAZYGAMES && !benchMode && !params.get('autostart') && !params.has('name') && madeUpCallsign(callsign.value);

// ---- 發起單挑 (src/game/challenge.ts) ----------------------------------------------------------------

/**
 * A start that answers a challenge or opens one: `join` the challenger's room; `fallback` a Solo
 * 1v1 against their bot double (no room in the link, or it is gone, full or unreachable); `host`
 * our own private 1v1 room, opened from an end screen with the share dialog.
 */
type Duel = { kind: 'join'; c: Challenge; mapId: string }
  | { kind: 'fallback'; c: Challenge; mapId: string; reason: 'no_room' | 'gone' | 'offline' }
  | { kind: 'host'; summary: MatchSummary; mapId: string }
  | { kind: 'invite'; mapId: string; mode: Mode }
  | { kind: 'joinInvite'; ref: string };
let special: Duel | undefined;
/** Where this page's link points: on CrazyGames, the invite it was opened with (src/crazygames.ts). */
const place = crazyLinkPlace() ?? location;
/** The challenge this page was opened with. */
const challenge = parseChallenge(place.search, place.pathname);
if (challenge) noteArrival(challenge.ref);
if (challenge) track('challenge_link_opened', { ref: challenge.ref ?? '', has_room: !!challenge.room }, { setOnce: { ref_by: challenge.ref ?? '' } });
/** The private room an invite link (`/r/<code>`) asks this page to join; a challenge link wins if both. */
const invite = challenge ? undefined : parseInvite(place.pathname, place.search);
if (invite) noteArrival(invite.ref);
if (invite) track('invite_link_opened', { ref: invite.ref ?? '' }, { setOnce: { ref_by: invite.ref ?? '' } });

/** 「<name> 向你下戰帖！」 over the lobby: one tap (with the callsign asked for if needed) and you're in. */
let challengeBanner: HTMLElement | undefined;
function showChallenge() {
  if (invite && !challenge && !challengeBanner) return showInvite();
  if (!challenge || challengeBanner) return;
  const c = challenge;
  const el = document.createElement('div');
  el.className = 'challenge-banner';
  el.innerHTML = '<b></b><p></p><div class="acts"><button type="button" class="go"></button><button type="button" class="later"></button></div>';
  el.querySelector('b')!.textContent = t('chal.banner', { name: c.name });
  const where = c.map ? localMapName(c.map, maps.find(m => m.id === c.map)?.name ?? '') : '';
  el.querySelector('p')!.textContent = c.beat !== undefined && where ? t('chal.brag', { n: c.beat, map: where }) : t('chal.plain', { map: where || '1v1' });
  const go = el.querySelector<HTMLButtonElement>('.go')!;
  go.onclick = acceptChallenge;
  el.querySelector<HTMLButtonElement>('.later')!.textContent = t('chal.later');
  el.querySelector<HTMLButtonElement>('.later')!.onclick = () => { el.remove(); waitingLink = undefined; refresh(); };
  challengeBanner = el;
  waitingLink = 'challenge';
  menu.appendChild(el);
  renderChallenge();
}
function renderChallenge() {
  const go = challengeBanner?.querySelector<HTMLButtonElement>('.go');
  if (!go) return;
  go.disabled = !ready;
  go.textContent = ready ? t(challenge ? 'chal.accept' : 'invite.join') : loadingText();
}

/** 「朋友邀你一起打！」 over the lobby for an invite link: one tap joins the friend's private room. */
function showInvite() {
  if (!invite) return;
  const el = document.createElement('div');
  el.className = 'challenge-banner invite-banner';
  el.innerHTML = '<b></b><p></p><div class="acts"><button type="button" class="go"></button><button type="button" class="later"></button></div>';
  el.querySelector('b')!.textContent = t('invite.banner');
  el.querySelector('p')!.textContent = t('invite.bannerBody', { code: invite.room });
  el.querySelector<HTMLButtonElement>('.go')!.onclick = acceptInvite;
  el.querySelector<HTMLButtonElement>('.later')!.textContent = t('chal.later');
  el.querySelector<HTMLButtonElement>('.later')!.onclick = () => { el.remove(); waitingLink = undefined; refresh(); };
  challengeBanner = el;
  waitingLink = 'invite';
  menu.appendChild(el);
  renderChallenge();
}

function acceptInvite() {
  if (!invite || !ready || starting) return;
  challengeBanner?.remove();
  waitingLink = undefined;
  roomCode.value = invite.room;
  if (!online.ok) { status.textContent = t('invite.gone'); return; }
  special = { kind: 'joinInvite', ref: invite.ref ?? '' };
  run('code');
}

/** 邀請朋友: open a private 6v6 (the form's map and mode where they fit) and show the invite dialog in it. */
function openInviteRoom() {
  if (!online.ok || !ready || starting) return;
  const fits = mapsFor(6), mapId = fits.includes(map) ? map : fits[0];
  special = { kind: 'invite', mapId, mode: mode === 'sabotage' && !hasSites(mapId) ? 'elimination' : mode };
  run('start');
}

function acceptChallenge() {
  const c = challenge;
  if (!c || !ready || starting) return;
  const mapId = challengeMap(c.map, mapsFor(1));
  challengeBanner?.remove();
  waitingLink = undefined;
  if (c.room && online.ok) { special = { kind: 'join', c, mapId }; roomCode.value = c.room; run('code'); }
  else { special = { kind: 'fallback', c, mapId, reason: c.room ? 'offline' : 'no_room' }; run('solo'); }
}

/** In a challenge's match: the end screen names the challenger; a room nobody else is in falls back to the bot double. */
function startedDuel(duel: Duel, link: GameLink) {
  if (duel.kind === 'joinInvite') { track('invite_joined', { ref: duel.ref, joined: true }); return; }
  if (duel.kind === 'invite') {
    // As for the 1v1 room: the code arrives a moment after the join.
    const hosting = game;
    let tries = 0;
    const open = () => {
      if (game !== hosting) return;
      const code = link.roomInfo?.()?.code;
      if (code) game?.invite(code, t('invite.where', { map: mapName(duel.mapId), size: sizeLabel(6), mode: modeName(duel.mode) }));
      else if (++tries < 40) setTimeout(open, 250);
    };
    open();
    return;
  }
  if (duel.kind === 'host') {
    // The room's code arrives a moment after the join (its own subscription): wait for it, so the dialog always opens.
    const hosting = game;
    let tries = 0;
    const open = () => {
      if (game !== hosting) return;
      const code = link.roomInfo?.()?.code;
      if (code) void game?.share({ summary: duel.summary, room: code });
      else if (++tries < 40) setTimeout(open, 250);
    };
    open();
    return;
  }
  const ref = duel.c.ref ?? '';
  game?.setChallenge({ name: duel.c.name, ref, via: duel.kind === 'join' ? 'room' : 'fallback' });
  track('challenge_started', { ref, via: duel.kind === 'join' ? 'room' : 'fallback', ...(duel.kind === 'fallback' ? { reason: duel.reason } : {}) });
  if (duel.kind === 'fallback') { game?.notice(t('chal.double', { name: duel.c.name }), 8000); return; }
  // The room was there but the challenger has left it: play their double rather than wait alone.
  const playing = game;
  setTimeout(() => {
    const state = link.state();
    if (game !== playing || !state || state.soldiers.some(s => !s.bot && s.id !== link.myId())) return;
    backToLobby('menu');
    special = { kind: 'fallback', c: duel.c, mapId: duel.mapId, reason: 'gone' };
    run('solo');
  }, 6000);
}

/** 發起單挑 from an end screen: leave the match, open a private 1v1 room on its map and share its link. */
function openDuelRoom(summary: MatchSummary) {
  backToLobby('menu', t('chal.opening'), 'end_screen');
  special = { kind: 'host', summary, mapId: challengeMap(summary.mapId, mapsFor(1)) };
  run('start');
}

/**
 * Run one way in. An online one pressed while the server is still connecting is queued: it runs by
 * itself once the server is up (`retried`: it already failed to reach the server once).
 */
function run(action: Action, room = -1, retried = false) {
  if (!ready || starting) return;
  if (modeOf(action) === 'online' && !online.ok) return;
  if (action === 'code' && roomCode.value.length < 4) { roomCode.focus(); return; }
  // Still on the lobby's made-up callsign: ask for a name first, then play from that same tap.
  if (needsCallsign()) {
    track('callsign_asked', {});
    askCallsign(callsign.value, name => { callsign.value = name; store.set('name', name); run(action, room, retried); });
    return;
  }
  if (modeOf(action) === 'online' && phase() !== 'ready') {
    playPressed();
    // Still inside the tap: full screen now, as starting would (a queued start runs without a gesture).
    fullscreenForTouch();
    // (A lobby that let go of the server in a background tab reconnects first.)
    if (phase() === 'idle') watchLobbyRooms();
    lobbyConn.queue({ action, room, retried });
    return;
  }
  if (action === 'room' && !rooms.some(r => r.room === room)) return;
  playPressed();
  joiningRoom = room;
  void start(action, retried);
}

/** Solo's and Practice's map and mode: the form's (the performance check uses ?map or the size's first map, Elimination). */
function offlineRules(): { mapId: string; mode: Mode } {
  if (!benchMode) return { mapId: map, mode };
  const fits = mapsFor(perTeam());
  const asked = params.get('map');
  return { mapId: asked && maps.some(m => m.id === asked) ? asked : fits.includes(map) ? map : fits[0], mode: 'elimination' };
}

/**
 * Touch devices play full screen and sideways where the browser allows (Android; iPhones have no
 * Fullscreen API, so there the installed app is the full-screen way). Must run inside the tap.
 */
function fullscreenForTouch() {
  // CrazyGames has its own fullscreen button and allows no other.
  if (CRAZYGAMES || !touchActive() || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    return orientation?.lock?.('landscape');
  }).catch(() => undefined);
}

async function start(action: Action, retried = false) {
  // Before the first await: still inside the player's tap.
  if (!benchMode) fullscreenForTouch();
  // Clickwrap: pressing Play accepts the Terms and Privacy Policy linked beside the buttons (src/game/consent.ts).
  if (!benchMode) acceptTerms();
  const name = callsign.value.trim().slice(0, 16) || t('lobby.fallbackName');
  const via = modeOf(action);
  // A 發起單挑 start (the challenger's room, their bot double, or our own 1v1 room) leaves the form as it was.
  const duel = special;
  special = undefined;
  inviteStarting = duel?.kind === 'invite';
  if (!benchMode) {
    store.set('name', name);
    if (!duel) { store.set('mode', via); store.set('team', team); store.set('skill', skill); saveForm(); }
  }
  const kinds: Record<Action, PlayKind> = { quick: 'online', start: isPublic ? 'start' : 'private', room: 'room', code: 'code', solo: 'solo', range: 'practice' };
  // Quick Play, a listed room and a code choose no rules; Start, Solo and Practice send the form's.
  const ruled = action === 'start' || action === 'solo' || action === 'range';
  // An online match goes to the chosen server (connectOnline reads the same choice).
  const playServer: ServerId | undefined = via === 'online' ? currentServer()?.id : undefined;
  track('play_clicked', { kind: kinds[action], size: ruled ? sizeOf(size).label : '', mode: ruled ? mode : '', map: ruled ? map : '', ...(playServer ? { server_choice: playServer } : {}) }, { set: { name, lang: lang(), quality } });
  starting = action; closePop(false); refresh();
  options.hide();
  choicePings.setActive(false);
  status.textContent = '';
  unwatchRooms();
  inMenu = false;
  audio.start();
  if (params.has('audiodebug')) void import('./audio-probe').then(m => m.startAudioProbe(audio));
  audio.stopMusic();
  const teamChoice = team === 'auto' ? undefined : (Number(team) as Team);
  const botSkill = Math.max(0.1, Math.min(0.95, Number(skill) || 0.45));
  const rules = offlineRules();
  const how: OnlineEntry = duel?.kind === 'host' ? { kind: 'start', size: 1, mode: 'elimination', mapId: duel.mapId, bots: false, isPublic: false }
    : duel?.kind === 'invite' ? { kind: 'start', size: 6, mode: duel.mode, mapId: duel.mapId, bots: true, isPublic: false }
    : duel?.kind === 'join' ? { kind: 'code', code: duel.c.room! }
    : action === 'code' ? { kind: 'code', code: cleanCode(roomCode.value) }
    : action === 'room' ? { kind: 'room', room: joiningRoom }
    : action === 'start' ? { kind: 'start', size: perTeam(), mode, mapId: map, bots, isPublic }
    : { kind: 'any' };
  let link: GameLink;
  try {
    link = via === 'online'
      ? await connectOnline(name, teamChoice, how, s => { status.textContent = s; })
      : duel?.kind === 'fallback'
        ? new OfflineLink(duel.mapId, name, undefined, { ...ELIMINATION, teamSize: 1, botSkill }, false, duel.c.name)
      : via === 'lab'
        ? new OfflineLink(rules.mapId, name, teamChoice, {}, true)
        : new OfflineLink(rules.mapId, name, teamChoice, { ...(rules.mode === 'sabotage' ? SABOTAGE : ELIMINATION), teamSize: perTeam(), botSkill, freeBuy: params.has('freebuy') });
  } catch (error) {
    // The challenger's room is gone, full or unreachable: their bot double instead, on the same map.
    if (duel?.kind === 'join') {
      starting = undefined; joiningRoom = -1;
      special = { kind: 'fallback', c: duel.c, mapId: duel.mapId, reason: 'gone' };
      void start('solo');
      return;
    }
    if (duel?.kind === 'joinInvite') track('invite_joined', { ref: duel.ref, joined: false });
    const room = joiningRoom;
    starting = undefined; joiningRoom = -1;
    inMenu = !benchMode; menuMusic();
    // The server could not be reached (the network dropped under a lobby that still looked connected,
    // after a laptop slept say): try again and join once it is up. Only once: a second failure is shown.
    if (error instanceof ConnectError && via === 'online' && !retried && !benchMode) {
      status.textContent = '';
      watchLobbyRooms();
      lobbyConn.queue({ action, room, retried: true });
      return;
    }
    playFailed();
    const tried = action === 'code' && !duel ? cleanCode(roomCode.value) : '';
    status.textContent = t('lobby.couldNotJoin', { error: serverError((error as Error).message) }) + (tried ? ` (${tried})` : '');
    // Typing replaces the code that failed.
    if (tried) { roomCode.focus({ preventScroll: true }); roomCode.select(); }
    track('error_shown', { where: 'join', message: String((error as Error)?.message ?? error).slice(0, 120) });
    watchLobbyRooms(); refresh();
    return;
  }
  const linkMap = link.state()?.mapId ?? (duel?.kind === 'fallback' ? duel.mapId : rules.mapId);
  // The map's ground textures (the shared ones came with the lobby): from the cache after the first time.
  await assets.textures.load(groundSets(THEMES[loadMap(linkMap).def.theme]));
  starting = undefined; joiningRoom = -1;
  status.textContent = '';
  if (backdrop) { renderer.scene.remove(backdrop.group); backdrop = undefined; backdropMap = undefined; }
  launch(link, linkMap);
  joined(link, linkMap, playServer, false, duel?.kind === 'host' || duel?.kind === 'invite');
  matchServer = playServer;
  reportRoom(link, playServer);
  if (duel) startedDuel(duel, link);
  // The map's own files have loaded by now: cache them too on a first visit.
  setTimeout(warmServiceWorker, 15000);
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  // Our own 1v1 room opens with the share dialog, our invite room with the invite dialog (the pointer stays free for them).
  if (duel?.kind === 'host' || duel?.kind === 'invite') return;
  await game?.input.lock()?.catch?.(() => undefined);
}

function launch(link: GameLink, map: string) {
  game = new Game(assets, renderer, link, map, audio, app);
  // 約朋友單挑: our own 1v1 room where online play is available, else a challenge link the bot double answers.
  if (!benchMode) game.onDuel(online.ok ? openDuelRoom : undefined);
  if (benchMode && !bench) startBench(game);
  game.onMapChange = next => { game?.stop(true); launch(link, next); };
  game.onExit = how => backToLobby('menu', '', how);
}
/** Leave the match for the lobby: chosen (menu), or because the server removed us or the connection dropped. */
function backToLobby(reason: 'menu' | 'disconnect', message = '', exit?: Exit) {
  if (!game) return;
  const finished = game.link.state()?.phase === 'ended';
  leftMatch(reason, exit);
  game.stop(); game = undefined;
  crazyGameplay(false);
  crazyLeftRoom();
  // CrazyGames: a video ad after a finished match (their SDK keeps ads 3 minutes apart; none during Basic Launch).
  if (finished && reason === 'menu') void crazyMidgameAd(() => audio.setMuted(true), () => audio.setMuted(crazySettings().muteAudio));
  track('lobby_view', {});
  document.body.classList.add('menu-open'); menu.hidden = false;
  syncOptions();
  inMenu = !benchMode; menuMusic();
  watchLobbyRooms(); refresh();
  if (message) status.textContent = message;
}
/**
 * CrazyGames: the room we play in, for their "join friend" buttons. A private room is joinable with its code
 * (it arrives a moment after the join); a Quick Play room is matched by the server, so friends cannot follow.
 */
function reportRoom(link: GameLink, server: ServerId | undefined) {
  if (!CRAZYGAMES || link.mode !== 'online') return;
  const playing = game;
  let tries = 0;
  const report = () => {
    if (game !== playing) return;
    const info = link.roomInfo?.();
    // The room's index is reused once it closes, so its code is part of the id.
    if (info?.code) crazyRoom(`${server ?? 'tw'}-${info.room}-${info.code}`, true, { r: info.code });
    else if (info && ++tries >= 8) crazyRoom(`${server ?? 'tw'}-${info.room}`, false, {});
    else setTimeout(report, 250);
  };
  report();
}
/** The server of the online match being played (for a rejoin after a dropped connection). */
let matchServer: ServerId | undefined;

/** The in-app browser's app and touch aim assist, when they apply. */
function playContext() {
  const app = inAppBrowserName(readEnv());
  return { ...(app ? { in_app: app } : {}), ...(touchActive() ? { aim_assist: touchAimAssist() } : {}) };
}
// A match turned sideways (an upright phone) counts for its match_left.
onSideways(on => { if (on && game) matchNote('sideways'); });

/** Analytics: we are in a match (once per link; online map rotations keep the same session). */
function joined(link: GameLink, map: string, serverChoice: ServerId | undefined, rejoin = false, hosted = false) {
  const state = link.state(), me = state?.soldiers.find(s => s.id === link.myId());
  const config = state?.config;
  const info = link.roomInfo?.();
  // The wait from pressing Play (a rejoin or a map change has none); the match's frame count starts over.
  const wait = matchStarted();
  matchJoined({
    online: link.mode === 'online', ...(info ? { room: info.code || `public-${info.room}`, private: !!info.code } : {}), ...(hosted ? { hosted: true } : {}), map,
    mode: config?.mode ?? 'elimination', size: config?.practice ? 'practice' : sizeLabel(config?.teamSize ?? perTeam()), team: me?.team === 1 ? 'militia' : 'swat',
    ...(serverChoice ? { server_choice: serverChoice } : {}), device: currentDeviceKind(), ...(rejoin ? { rejoin: true } : {}),
    // How it is played (phones): touch, an upright screen (the match then turns sideways), which app's browser, aim assist.
    touch: touchActive(), upright: innerHeight > innerWidth && !isSideways(), ...playContext(), ...(wait !== undefined && !rejoin ? { wait_ms: wait } : {}),
  });
  if (isSideways()) matchNote('sideways');
  // The server removed us (it stopped hearing from this client) or the connection dropped: back to
  // the lobby with a note, rather than playing on against a frozen match the server no longer runs.
  // A dropped connection (a phone that slept, an in-app browser sent to the background, a network
  // blip) reconnects and rejoins the same room first.
  if (link instanceof OnlineLink) link.onDrop = () => {
    if (link.dropReason === 'lost' && !benchMode && link.entry) void rejoinAfterDrop(link);
    else if (link.dropReason === 'afk') backToLobby('disconnect', t('net.afk'), 'afk');
    else backToLobby('disconnect', t(link.dropReason === 'removed' ? 'net.removed' : 'net.lost'), link.dropReason === 'removed' ? 'removed' : 'lost');
  };
}

/** Tries to reconnect, waiting for the page to be visible first (a backgrounded app cannot connect). */
const REJOIN_TRIES = 5;
const visible = () => new Promise<void>(resolve => {
  if (document.visibilityState === 'visible') { resolve(); return; }
  const on = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', on); resolve(); } };
  document.addEventListener('visibilitychange', on);
});

/**
 * The connection dropped mid-match: say so over the frozen view, reconnect (same identity) and join the
 * same room again by its code or number. Only after a few failed tries is the player sent to the lobby.
 */
async function rejoinAfterDrop(old: OnlineLink) {
  const playing = game;
  if (!playing || !old.entry) return;
  const info = old.roomInfo();
  const how: OnlineEntry = info?.code ? { kind: 'code', code: info.code } : info ? { kind: 'room', room: info.room } : old.entry.how;
  const note = document.createElement('div');
  note.className = 'reconnecting';
  note.setAttribute('role', 'status');
  note.innerHTML = `<b>${esc(t('net.reconnecting'))}</b><small>${esc(t('net.reconnectingSub'))}</small>`;
  document.body.appendChild(note);
  try {
    for (let i = 0; i < REJOIN_TRIES; i++) {
      await visible();
      if (game !== playing) return; // left meanwhile
      try {
        const team = old.entry.team === 0 || old.entry.team === 1 ? old.entry.team as Team : undefined;
        const link = await connectOnline(old.entry.name, team, how, () => undefined);
        if (game !== playing) { link.dispose(); return; }
        leftMatch('disconnect', 'rejoined');
        playing.stop(); game = undefined;
        const map = link.state()?.mapId ?? playing.mapId;
        launch(link, map);
        joined(link, map, matchServer, true);
        return;
      } catch { await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    backToLobby('disconnect', t('net.lost'), 'lost');
  } finally { note.remove(); }
}
/** Analytics: the match is over for us (sent once per match). */
function leftMatch(reason: Reason, exit?: Exit) {
  const link = game?.link;
  // Online: the match's connection quality, and its last report to the server.
  matchLeft(reason, link instanceof OnlineLink ? link.netLeft() : undefined, exit, matchFrameStats(), renderer && {
    gpu: renderer.gpuName(), quality, pixel_ratio: renderer.pixelRatio(), dpr_scale: renderer.quality.adaptive ? Math.round(renderer.adaptive.multiplier * 100) / 100 : 1,
  });
}
// Closing the tab mid-match: match_left goes out by beacon.
addEventListener('pagehide', () => leftMatch('close', 'close'));

/** Fullscreen on or off. Entering it can drop pointer lock, so recapture after. */
function toggleFullscreen() {
  if (CRAZYGAMES) return;
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
  const relock = !!game?.input.locked;
  void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
    if (relock && game && !game.input.locked) void game.input.lock()?.catch?.(() => undefined);
  }, () => undefined);
}
// Fullscreen and leave bound to a mouse button (the left one never: it clicks the menu).
document.addEventListener('mousedown', e => {
  const code = `Mouse${e.button}`;
  if (matches('fullscreen', code)) toggleFullscreen();
  else if (matches('leave', code) && game && !game.input.locked) leaveByKey();
});
/**
 * The leave key (M) or mouse button: a match is left only after "Leave the match?" (it was too easy to
 * press by accident, after Esc or Alt-Tab freed the mouse); on the end screen it leaves at once.
 */
function leaveByKey() {
  if (!game || game.input.locked || document.querySelector('.ask-dialog')) return;
  if (game.link.state()?.phase === 'ended') { game.onExit?.('leave_key'); return; }
  confirmDialog({ title: t('leave.title'), why: t('leave.why'), go: t('leave.go'), stay: t('leave.stay'), done: () => game?.onExit?.('leave_key') });
}

/** How long to wait for the browser to hand the graphics back before offering a reload. */
const GFX_RESTORE_MS = 6000;
let gfxTimer = 0;
/**
 * The browser took the graphics context away (a black screen; phones do it to apps in the background):
 * say it is being restored, and offer a reload only if it does not come back.
 */
function graphicsLost() {
  if (document.querySelector('.gfx-lost')) return;
  const el = document.createElement('div');
  el.className = 'gfx-lost';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<p>${esc(t('gfx.restoring'))}</p>`;
  document.body.appendChild(el);
  clearTimeout(gfxTimer);
  gfxTimer = window.setTimeout(() => {
    el.innerHTML = `<p>${esc(t('gfx.lost'))}</p><button type="button">${esc(t('gfx.reload'))}</button>`;
    el.querySelector('button')!.addEventListener('click', () => location.reload());
  }, GFX_RESTORE_MS);
}
/** The graphics are back (three.js rebuilds its GPU state; the renderer makes the environment light again): carry on. */
function graphicsRestored() {
  clearTimeout(gfxTimer);
  document.querySelector('.gfx-lost')?.remove();
  renderer.restored();
}

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
document.addEventListener('keydown', e => {
  // The leave key (M) from the in-game menu (the mouse is free): back to the lobby.
  if (matches('leave', e.code) && game && !game.input.locked && e.target === document.body) leaveByKey();
  // Fullscreen (F, BeGone's default key).
  if (matches('fullscreen', e.code) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) toggleFullscreen();
  // Esc in the lobby: close the settings dialog, else the open popover.
  if (e.key === 'Escape' && !game && !menu.hidden) {
    if (options.open) { e.preventDefault(); options.close(); return; }
    if (openPop) { e.preventDefault(); closePop(); }
    return;
  }
  // Enter: the code box joins, an open Solo popover starts it, else the tab's big button (Quick Play or Start).
  if (e.key === 'Enter' && !e.repeat && !game && !menu.hidden && !options.open && !e.isComposing) {
    const target = e.target as HTMLElement;
    if (target === roomCode) { e.preventDefault(); run('code'); return; }
    // Buttons and links keep their own Enter.
    if (target.closest('button, summary, a')) return;
    e.preventDefault();
    if (openPop?.id === 'solo-pop') run('solo');
    else if (tab === 'quick') quickPressed();
    else if (tab === 'start') run('start');
  }
});

function startBench(g: Game) {
  bench = new Bench(g, renderer, quality);
  benchBanner = document.createElement('div');
  benchBanner.className = 'bench-banner';
  app.appendChild(benchBanner);
  bench.onDone = result => { benchBanner?.remove(); showBenchResult(result); benchFinished(result); };
}

let benchPanel: HTMLElement | undefined;
let benchResult: BenchResult | undefined;
function showBenchResult(r: BenchResult) {
  const panel = benchPanel = document.createElement('div');
  benchResult = r;
  panel.className = 'bench-panel';
  panel.innerHTML = `
    <h2>${t('bench.title')}</h2>
    <div class="verdict ${r.meets60 ? 'ok' : 'bad'}">${t(r.meets60 ? 'bench.met' : 'bench.notMet')}</div>
    <table>${benchReport(r).map(([k]) => `<tr><th>${t(k)}</th><td></td></tr>`).join('')}</table>
    <p>${t('bench.about', { n: r.seconds })}</p>
    <div class="actions"><button data-a="copy">${t('bench.copy')}</button><button data-a="again">${t('bench.again')}</button><button data-a="menu">${t('bench.menu')}</button></div>`;
  // Values go in as text: the GPU string comes from the driver.
  panel.querySelectorAll('td').forEach((td, i) => { td.textContent = benchReport(r)[i][1]; });
  panel.addEventListener('click', e => {
    const a = (e.target as HTMLElement).dataset.a;
    if (a === 'copy') void navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).then(() => { (e.target as HTMLElement).textContent = t('bench.copied'); }, () => undefined);
    if (a === 'again') location.reload();
    if (a === 'menu') location.href = location.pathname + (params.get('lang') ? `?lang=${params.get('lang')}` : '');
  });
  app.appendChild(panel);
  document.body.classList.add('bench-done');
  document.exitPointerLock?.();
}

/** What ?autostart (and the dev hook) runs: ?room joins by code, else the remembered or given `mode`. */
const startAction = (): Action => benchMode ? 'solo' : params.get('room') ? 'code' : startMode === 'offline' ? 'solo' : startMode === 'lab' ? 'range' : online.ok ? 'quick' : 'solo';

/** CrazyGames, once the lobby is ready: loading done, their settings, the player's name, and invites. */
function crazyReady() {
  crazyLoadingStop();
  // Their sound and chat switches win over ours while they are on.
  onCrazySettings(s => { audio.setMuted(s.muteAudio); setChatDisabled(s.disableChat); });
  // Friends know each other by their CrazyGames names, so a logged-in player plays under theirs.
  void crazyUser().then(user => {
    const name = user && cleanCallsign(user.username);
    if (!name) return;
    callsign.value = name; store.set('name', name); renderProfile();
  });
  // A friend's invite accepted while the game is open: leave what we play and join their room.
  onCrazyJoinRoom(params => {
    const where = linkPlace(params), room = where && parseInvite(where.pathname, where.search);
    if (!room) return;
    if (game) backToLobby('menu', '', 'menu_button');
    roomCode.value = room.room;
    special = { kind: 'joinInvite', ref: room.ref ?? '' };
    run('code');
  });
  // "Play with friends" on CrazyGames: straight into our own private room, with its invite dialog open.
  if (crazyInstantMultiplayer() && !challenge && !invite) openInviteRoom();
}

async function boot() {
  renderer = new Renderer(app, QUALITY[quality]);
  // The page's own failures go to PostHog; a lost graphics context also asks the player to reload.
  watchClientErrors(renderer.renderer.domElement, () => !!game, graphicsLost, graphicsRestored, () => {
    const canvas = renderer.renderer.domElement;
    return { quality, pixel_ratio: renderer.pixelRatio(), canvas: `${canvas.width}x${canvas.height}`, ...(game ? { map: game.mapId } : {}) };
  });
  // Chinese UI: fetch the CJK face with the assets, so the first screens never show a fallback font.
  const fonts = isZh() ? cjkFontReady('繁體中文') : Promise.resolve();
  showChallenge();
  assets = await loadAssets(f => { loadFraction = f; renderQuick(); renderStart(); renderOthers(); renderChallenge(); }, { renderer: renderer.renderer, quality });
  await fonts;
  ready = true;
  if (!benchMode) lobbyReady();
  if (CRAZYGAMES) crazyReady();
  warmServiceWorker();
  refresh();
  renderChallenge();
  if (params.get('room') && !params.get('autostart') && !challenge) roomCode.focus({ preventScroll: true });
  if (!benchMode) {
    theme = renderTheme();
    theme.then(menuMusic, error => console.warn('Menu theme unavailable', error));
  }
  let previous = performance.now();
  let angle = 0.6;
  // Dev/test: ?fixeddt advances exactly 1/30 s per rendered frame; ?capture steps only on demand.
  const fixed = import.meta.env.DEV && (params.has('fixeddt') || params.has('capture'));
  const step = (dt: number, now: number, render = true) => {
    if (game) game.frame(dt, render);
    else {
      angle += dt * 0.04;
      renderer.camera.position.set(Math.cos(angle) * 70, 26, Math.sin(angle) * 52);
      renderer.camera.lookAt(0, 2, 0);
      renderer.camera.fov = 60; renderer.camera.updateProjectionMatrix();
      backdrop?.update(now / 1000);
      renderer.render(now / 1000);
    }
  };
  let benchLeft = -1;
  const loop = (now: number) => {
    // The next frame is asked for first: a frame that throws (a graphics context lost in the middle of
    // drawing, any bug) must not end the loop, or the game stays frozen on its last picture for good.
    requestAnimationFrame(loop);
    const interval = now - previous;
    const dt = fixed ? 1 / 30 : Math.max(0, Math.min(0.05, interval / 1000)); previous = now;
    const t0 = performance.now();
    if (bench && !bench.done && game) bench.drive(dt);
    step(dt, now);
    if (game && !fixed) frameTook(interval);
    if (bench && !bench.done) {
      bench.record(interval, performance.now() - t0);
      const left = Math.ceil(bench.remaining);
      if (left !== benchLeft && benchBanner) { benchLeft = left; benchBanner.textContent = bench.warming ? t('bench.warming') : t('bench.left', { n: left }); }
    }
  };
  if (!params.has('capture')) requestAnimationFrame(loop);
  let simNow = 0;
  /** Advance n fixed frames (capture mode). Returns once the frames are rendered. */
  const stepFrames = (n: number, render = true) => { for (let i = 0; i < n; i++) { simNow += 1000 / 30; step(1 / 30, simNow, render && i === n - 1); } return n; };
  // An online ?autostart waits for the connection like a pressed button does.
  const startNow = () => { const action = startAction(); return modeOf(action) === 'online' ? run(action) : start(action); };
  if (params.get('autostart') || benchMode) void startNow();
  if (import.meta.env.DEV) Object.assign(window, { __lb: { get game() { return game; }, get bench() { return bench; }, renderer, assets, step: stepFrames, start: startNow } });
}

void boot().catch(error => {
  console.error(error);
  reportBootFailure(error);
  const message = (error as Error)?.message ?? String(error);
  if (isWebglFailure(message)) showGraphicsHelp(); else status.textContent = t('lobby.unableToStart', { error: message });
});

/** WebGL could not start (usually graphics acceleration turned off): how to turn it back on in this browser, and Reload. */
function showGraphicsHelp() {
  const kind = graphicsHelp(navigator.userAgent);
  const box = document.createElement('div');
  box.className = 'graphics-help';
  const title = document.createElement('strong');
  title.textContent = t('boot.noGraphics');
  const steps = document.createElement('p');
  steps.textContent = t(`boot.graphics.${kind}`);
  const more = document.createElement('p');
  more.className = 'more';
  more.textContent = t('boot.graphicsMore');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = t('boot.reload');
  reload.addEventListener('click', () => location.reload());
  box.append(title, steps, more, reload);
  status.replaceChildren(box);
  track('error_shown', { where: 'boot', message: `no webgl (${kind})` });
}
