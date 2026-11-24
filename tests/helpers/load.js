'use strict';
/**
 * Test harness for skyband.
 *
 * The app is a single index.html whose logic lives in one IIFE, so nothing is exported.
 * Rather than modifying the app for testability, the harness:
 *   1. loads the REAL index.html into jsdom (scripts from CDNs are not fetched),
 *   2. injects the REAL d3 / topojson-client builds from node_modules (same pinned versions as the CDN tags),
 *   3. stubs only browser APIs jsdom lacks (audio, Leaflet, Hls, AudioContext, geolocation, fetch),
 *   4. appends a tiny `window.__sb = {...}` hook just before the IIFE closes (in-memory only, never written to disk).
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const readNm = (p) => fs.readFileSync(path.join(ROOT, 'node_modules', p), 'utf8');

const D3_SRC = readNm('d3/dist/d3.min.js');
const TOPOJSON_SRC = readNm('topojson-client/dist/topojson-client.min.js');
const WORLD_JSON = JSON.parse(readNm('world-atlas/countries-110m.json'));

const HOOK = `
window.__sb = {
  state, dom, ANCHOR_PLACES, pickDestination, nowPlayingSource, containsWord, MOODS, tuneMood, nextAlarmTime, fireAlarm, FALLBACK_STATIONS, FEATURED_STATIONS, RADIO_MIRRORS, KNOWN_GENRES, FONT_THEMES,
  GLOBAL_CITY_ALIASES, COUNTRY_TERRESTRIAL_SEEDS,
  stripAccents, haversineKm, escapeHtml, mergeUnique, hashJitter, detectBroadcastBand,
  computeStreamReliability, normalizeStation, getLocalTimeInfo, getActivePlaceTerms,
  computeNightCircleGeoJson, isPointVisibleOnGlobe, getVisibleStations, renderSignalInline,
  fetchRadioBrowser, loadStationsForScope, runSmartOmnibox, resolveLocationFromCoords,
  jumpWithFlightArc, followTheNight, followGoldenHour, toggleWorldTour, stopWorldTour, flyNextTourStop,
  stampPassport, renderPassport, playStation, handleStreamError, playAdjacent, toggleFavorite,
  togglePlayPause, spinGlobe, setSleepTimer, startAmbientFx, stopAmbientFx, applyFontTheme,
  renderStationList, renderVectorMap, renderDiagnostics, setMapProjection, showToast, updatePlayerUI,
  get projection() { return projection; }, get globeRotate() { return globeRotate; },
  set globeRotate(v) { globeRotate = v; }, get globeScale() { return globeScale; },
  set globeScale(v) { globeScale = v; }, get flatTransform() { return flatTransform; },
  get worldCountries() { return worldCountries; }, get hlsInstance() { return hlsInstance; },
  get leafMap() { return leafMap; }
};
`;

/** Manual clock so timers (stall guard, tour, sleep timer, toast) are deterministic. */
function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const add = (fn, ms, repeat) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + Math.max(0, Number(ms) || 0), every: repeat ? Math.max(1, Number(ms) || 1) : 0 });
    return id;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    pending: () => timers.size,
    elapsed: () => now,
    /** Advance virtual time by ms, firing due timers in order. */
    tick(ms = 0) {
      const target = now + ms;
      for (;;) {
        let nextId_ = null;
        let nextAt = Infinity;
        for (const [id, t] of timers) if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId_ = id; }
        if (nextId_ === null) break;
        const t = timers.get(nextId_);
        now = Math.max(now, t.at);
        if (t.every) t.at = now + t.every; else timers.delete(nextId_);
        t.fn();
      }
      now = target;
    }
  };
}

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

/**
 * @param {object} [opts]
 * @param {(params: URLSearchParams, url: string) => any} [opts.radio]  returns array | throws | Promise
 * @param {(lat:number, lng:number, url:string) => any} [opts.nominatim] returns Nominatim JSON | throws
 * @param {boolean} [opts.nativeHls]  audio.canPlayType reports HLS support (Safari)
 * @param {object} [opts.geo]  fake navigator.geolocation
 * @param {object} [opts.storage]  pre-seeded localStorage entries (raw strings)
 * @param {string} [opts.now]  ISO time to freeze Date at
 * @param {boolean} [opts.advanceDate]  with opts.now: Date moves forward as the fake clock ticks
 * @param {boolean} [opts.noLibs]  do not provide d3/topojson (simulates CDN failure)
 * @param {boolean} [opts.skipInit]  evaluate nothing; return the DOM only
 * @param {{w:number,h:number}} [opts.viewport]  map stage size (default 1280x800)
 * @param {() => number} [opts.random]  deterministic Math.random
 * @param {(url:string) => any} [opts.nowPlaying]  JSON for api.somafm.com / api.kexp.org (may throw)
 * @param {boolean} [opts.mediaSession]  install a fake navigator.mediaSession + MediaMetadata (read back via app.media)
 * @param {string} [opts.userAgent]  navigator.userAgent override
 * @param {boolean} [opts.standalone]  matchMedia('(display-mode: standalone)') matches
 * @param {boolean|'reject'} [opts.serviceWorker]  fake navigator.serviceWorker (register calls land in app.sw.registered)
 * @param {boolean} [opts.hlsUnsupported]  Hls.isSupported() === false
 */
async function loadApp(opts = {}) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const dom = new JSDOM(html, { url: 'https://m4roon3d.github.io/skyband/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  await new Promise((r) => (window.document.readyState === 'complete' ? r() : window.addEventListener('load', r)));

  // jsdom has no layout: give elements a deterministic desktop viewport (the map reads #map-stage size).
  const vp = opts.viewport || { w: 1280, h: 800 };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => vp.w, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => vp.h, configurable: true });
  if (opts.random) window.Math.random = opts.random;

  const clock = makeClock();
  window.setTimeout = clock.setTimeout;
  window.setInterval = clock.setInterval;
  window.clearTimeout = clock.clearTimeout;
  window.clearInterval = clock.clearInterval;

  const calls = { fetch: [], lucide: 0, hls: [], leaflet: { tiles: [], maps: [], markers: 0 }, audio: { play: [], pause: 0, srcs: [] } };

  // ---- Date control
  if (opts.now) {
    const RealDate = window.Date;
    const fixed = RealDate.parse(opts.now);
    class FixedDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(fixed + (opts.advanceDate ? clock.elapsed() : 0)); else super(...a); }
      static now() { return fixed + (opts.advanceDate ? clock.elapsed() : 0); }
    }
    window.Date = FixedDate;
  }

  // ---- localStorage seed
  for (const [k, v] of Object.entries(opts.storage || {})) window.localStorage.setItem(k, v);

  // ---- fetch router
  window.fetch = async (url, init) => {
    const u = String(url);
    calls.fetch.push(u);
    if (u.includes('world-atlas') && u.endsWith('countries-110m.json')) return jsonResponse(WORLD_JSON);
    if (u.startsWith('https://nominatim.openstreetmap.org/reverse')) {
      const sp = new URL(u).searchParams;
      const body = opts.nominatim ? await opts.nominatim(Number(sp.get('lat')), Number(sp.get('lon')), u) : { address: { city: 'Testville', state: 'Test State', country: 'Testland', country_code: 'tl' } };
      return jsonResponse(body);
    }
    const m = u.match(/^(https:\/\/[a-z0-9]+\.api\.radio-browser\.info)\/json\/stations\/search\?(.*)$/);
    if (m) {
      const data = opts.radio ? await opts.radio(new URL(u).searchParams, u) : [];
      return jsonResponse(data);
    }
    if (opts.nowPlaying && (u.startsWith('https://api.somafm.com/') || u.startsWith('https://api.kexp.org/'))) return jsonResponse(await opts.nowPlaying(u));
    throw new Error(`Unmocked fetch: ${u}`);
  };

  // ---- audio element stubs (jsdom does not implement media playback)
  const audio = window.document.getElementById('radio-audio');
  let paused = true;
  Object.defineProperty(audio, 'paused', { get: () => paused, configurable: true });
  audio.play = () => { paused = false; calls.audio.play.push(audio.getAttribute('src')); return Promise.resolve(); };
  // Per the HTML spec, setting `src` runs the media-element load algorithm, which discards pending media event tasks
  // (e.g. a queued 'pause' from the pause() the app calls just before switching stream).
  let pendingPause = null;
  const dropPendingMediaTasks = () => { if (pendingPause !== null) { window.clearTimeout(pendingPause); pendingPause = null; } };
  audio.pause = () => { if (paused) return; paused = true; calls.audio.pause++; pendingPause = window.setTimeout(() => { pendingPause = null; audio.dispatchEvent(new window.Event('pause')); }, 0); };
  audio.canPlayType = (t) => (opts.nativeHls && /mpegurl/i.test(t) ? 'maybe' : '');
  const realSet = audio.setAttribute.bind(audio);
  audio.setAttribute = (k, v) => { if (k === 'src') { calls.audio.srcs.push(v); dropPendingMediaTasks(); } realSet(k, v); };
  Object.defineProperty(audio, 'src', { get: () => audio.getAttribute('src') || '', set: (v) => { calls.audio.srcs.push(v); dropPendingMediaTasks(); realSet('src', v); }, configurable: true });

  // ---- navigator.geolocation
  const media = { handlers: {}, metadata: null, playbackState: 'none' };
  if (opts.mediaSession) {
    window.MediaMetadata = function MediaMetadata(init) { Object.assign(this, init); };
    Object.defineProperty(window.navigator, 'mediaSession', { configurable: true, value: {
      setActionHandler: (a, fn) => { media.handlers[a] = fn; },
      get metadata() { return media.metadata; }, set metadata(v) { media.metadata = v; },
      get playbackState() { return media.playbackState; }, set playbackState(v) { media.playbackState = v; }
    } });
  }
  if (opts.userAgent) Object.defineProperty(window.navigator, 'userAgent', { value: opts.userAgent, configurable: true });
  if (opts.standalone) window.matchMedia = (q) => ({ matches: /standalone/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  const sw = { registered: [] };
  if (opts.serviceWorker) Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: { register: (u) => { sw.registered.push(u); return opts.serviceWorker === 'reject' ? Promise.reject(new Error('nope')) : Promise.resolve({}); } } });
  if (opts.geo !== undefined) Object.defineProperty(window.navigator, 'geolocation', { value: opts.geo, configurable: true });

  // ---- Web Audio stub
  class FakeNode { connect() {} disconnect() {} start() {} stop() {} }
  class FakeAudioContext {
    constructor() { this.sampleRate = 4000; this.state = 'running'; this.destination = new FakeNode(); }
    createGain() { const n = new FakeNode(); n.gain = { value: 1 }; return n; }
    createBuffer(_c, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return new FakeNode(); }
    createBiquadFilter() { const n = new FakeNode(); n.frequency = { value: 0 }; n.Q = { value: 0 }; return n; }
    resume() {}
  }
  window.AudioContext = FakeAudioContext;

  // ---- Hls + lucide + Leaflet stubs
  class FakeHls {
    static isSupported() { return !opts.hlsUnsupported; }
    constructor(cfg) { this.cfg = cfg; this.handlers = {}; this.destroyed = false; calls.hls.push(this); }
    loadSource(u) { this.source = u; }
    attachMedia(a) { this.media = a; dropPendingMediaTasks(); } // MediaSource attach == src set
    on(ev, fn) { this.handlers[ev] = fn; }
    destroy() { this.destroyed = true; }
  }
  FakeHls.Events = { MANIFEST_PARSED: 'hlsManifestParsed', ERROR: 'hlsError' };
  window.Hls = FakeHls;
  window.lucide = { createIcons() { calls.lucide++; } };

  const chain = () => new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : chain()), apply: () => chain() });
  window.L = {
    map(id, o) {
      const handlers = {};
      const m = { id, o, handlers, view: null, on: (e, fn) => { handlers[e] = fn; return m; }, flyTo: (c, z) => { m.view = [c, z]; }, setView: (c, z) => { m.view = [c, z]; }, invalidateSize() {}, removeLayer() {}, zoomIn() { m.zoomed = 'in'; }, zoomOut() { m.zoomed = 'out'; } };
      calls.leaflet.maps.push(m);
      return m;
    },
    layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
    tileLayer(url, o) { calls.leaflet.tiles.push({ url, o }); return { addTo() { return this; } }; },
    circleMarker() { calls.leaflet.markers++; const mk = { addTo() { return mk; }, bindTooltip() { return mk; }, on() { return mk; } }; return mk; },
    polyline: () => ({ addTo() { return this; } })
  };

  if (!opts.noLibs) {
    window.eval(D3_SRC);
    window.eval(TOPOJSON_SRC);
  }

  // ---- extract + patch inline app script
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('inline app <script> not found');
  const script = m[1];
  const end = script.lastIndexOf('})();');
  if (end === -1) throw new Error('IIFE terminator not found');
  const patched = script.slice(0, end) + HOOK + script.slice(end);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  if (!opts.skipInit) window.eval(patched);
  await flush();

  return {
    window, document: window.document, sb: window.__sb, clock, calls, errors, audio, flush,
    // Let in-flight app work (fetch fan-out, timers) settle before tearing the window down, so late callbacks never hit a closed document.
    close: () => { flush(20).then(() => window.close()); },
    click: (sel) => { const el = typeof sel === 'string' ? window.document.querySelector(sel) : sel; if (!el) throw new Error(`no element: ${sel}`); el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); },
    key: (key, init = {}) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })),
    /** Simulate the browser firing media events. */
    media, sw,
    audioEvent: (name) => audio.dispatchEvent(new window.Event(name)),
    toast: () => ({ text: window.document.getElementById('toast-message').textContent, hidden: window.document.getElementById('toast').classList.contains('hidden') })
  };
}

/** Objects created inside the jsdom realm have foreign prototypes; strict deepEqual needs plain copies. */
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { loadApp, flush, plain, ROOT, INDEX_PATH, WORLD_JSON };
