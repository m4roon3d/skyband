'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load');
const { rawStation, many } = require('./helpers/fixtures');

const radioCalls = (app) => app.calls.fetch.filter((u) => u.includes('radio-browser.info'));
const paramsOf = (u) => Object.fromEntries(new URL(u).searchParams);

describe('fetchRadioBrowser', () => {
  it('sends https-only, hide-broken, most-clicked-first defaults', async () => {
    const app = await loadApp({ radio: () => [rawStation()] });
    const first = paramsOf(radioCalls(app)[0]);
    assert.equal(first.is_https, 'true');
    assert.equal(first.hidebroken, 'true');
    assert.equal(first.order, 'clickcount');
    assert.equal(first.reverse, 'true');
    app.close();
  });

  it('only talks to the three https Radio Browser mirrors', async () => {
    const app = await loadApp({ radio: () => [rawStation()] });
    for (const u of radioCalls(app)) assert.match(u, /^https:\/\/(de1|nl1|at1)\.api\.radio-browser\.info\/json\/stations\/search\?/);
    app.close();
  });

  it('fails over to the next mirror when the first throws', async () => {
    const app = await loadApp({ radio: (_p, url) => { if (url.includes('de1.')) throw new Error('down'); return [rawStation()]; } });
    assert.equal(app.sb.state.diagnostics.mirror, 'nl1.api.radio-browser.info');
    assert.equal(app.sb.state.usingFallback, false);
    app.close();
  });

  it('fails over past a mirror that answers with a non-array body', async () => {
    const app = await loadApp({ radio: (_p, url) => (url.includes('de1.') ? { error: 'rate limited' } : [rawStation()]) });
    assert.equal(app.sb.state.diagnostics.mirror, 'nl1.api.radio-browser.info');
    app.close();
  });

  it('rejects with "Mirrors unreachable" when every mirror fails', async () => {
    const app = await loadApp({ radio: () => { throw new Error('offline'); } });
    await assert.rejects(app.sb.fetchRadioBrowser({ name: 'x' }), /Mirrors unreachable/);
    app.close();
  });
});

describe('loadStationsForScope', () => {
  it('city scope (Bengaluru): queries city + aliases, state, country geo/FM and AIR/Akashvani/Vividh seeds', async () => {
    const app = await loadApp({ radio: () => [] });
    const qs = plain(app.sb.state.diagnostics.queriesRun);
    for (const q of ['city:Bengaluru', 'city:bangalore', 'city:kannada', 'state:Karnataka', 'IN:geo', 'IN:FM', 'IN:AIR', 'IN:Akashvani', 'IN:Vividh']) assert.ok(qs.includes(q), `${q} in ${qs}`);
    assert.equal(radioCalls(app).length, 14);
    app.close();
  });

  it('search query scope: name/tag/state lookups for the typed term', async () => {
    const app = await loadApp({ radio: () => [] });
    const before = radioCalls(app).length;
    app.sb.state.searchQuery = 'jazz';
    await app.sb.loadStationsForScope();
    const calls = radioCalls(app).slice(before).map(paramsOf);
    assert.equal(calls.length, 3);
    assert.ok(calls.some((p) => p.name === 'jazz'));
    assert.ok(calls.some((p) => p.tag === 'jazz'));
    assert.ok(calls.some((p) => p.state === 'jazz'));
    assert.deepEqual(plain(app.sb.state.diagnostics.queriesRun), ['q:jazz']);
    app.close();
  });

  it('search expands city aliases and accent-stripped terms', async () => {
    const app = await loadApp({ radio: () => [] });
    const before = radioCalls(app).length;
    app.sb.state.searchQuery = 'bombay';
    await app.sb.loadStationsForScope();
    assert.equal(radioCalls(app).length - before, 3); // 'bombay' is not itself an alias key
    app.sb.state.searchQuery = 'mumbai';
    const b2 = radioCalls(app).length;
    await app.sb.loadStationsForScope();
    assert.equal(radioCalls(app).length - b2, 9); // mumbai + bombay + marathi
    app.close();
  });

  it('global scope: world geo, FM and jazz queries', async () => {
    const app = await loadApp({ radio: () => [] });
    app.sb.state.scope = 'global';
    const before = radioCalls(app).length;
    await app.sb.loadStationsForScope();
    const calls = radioCalls(app).slice(before).map(paramsOf);
    assert.equal(calls.length, 3);
    assert.ok(calls.some((p) => p.has_geo_info === 'true' && p.limit === '250'));
    assert.ok(calls.some((p) => p.tag === 'fm'));
    assert.ok(calls.some((p) => p.tag === 'jazz'));
    app.close();
  });

  it('country scope uses the active country code (and falls back to IN when unknown)', async () => {
    const app = await loadApp({ radio: () => [] });
    app.sb.state.scope = 'country';
    app.sb.state.location = { ...app.sb.ANCHOR_PLACES.find((p) => p.city === 'Tokyo') };
    let before = radioCalls(app).length;
    await app.sb.loadStationsForScope();
    let calls = radioCalls(app).slice(before).map(paramsOf);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((p) => p.countrycode === 'JP'));
    app.sb.state.location = { city: 'X', state: '', country: 'Nowhere', countryCode: '', lat: 0, lng: 0 };
    before = radioCalls(app).length;
    await app.sb.loadStationsForScope();
    calls = radioCalls(app).slice(before).map(paramsOf);
    assert.ok(calls.every((p) => p.countrycode === 'IN'));
    app.close();
  });

  it('drops non-https stream URLs (mixed-content safe)', async () => {
    const good = many(7, { geo_lat: 12.9, geo_long: 77.6 });
    const bad = [rawStation({ url_resolved: 'http://insecure.example/s.mp3' }), rawStation({ url_resolved: '' })];
    const app = await loadApp({ radio: () => [...good, ...bad] });
    assert.equal(app.sb.state.stations.length, 7);
    assert.ok(app.sb.state.stations.every((s) => s.url_resolved.startsWith('https://')));
    app.close();
  });

  it('city scope narrows to nearby/local stations when at least 6 match', async () => {
    const local = many(6, { geo_lat: 12.95, geo_long: 77.6 });
    const far = many(3, { state: 'Delhi', tags: 'pop', geo_lat: 28.6, geo_long: 77.2 });
    const app = await loadApp({ radio: () => [...local, ...far] });
    assert.equal(app.sb.state.stations.length, 6);
    app.close();
  });

  it('city scope keeps everything when fewer than 6 are local (never empties the dial)', async () => {
    const local = many(5, { geo_lat: 12.95, geo_long: 77.6 });
    const far = many(3, { state: 'Delhi', tags: 'pop', geo_lat: 28.6, geo_long: 77.2 });
    const app = await loadApp({ radio: () => [...local, ...far] });
    assert.equal(app.sb.state.stations.length, 8);
    app.close();
  });

  it('state scope keeps stations whose state matches or within 350 km', async () => {
    const inState = many(6, { state: 'Karnataka', geo_lat: 13, geo_long: 77.5 });
    const far = many(3, { state: 'Punjab', tags: 'pop', geo_lat: 31, geo_long: 75 });
    const app = await loadApp({ radio: () => [...inState, ...far] });
    app.sb.state.scope = 'state';
    await app.sb.loadStationsForScope();
    assert.equal(app.sb.state.stations.length, 6);
    app.close();
  });

  it('falls back to the 4 verified HTTPS backup streams when the network returns nothing', async () => {
    const app = await loadApp({ radio: () => [] });
    assert.equal(app.sb.state.usingFallback, true);
    assert.deepEqual(plain(app.sb.state.stations.map((s) => s.stationuuid)), ['fallback-rp-main', 'fallback-somafm-groove', 'fallback-somafm-drone', 'fallback-somafm-defcon']);
    assert.equal(app.document.getElementById('diag-mirror-pill').textContent, 'BACKUP');
    app.close();
  });

  it('falls back (and does not crash) when every mirror is down', async () => {
    const app = await loadApp({ radio: () => { throw new Error('offline'); } });
    assert.equal(app.sb.state.usingFallback, true);
    assert.equal(app.sb.state.stations.length, 4);
    assert.deepEqual(app.errors, []);
    assert.ok(app.document.querySelectorAll('#station-list article').length === 4);
    app.close();
  });

  it('records diagnostics: live count, band counts, HLS count, high-signal count', async () => {
    const data = [
      ...many(6, { name: 'Hits 93.5 FM', geo_lat: 12.95, geo_long: 77.6 }),
      rawStation({ name: 'Akashvani', geo_lat: 12.95, geo_long: 77.6, state: 'Karnataka' }),
      rawStation({ name: 'Live HLS', url_resolved: 'https://x.example/a.m3u8', geo_lat: 12.95, geo_long: 77.6 })
    ];
    const app = await loadApp({ radio: () => data });
    const d = app.sb.state.diagnostics;
    assert.equal(d.totalRaw, 8);
    assert.equal(d.fmCount, 6);
    assert.equal(d.amCount, 1);
    assert.equal(d.hlsCount, 1);
    assert.ok(d.highSignalCount >= 6);
    assert.equal(app.document.getElementById('diag-mirror-pill').textContent, 'LIVE · 8');
    app.close();
  });

  it('autoPlayBest starts the top non-failed station', async () => {
    const data = many(7, (i) => ({ clickcount: 1000 - i, geo_lat: 12.95, geo_long: 77.6 }));
    const app = await loadApp({ radio: () => data });
    const top = app.sb.getVisibleStations()[0];
    app.sb.state.sessionStreamHealth[top.stationuuid] = 'failed';
    await app.sb.loadStationsForScope(true);
    assert.notEqual(app.sb.state.currentStation.stationuuid, top.stationuuid);
    assert.equal(app.calls.audio.play.length, 1);
    app.close();
  });

  it('shows a scanning spinner while loading, then the list', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let slow = false;
    const list = many(7, { geo_lat: 12.95, geo_long: 77.6 });
    const app = await loadApp({ radio: async () => { if (slow) await gate; return list; } });
    slow = true;
    const p = app.sb.loadStationsForScope();
    assert.match(app.document.getElementById('station-list').textContent, /Scanning Bengaluru/);
    release();
    await p;
    assert.equal(app.document.querySelectorAll('#station-list article').length, 7);
    app.close();
  });

  it('BUG REGRESSION: a slow older request must not overwrite the results of a newer one', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let mode = 'init';
    const stale = many(7, { name: 'STALE', geo_lat: 12.95, geo_long: 77.6 });
    const fresh = many(7, { name: 'FRESH', geo_lat: 12.95, geo_long: 77.6 });
    const app = await loadApp({
      radio: async () => {
        if (mode === 'slow') { await gate; return stale; }
        if (mode === 'fast') return fresh;
        return [];
      }
    });
    mode = 'slow';
    const slow = app.sb.loadStationsForScope();
    app.sb.state.scope = 'global';
    mode = 'fast';
    const fast = app.sb.loadStationsForScope();
    await fast;
    release();
    await slow;
    await app.flush();
    assert.ok(app.sb.state.stations.every((s) => s.name === 'FRESH'), 'stale response replaced fresh data');
    assert.equal(app.sb.state.isFetching, false);
    assert.doesNotMatch(app.document.getElementById('station-list').textContent, /STALE/);
    app.close();
  });
});

describe('getVisibleStations: filter + sort', () => {
  async function appWith(list) {
    const app = await loadApp({ radio: () => list });
    app.sb.state.scope = 'city';
    return app;
  }
  const mk = () => [
    rawStation({ name: 'Alpha 93.5 FM', tags: 'pop', clickcount: 10, votes: 1, bitrate: 64, geo_lat: 12.95, geo_long: 77.6 }),
    rawStation({ name: 'Beta Jazz', tags: 'jazz,smooth', clickcount: 900, votes: 50, bitrate: 320, geo_lat: 13.5, geo_long: 77.9, lastcheckok: 0 }),
    rawStation({ name: 'Gamma 720 AM', tags: 'news', clickcount: 100, votes: 500, bitrate: 128, geo_lat: 12.9, geo_long: 77.58 }),
    rawStation({ name: 'Delta Kannada', tags: 'kannada,hits', clickcount: 400, votes: 5, bitrate: 192, geo_lat: 12.97, geo_long: 77.59, language: 'kannada' }),
    rawStation({ name: 'Echo', tags: 'rock', clickcount: 50, votes: 5, bitrate: 96, geo_lat: 13.1, geo_long: 77.7 }),
    rawStation({ name: 'Foxtrot', tags: 'ambient', clickcount: 5, votes: 5, bitrate: 256, geo_lat: 12.8, geo_long: 77.5 })
  ];

  it('band filter', async () => {
    const app = await appWith(mk());
    app.sb.state.band = 'fm';
    assert.deepEqual(plain(app.sb.getVisibleStations().map((s) => s.name)), ['Alpha 93.5 FM']);
    app.sb.state.band = 'am';
    assert.deepEqual(plain(app.sb.getVisibleStations().map((s) => s.name)), ['Gamma 720 AM']);
    app.sb.state.band = 'web';
    assert.equal(app.sb.getVisibleStations().length, 4);
    app.close();
  });

  it('genre filter matches tags, language and name, case-insensitively', async () => {
    const app = await appWith(mk());
    app.sb.state.genre = 'jazz';
    assert.deepEqual(plain(app.sb.getVisibleStations().map((s) => s.name)), ['Beta Jazz']);
    app.sb.state.genre = 'Kannada';
    assert.deepEqual(plain(app.sb.getVisibleStations().map((s) => s.name)), ['Delta Kannada']);
    app.close();
  });

  it('sort: popular, bitrate, distance, likelihood', async () => {
    const app = await appWith(mk());
    const names = () => plain(app.sb.getVisibleStations().map((s) => s.name));
    app.sb.state.sortBy = 'popular';
    assert.equal(names()[0], 'Beta Jazz'); // 900 + 50
    assert.equal(names()[1], 'Gamma 720 AM'); // 100 + 500
    app.sb.state.sortBy = 'bitrate';
    assert.equal(names()[0], 'Beta Jazz');
    assert.equal(names()[1], 'Foxtrot');
    app.sb.state.sortBy = 'distance';
    assert.equal(names()[0], 'Delta Kannada'); // exactly at the city centre
    app.sb.state.sortBy = 'likelihood';
    assert.equal(names()[names().length - 1], 'Beta Jazz'); // lastcheckok = 0
    app.close();
  });

  it('smart sort pushes session-failed stations to the bottom', async () => {
    const app = await appWith(mk());
    const top = app.sb.getVisibleStations()[0];
    app.sb.state.sessionStreamHealth[top.stationuuid] = 'failed';
    const after = app.sb.getVisibleStations();
    assert.equal(after[after.length - 1].stationuuid, top.stationuuid);
    app.close();
  });

  it('vibe match boosts stations whose tags fit the local time of day', async () => {
    const app = await loadApp({ radio: () => mk(), now: '2026-11-23T03:30:00Z' }); // Bengaluru morning => news/pop
    app.sb.state.vibeActive = true;
    const names = plain(app.sb.getVisibleStations().map((s) => s.name));
    assert.ok(names.indexOf('Gamma 720 AM') < names.indexOf('Echo'));
    assert.ok(names.indexOf('Alpha 93.5 FM') < names.indexOf('Echo'));
    app.close();
  });

  it('taste counts nudge rank (capped at +6 per tag)', async () => {
    const app = await loadApp({ radio: () => mk(), storage: { atlasfm_taste: JSON.stringify({ ambient: 100 }) } });
    const foxtrot = app.sb.getVisibleStations().find((s) => s.name === 'Foxtrot');
    app.sb.state.tasteCounts = {};
    const plainRank = app.sb.getVisibleStations().find((s) => s.name === 'Foxtrot').smartRank;
    app.sb.state.tasteCounts = { ambient: 100 };
    const boosted = app.sb.getVisibleStations().find((s) => s.name === 'Foxtrot').smartRank;
    assert.equal(boosted - plainRank, 6);
    assert.ok(foxtrot);
    app.close();
  });

  it('favorites and recent tabs read from their own lists', async () => {
    const app = await appWith(mk());
    const [a, b] = app.sb.state.stations;
    app.sb.state.favorites = [a];
    app.sb.state.recent = [b, a];
    app.sb.state.activeTab = 'favorites';
    assert.equal(app.sb.getVisibleStations().length, 1);
    app.sb.state.activeTab = 'recent';
    assert.equal(app.sb.getVisibleStations().length, 2);
    app.close();
  });
});
