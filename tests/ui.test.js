'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load');
const { rawStation, many } = require('./helpers/fixtures');

// Built once: the mocked Radio Browser answers every query with the same 7 stations (they de-duplicate by uuid).
let cached;
const list7 = () => (cached = cached || many(7, (i) => ({ name: `Station ${i}`, clickcount: 900 - i, geo_lat: 12.95 + i * 0.01, geo_long: 77.6 })));
const typeInto = (app, v) => { const i = app.document.getElementById('search-input'); i.value = v; i.dispatchEvent(new app.window.Event('input', { bubbles: true })); };
const cityOf = (app) => app.sb.state.location.city;

describe('boot', () => {
  it('starts cleanly: no script errors, brand visible, Bengaluru city scope, globe view, empty player', async () => {
    const app = await loadApp({ radio: () => list7() });
    assert.deepEqual(app.errors, []);
    assert.equal(app.document.getElementById('btn-brand-status').textContent.trim(), 'skyband');
    assert.equal(app.document.getElementById('location-heading').textContent, 'Bengaluru');
    assert.equal(app.sb.state.projMode, 'globe');
    assert.equal(app.document.getElementById('player-title').textContent, 'Ready to Tune');
    assert.equal(app.document.querySelectorAll('#station-list article').length, 7);
    assert.equal(app.document.querySelectorAll('#quick-cities button').length, 6);
    app.close();
  });

  it('renders the land (world-atlas) and the day/night terminator on the globe', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.flush(12);
    assert.ok(app.document.querySelectorAll('.layer-land path.country-path').length > 150);
    assert.equal(app.document.querySelectorAll('.layer-night path').length, 1);
    assert.equal(app.document.querySelectorAll('.layer-anchors g.city-node').length > 0, true);
    assert.equal(app.document.querySelectorAll('.layer-pin g.radar-marker').length, 1);
    const svg = app.document.getElementById('world-svg');
    assert.equal(svg.getAttribute('viewBox'), '0 0 1280 800');
    app.close();
  });

  it('survives corrupt / unavailable localStorage', async () => {
    const app = await loadApp({ radio: () => list7(), storage: { atlasfm_favorites: '{not json', atlasfm_passport: 'null-ish', skyband_font: '<<' } });
    assert.deepEqual(app.errors, []);
    assert.deepEqual(plain(app.sb.state.favorites), []);
    assert.equal(app.sb.state.fontTheme, 'modern');
    app.close();
  });
});

describe('font themes', () => {
  it('clicking a theme applies CSS variables, labels it, and persists under skyband_font', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('.font-opt-btn[data-font="mono"]');
    const root = app.document.documentElement.style;
    assert.match(root.getPropertyValue('--font-display'), /JetBrains Mono/);
    assert.equal(app.document.getElementById('active-font-name').textContent, 'Mono');
    assert.equal(app.window.localStorage.getItem('skyband_font'), '"mono"');
    app.close();
  });

  it('restores the saved theme on load; unknown values fall back to modern', async () => {
    const a = await loadApp({ radio: () => [], storage: { skyband_font: '"editorial"' } });
    assert.equal(a.document.getElementById('active-font-name').textContent, 'Editorial');
    a.close();
    const b = await loadApp({ radio: () => [], storage: { skyband_font: '"comic-sans"' } });
    assert.equal(b.document.getElementById('active-font-name').textContent, 'Modern');
    assert.equal(b.window.localStorage.getItem('skyband_font'), '"modern"');
    b.close();
  });

  it('the five themes are exactly Modern, Editorial, Clean, Studio, Mono', async () => {
    const app = await loadApp({ radio: () => [] });
    assert.deepEqual(plain(Object.values(app.sb.FONT_THEMES).map((t) => t.label)), ['Modern', 'Editorial', 'Clean', 'Studio', 'Mono']);
    app.close();
  });
});

describe('omnibox (natural-language tuning)', () => {
  it('"Tokyo jazz" jumps to Tokyo with the jazz genre filter and a flight arc', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('Tokyo jazz');
    assert.equal(cityOf(app), 'Tokyo');
    assert.equal(app.sb.state.genre, 'jazz');
    assert.equal(app.sb.state.scope, 'city');
    assert.equal(app.toast().text, 'Tuned: Tokyo · jazz');
    assert.equal(plain(app.sb.state.flightArc).length, 2);
    app.close();
  });

  it('"FM" alone filters the FM band and searches for it', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('FM');
    assert.equal(app.sb.state.band, 'fm');
    app.close();
  });

  it('"mumbai am" tunes Mumbai on the AM band; alias "bombay" resolves to Mumbai', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('mumbai am');
    assert.equal(cityOf(app), 'Mumbai');
    assert.equal(app.sb.state.band, 'am');
    await app.sb.runSmartOmnibox('bombay');
    assert.equal(cityOf(app), 'Mumbai');
    assert.equal(app.sb.state.band, 'all');
    app.close();
  });

  it('words merely containing "am"/"fm" (e.g. "jam", "ham radio") are not band keywords', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('jam radio');
    assert.equal(app.sb.state.band, 'all');
    assert.equal(app.sb.state.searchQuery, 'jam radio');
    app.close();
  });

  it('an unknown place/genre becomes a free-text station search', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('radio caroline');
    assert.equal(app.sb.state.searchQuery, 'radio caroline');
    assert.equal(app.sb.state.activeTab, 'explore');
    app.close();
  });

  it('genres without a chip (e.g. "lofi") are ignored for the filter but the place still works', async () => {
    const app = await loadApp({ radio: () => list7() });
    await app.sb.runSmartOmnibox('berlin lofi');
    assert.equal(cityOf(app), 'Berlin');
    assert.equal(app.sb.state.genre, 'all');
    app.close();
  });

  it('empty input resets search, band and genre', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.sb.state.band = 'fm'; app.sb.state.genre = 'jazz'; app.sb.state.searchQuery = 'x';
    await app.sb.runSmartOmnibox('   ');
    assert.deepEqual([app.sb.state.band, app.sb.state.genre, app.sb.state.searchQuery], ['all', 'all', '']);
    app.close();
  });

  it('Enter in the search box runs the omnibox; the clear button resets it', async () => {
    const app = await loadApp({ radio: () => list7() });
    typeInto(app, 'paris');
    assert.equal(app.document.getElementById('search-clear-btn').classList.contains('hidden'), false);
    const input = app.document.getElementById('search-input');
    input.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await app.flush();
    assert.equal(cityOf(app), 'Paris');
    typeInto(app, 'abc');
    app.click('#search-clear-btn');
    assert.equal(input.value, '');
    assert.equal(app.sb.state.searchQuery, '');
    app.close();
  });

  it('the dropdown suggests matching cities (name, country, alias) plus a smart-tune row, and picking jumps', async () => {
    const app = await loadApp({ radio: () => list7() });
    typeInto(app, 'ital');
    const dd = app.document.getElementById('search-dropdown');
    assert.equal(dd.classList.contains('hidden'), false);
    assert.ok(dd.querySelector('[data-pick-place="Rome"]'));
    assert.ok(dd.querySelector('[data-search-live]'));
    app.click('[data-pick-place="Rome"]');
    assert.equal(cityOf(app), 'Rome');
    assert.equal(dd.classList.contains('hidden'), true);
    typeInto(app, 'calcutta');
    assert.ok(dd.querySelector('[data-pick-place="Kolkata"]')); // old name resolves to a Kolkata stop
    typeInto(app, 'qwertyzz');
    assert.equal(app.document.querySelectorAll('#search-dropdown [data-pick-place]').length, 0);
    typeInto(app, '');
    assert.equal(dd.classList.contains('hidden'), true);
    app.close();
  });

  it('SECURITY: markup typed into the search box is escaped in the dropdown', async () => {
    const app = await loadApp({ radio: () => list7() });
    typeInto(app, '<img src=x onerror=alert(1)>"\'');
    const dd = app.document.getElementById('search-dropdown');
    assert.equal(dd.querySelector('img'), null);
    assert.equal(dd.querySelector('[data-search-live]').dataset.searchLive, '<img src=x onerror=alert(1)>"\'');
    app.close();
  });
});

describe('station list rendering', () => {
  it('SECURITY: hostile station names/tags/state are escaped, never injected as HTML', async () => {
    const evil = many(7, (i) => ({ name: `<img src=x onerror=alert(${i})>`, state: '"><script>alert(1)</script>', tags: 'pop', geo_lat: 12.95, geo_long: 77.6 }));
    const app = await loadApp({ radio: () => evil });
    const listEl = app.document.getElementById('station-list');
    assert.equal(listEl.querySelectorAll('img, script').length, 0);
    assert.match(listEl.textContent, /<img src=x onerror=alert\(0\)>/);
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    assert.equal(app.document.getElementById('player-title').querySelector('img'), null);
    app.close();
  });

  it('clicking a card plays it; its play button shows pause while live', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('#station-list article');
    assert.equal(app.calls.audio.play.length, 1);
    app.audioEvent('playing');
    assert.ok(app.document.querySelector('#station-list article [data-action="play"] [data-lucide="pause"]'));
    app.close();
  });

  it('shows "No signals matched" with a working Reset Filters button', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('.genre-btn[data-genre="jazz"]');
    assert.match(app.document.getElementById('station-list').textContent, /No signals matched/);
    app.click('#btn-reset-empty');
    await app.flush();
    assert.equal(app.sb.state.genre, 'all');
    assert.equal(app.document.querySelectorAll('#station-list article').length, 7);
    app.close();
  });

  it('collapsed pill shows the station count and city; collapse/expand toggles the sheet', async () => {
    const app = await loadApp({ radio: () => list7() });
    assert.equal(app.document.getElementById('collapsed-count-label').textContent, '7 stations · Bengaluru');
    app.click('#btn-collapse-sheet');
    assert.equal(app.document.getElementById('station-sheet').classList.contains('hidden'), true);
    assert.equal(app.document.getElementById('btn-expand-sheet').classList.contains('hidden'), false);
    app.click('#btn-expand-sheet');
    assert.equal(app.document.getElementById('station-sheet').classList.contains('hidden'), false);
    app.close();
  });

  it('filter shelf toggles; band chips + sort select re-render and light the filter dot', async () => {
    const app = await loadApp({ radio: () => list7() });
    const shelf = app.document.getElementById('filter-shelf');
    const wasHidden = shelf.classList.contains('hidden');
    app.click('#btn-toggle-filters');
    assert.notEqual(shelf.classList.contains('hidden'), wasHidden);
    assert.equal(app.document.getElementById('active-filter-dot').classList.contains('hidden'), true);
    app.click('.band-btn[data-band="am"]');
    assert.equal(app.sb.state.band, 'am');
    assert.equal(app.document.getElementById('active-filter-dot').classList.contains('hidden'), false);
    const sel = app.document.getElementById('sort-select');
    sel.value = 'popular';
    sel.dispatchEvent(new app.window.Event('change'));
    assert.equal(app.sb.state.sortBy, 'popular');
    app.close();
  });
});

describe('scope scrubber + location', () => {
  it('each scope relabels the heading and reloads stations', async () => {
    const app = await loadApp({ radio: () => list7() });
    const heading = () => app.document.getElementById('location-heading').textContent;
    const expectations = [['global', 'World Best'], ['country', 'India'], ['state', 'Karnataka'], ['city', 'Bengaluru'], ['nearby', 'Bengaluru']];
    for (const [scope, label] of expectations) {
      const before = app.calls.fetch.length;
      app.click(`.scope-btn[data-scope="${scope}"]`);
      await app.flush();
      assert.equal(app.sb.state.scope, scope);
      assert.equal(heading(), label, scope);
      assert.ok(app.calls.fetch.length > before, `${scope} fetched`);
    }
    app.close();
  });

  it('the active scope button is highlighted', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('.scope-btn[data-scope="country"]');
    assert.match(app.document.querySelector('.scope-btn[data-scope="country"]').className, /border-\[#ff7a18\]/);
    assert.match(app.document.querySelector('.scope-btn[data-scope="city"]').className, /border-transparent/);
    app.close();
  });

  it('quick-city chips jump to that city', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('[data-anchor-city="Tokyo"]');
    assert.equal(cityOf(app), 'Tokyo');
    assert.match(app.document.getElementById('location-subline').textContent, /Japan/);
    app.close();
  });

  it('vibe match toggles and shows the local time period', async () => {
    const app = await loadApp({ radio: () => list7(), now: '2026-11-23T03:30:00Z' });
    assert.equal(app.document.getElementById('vibe-label').textContent, 'Morning');
    app.click('#btn-vibe-match');
    assert.equal(app.document.getElementById('vibe-label').textContent, 'Morning On');
    app.close();
  });
});

describe('Near Me (geolocation + reverse geocoding)', () => {
  it('no geolocation API: tells the user to click the map', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('#btn-locate');
    assert.match(app.toast().text, /Click any country/);
    app.close();
  });

  it('success: reverse-geocodes, switches to nearby scope, loads stations', async () => {
    const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 35.68, longitude: 139.69 } }) };
    const app = await loadApp({
      radio: () => list7(), geo,
      nominatim: () => ({ address: { city: 'Shinjuku', state: 'Tokyo', country: 'Japan', country_code: 'jp' } })
    });
    const before = app.calls.fetch.length;
    app.click('#btn-locate');
    await app.flush(15);
    assert.equal(app.sb.state.scope, 'nearby');
    assert.equal(cityOf(app), 'Shinjuku');
    assert.equal(app.sb.state.location.countryCode, 'JP');
    assert.ok(app.calls.fetch.slice(before).some((u) => u.startsWith('https://nominatim.openstreetmap.org/reverse?')));
    assert.ok(app.calls.fetch.slice(before).some((u) => u.includes('countrycode=JP')));
    app.close();
  });

  it('denied: shows a helpful toast and keeps the current place', async () => {
    const geo = { getCurrentPosition: (_ok, err) => err({ code: 1 }) };
    const app = await loadApp({ radio: () => list7(), geo });
    app.click('#btn-locate');
    assert.match(app.toast().text, /Location declined/);
    assert.equal(cityOf(app), 'Bengaluru');
    app.close();
  });

  it('reverse-geocoder outage falls back to the nearest anchor city at the true coordinates', async () => {
    const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 48.9, longitude: 2.4 } }) };
    const app = await loadApp({ radio: () => list7(), geo, nominatim: () => { throw new Error('down'); } });
    app.click('#btn-locate');
    await app.flush(15);
    assert.equal(cityOf(app), 'Paris');
    assert.equal(app.sb.state.location.lat, 48.9);
    assert.equal(app.sb.state.location.lng, 2.4);
    app.close();
  });

  it('uses the request timeout option and only https endpoints', async () => {
    let opts;
    const geo = { getCurrentPosition: (ok, _err, o) => { opts = o; } };
    const app = await loadApp({ radio: () => list7(), geo });
    app.click('#btn-locate');
    assert.deepEqual(plain(opts), { timeout: 6000 });
    app.close();
  });
});

describe('map views', () => {
  it('Street view builds a Leaflet map with the ArcGIS street tiles and hides the SVG globe', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('.proj-btn[data-proj="street"]');
    app.clock.tick(60);
    assert.equal(app.calls.leaflet.maps.length, 1);
    assert.equal(app.calls.leaflet.maps[0].id, 'leaflet-map');
    assert.deepEqual(plain(app.calls.leaflet.tiles.map((t) => t.url)), ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}']);
    assert.equal(app.document.getElementById('world-svg').classList.contains('hidden'), true);
    assert.equal(app.document.getElementById('leaflet-map').classList.contains('hidden'), false);
    assert.deepEqual(plain(app.calls.leaflet.maps[0].view), [[12.97194, 77.59369], 11]);
    app.close();
  });

  it('Satellite view adds imagery + the place-name reference overlay, and reuses the same Leaflet map', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('.proj-btn[data-proj="street"]');
    app.click('.proj-btn[data-proj="satellite"]');
    const urls = plain(app.calls.leaflet.tiles.map((t) => t.url));
    assert.equal(app.calls.leaflet.maps.length, 1);
    assert.ok(urls.some((u) => u.includes('World_Imagery')));
    assert.ok(urls.some((u) => u.includes('World_Boundaries_and_Places')));
    for (const u of urls) assert.match(u, /^https:\/\/server\.arcgisonline\.com\//);
    app.close();
  });

  it('switching back to Globe/Flat shows the SVG and re-centres on the active place', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.click('.proj-btn[data-proj="street"]');
    app.click('[data-anchor-city="Tokyo"]');
    app.click('.proj-btn[data-proj="globe"]');
    assert.equal(app.document.getElementById('world-svg').classList.contains('hidden'), false);
    assert.equal(app.document.getElementById('leaflet-map').classList.contains('hidden'), true);
    assert.ok(Math.abs(app.sb.globeRotate[0] + 139.6917) < 1e-6);
    app.click('.proj-btn[data-proj="flat"]');
    assert.equal(app.sb.state.projMode, 'flat');
    assert.equal(app.document.querySelectorAll('.layer-land path').length > 150, true);
    app.close();
  });

  it('the active view button is highlighted and exactly 4 views are exposed', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('.proj-btn[data-proj="flat"]');
    assert.match(app.document.querySelector('.proj-btn[data-proj="flat"]').className, /bg-\[#ff7a18\]/);
    assert.doesNotMatch(app.document.querySelector('.proj-btn[data-proj="globe"]').className, /bg-\[#ff7a18\]/);
    assert.equal(app.document.querySelectorAll('.proj-btn').length, 4);
    app.close();
  });

  it('zoom buttons clamp the globe scale (140..1800) and the flat scale (0.8..8); reset restores defaults', async () => {
    const app = await loadApp({ radio: () => [] });
    for (let i = 0; i < 40; i++) app.click('#btn-zoom-in');
    assert.equal(app.sb.globeScale, 1800);
    for (let i = 0; i < 60; i++) app.click('#btn-zoom-out');
    assert.equal(app.sb.globeScale, 140);
    app.click('#btn-zoom-reset');
    assert.ok(Math.abs(app.sb.globeScale - 800 * 0.38) < 1e-9);
    app.click('.proj-btn[data-proj="flat"]');
    for (let i = 0; i < 40; i++) app.click('#btn-zoom-in');
    assert.equal(app.sb.flatTransform.k, 8);
    for (let i = 0; i < 60; i++) app.click('#btn-zoom-out');
    assert.ok(Math.abs(app.sb.flatTransform.k - 0.8) < 1e-9);
    app.close();
  });

  it('zoom buttons drive Leaflet in street view', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('.proj-btn[data-proj="street"]');
    app.click('#btn-zoom-in');
    assert.equal(app.calls.leaflet.maps[0].zoomed, 'in');
    app.click('#btn-zoom-out');
    assert.equal(app.calls.leaflet.maps[0].zoomed, 'out');
    app.close();
  });

  it('station dots appear on the globe; clicking one opens the popup, whose Play button plays it', async () => {
    const app = await loadApp({ radio: () => list7() });
    const dots = app.document.querySelectorAll('.layer-stations circle.st-dot');
    assert.ok(dots.length >= 7);
    dots[0].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, clientX: 600, clientY: 300 }));
    const popup = app.document.getElementById('map-popup');
    assert.equal(popup.classList.contains('hidden'), false);
    assert.ok(app.document.getElementById('map-popup-title').textContent.startsWith('Station'));
    app.click('#btn-popup-play');
    assert.equal(app.calls.audio.play.length, 1);
    assert.equal(popup.classList.contains('hidden'), true);
    app.close();
  });

  it('the terminator toggle removes/restores the night shadow', async () => {
    const app = await loadApp({ radio: () => [] });
    await app.flush(12);
    app.click('#btn-toggle-terminator');
    assert.equal(app.document.getElementById('btn-toggle-terminator').textContent, 'OFF');
    assert.equal(app.document.querySelectorAll('.layer-night path').length, 0);
    app.click('#btn-toggle-terminator');
    assert.equal(app.document.querySelectorAll('.layer-night path').length, 1);
    app.close();
  });

  it('still lists and plays stations if the D3/TopoJSON CDN scripts fail to load (map degrades, no unhandled error)', async () => {
    const rejections = [];
    const onRej = (e) => rejections.push(String(e));
    process.on('unhandledRejection', onRej);
    const app = await loadApp({ radio: () => list7(), noLibs: true });
    await app.flush(12);
    process.removeListener('unhandledRejection', onRej);
    assert.deepEqual(rejections, []);
    assert.match(app.toast().text, /map library/i);
    assert.equal(app.document.querySelectorAll('#station-list article').length, 7);
    app.click('#station-list article');
    assert.equal(app.calls.audio.play.length, 1);
    app.click('.proj-btn[data-proj="street"]');
    app.clock.tick(60);
    assert.equal(app.calls.leaflet.maps.length, 1);
    app.close();
  });
});

describe('Explore menu', () => {
  it('Spin the Globe lands on a different anchor city (and closes the menu)', async () => {
    const app = await loadApp({ radio: () => list7(), random: () => 0 });
    app.click('#btn-explore');
    assert.equal(app.document.getElementById('explore-popover').classList.contains('hidden'), false);
    app.click('#mode-spin-globe');
    assert.notEqual(cityOf(app), 'Bengaluru');
    assert.match(app.toast().text, /^Landed in /);
    assert.equal(app.document.getElementById('explore-popover').classList.contains('hidden'), true);
    app.close();
  });

  it('Follow the Night picks a city currently in darkness and auto-plays', async () => {
    const app = await loadApp({ radio: () => list7(), now: '2026-11-23T15:00:00Z', random: () => 0 });
    app.click('#mode-follow-night');
    const h = app.sb.getLocalTimeInfo(app.sb.state.location).hour;
    assert.ok(h >= 21 || h < 5, `hour ${h}`);
    assert.match(app.toast().text, /^Follow the Night → /);
    assert.equal(app.sb.state.vibeActive, true);
    await app.flush(10);
    assert.equal(app.calls.audio.play.length >= 1, true);
    app.close();
  });

  it('Golden Hour picks a city in the 05-08h or 16-19h window', async () => {
    const app = await loadApp({ radio: () => list7(), now: '2026-11-23T03:30:00Z', random: () => 0 });
    app.click('#mode-golden-hour');
    const h = app.sb.getLocalTimeInfo(app.sb.state.location).hour;
    assert.ok((h >= 5 && h <= 8) || (h >= 16 && h <= 19), `hour ${h}`);
    app.close();
  });

  it('Follow the Night / Golden Hour still work when no city qualifies (falls back to any anchor)', async () => {
    const app = await loadApp({ radio: () => list7(), random: () => 0.5 });
    app.sb.ANCHOR_PLACES.splice(0, app.sb.ANCHOR_PLACES.length, { city: 'Solo', county: '', state: 'S', country: 'C', countryCode: 'XX', lat: 0, lng: 0, tz: 'Asia/Kolkata' });
    app.sb.followTheNight();
    assert.equal(cityOf(app), 'Solo');
    app.close();
  });

  it('World Tour: starts, hops every 45s, can be skipped, and stops cleanly', async () => {
    const app = await loadApp({ radio: () => list7(), random: () => 0 });
    app.click('#mode-world-tour');
    assert.equal(app.sb.state.tourActive, true);
    assert.equal(app.document.getElementById('tour-banner').classList.contains('hidden'), false);
    assert.equal(app.document.getElementById('tour-status-tag').textContent, 'ON');
    const first = cityOf(app);
    assert.notEqual(first, 'Bengaluru');
    app.clock.tick(10000);
    assert.equal(app.document.getElementById('tour-countdown').textContent, '35s');
    app.clock.tick(35000);
    const second = cityOf(app);
    assert.notEqual(second, first);
    assert.equal(app.document.getElementById('tour-countdown').textContent, '45s');
    app.click('#btn-tour-skip');
    assert.notEqual(cityOf(app), second);
    app.click('#btn-tour-stop');
    assert.equal(app.sb.state.tourActive, false);
    assert.equal(app.sb.state.tourIntervalId, null);
    assert.equal(app.document.getElementById('tour-banner').classList.contains('hidden'), true);
    assert.equal(app.document.getElementById('tour-status-tag').textContent, 'OFF');
    assert.match(app.toast().text, /^Staying in /);
    app.close();
  });

  it('World Tour menu item toggles it off; manual navigation (scope click) also ends the tour', async () => {
    const app = await loadApp({ radio: () => list7(), random: () => 0 });
    app.click('#mode-world-tour');
    app.click('#mode-world-tour');
    assert.equal(app.sb.state.tourActive, false);
    app.click('#mode-world-tour');
    app.click('.scope-btn[data-scope="country"]');
    assert.equal(app.sb.state.tourActive, false);
    app.close();
  });

  it('World Passport entries relocate to that country', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    app.audioEvent('playing');
    app.click('[data-stamp-country="India"]');
    assert.equal(app.sb.state.scope, 'country');
    assert.equal(app.document.getElementById('location-heading').textContent, 'India');
    app.close();
  });
});

describe('popovers, toast, keyboard', () => {
  it('brand button opens diagnostics; clicking elsewhere closes popovers; only one is open at a time', async () => {
    const app = await loadApp({ radio: () => list7() });
    const status = app.document.getElementById('status-popover');
    const explore = app.document.getElementById('explore-popover');
    app.click('#btn-brand-status');
    assert.equal(status.classList.contains('hidden'), false);
    assert.match(app.document.getElementById('diag-content').textContent, /Mirror: de1\.api\.radio-browser\.info/);
    app.click('#btn-explore');
    assert.equal(status.classList.contains('hidden'), true);
    assert.equal(explore.classList.contains('hidden'), false);
    app.click('#map-stage');
    assert.equal(explore.classList.contains('hidden'), true);
    app.close();
  });

  it('toast auto-hides after 4s; a newer toast replaces the older one and restarts the timer', async () => {
    const app = await loadApp({ radio: () => [] });
    app.sb.showToast('one');
    app.clock.tick(3000);
    app.sb.showToast('two');
    app.clock.tick(3000);
    assert.deepEqual(app.toast(), { text: 'two', hidden: false });
    app.clock.tick(1001);
    assert.equal(app.toast().hidden, true);
    app.close();
  });

  it('keyboard: Space play/pause, arrows skip, "/" focuses search, "m" mutes, "g" spins', async () => {
    const app = await loadApp({ radio: () => list7(), random: () => 0 });
    app.key(' ');
    assert.ok(app.sb.state.currentStation);
    const first = app.sb.state.currentStation.stationuuid;
    app.key('ArrowRight');
    assert.notEqual(app.sb.state.currentStation.stationuuid, first);
    app.key('ArrowLeft');
    assert.equal(app.sb.state.currentStation.stationuuid, first);
    app.key('/');
    assert.equal(app.document.activeElement, app.document.getElementById('search-input'));
    app.document.activeElement.blur();
    app.key('m');
    assert.equal(app.audio.muted, true);
    const city = cityOf(app);
    app.key('g');
    assert.notEqual(cityOf(app), city);
    app.close();
  });

  it('BUG REGRESSION: browser shortcuts with Cmd/Ctrl/Alt (e.g. Cmd+G "find next") do not trigger app shortcuts', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.key('g', { metaKey: true });
    app.key('g', { ctrlKey: true });
    app.key('m', { altKey: true });
    assert.equal(cityOf(app), 'Bengaluru');
    assert.equal(app.audio.muted, false);
    app.close();
  });

  it('keyboard shortcuts are ignored while typing in the search box or using a <select>', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.document.getElementById('search-input').focus();
    app.key(' ');
    app.key('g');
    assert.equal(app.sb.state.currentStation, null);
    assert.equal(cityOf(app), 'Bengaluru');
    app.close();
  });

  it('BUG REGRESSION: arrow keys on the focused volume slider adjust volume, not the station', async () => {
    const app = await loadApp({ radio: () => list7() });
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    const cur = app.sb.state.currentStation.stationuuid;
    app.document.getElementById('volume-slider').focus();
    app.key('ArrowRight');
    assert.equal(app.sb.state.currentStation.stationuuid, cur);
    app.close();
  });
});

describe('player pill content', () => {
  it('shows name, band/freq, region, codec + bitrate and a signal meter', async () => {
    const app = await loadApp({ radio: () => many(7, (i) => ({ name: `Hits ${90 + i}.5 FM`, codec: 'AAC', bitrate: 96, geo_lat: 12.95, geo_long: 77.6 })) });
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    assert.match(app.document.getElementById('player-title').textContent, /^Hits \d+\.5 FM$/);
    assert.match(app.document.getElementById('player-subtitle').textContent, /\d+\.5 FM · Karnataka · AAC 96k/);
    assert.equal(app.document.querySelectorAll('#player-signal-slot .sig-bar').length, 4);
    app.close();
  });
});
