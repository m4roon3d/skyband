'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load');

const offline = () => { throw new Error('offline'); };

describe('Featured catalogue (free, official streams)', () => {
  it('every entry is complete, HTTPS, and has valid coordinates', async () => {
    const app = await loadApp({ radio: () => [] });
    const list = plain(app.sb.FEATURED_STATIONS);
    assert.ok(list.length >= 20);
    for (const s of list) {
      assert.match(s.stationuuid, /^featured-[a-z0-9-]+$/, s.name);
      assert.ok(s.name && s.country && s.countrycode.length === 2 && s.tags && s.language, s.name);
      assert.match(s.url_resolved, /^https:\/\/[^/\s]+\/\S+$/, s.name);
      assert.ok(['MP3', 'AAC'].includes(s.codec), s.name);
      assert.ok(s.bitrate >= 64 && s.bitrate <= 320, s.name);
      assert.ok(s.geo_lat >= -90 && s.geo_lat <= 90 && s.geo_long >= -180 && s.geo_long <= 180, s.name);
      assert.ok(!/\.(m3u8?|pls|asx)(\?|$)/i.test(s.url_resolved), `${s.name}: playlist URL, not a stream`);
    }
    app.close();
  });

  it('ids, names and stream URLs are unique', async () => {
    const app = await loadApp({ radio: () => [] });
    const list = plain(app.sb.FEATURED_STATIONS);
    for (const key of ['stationuuid', 'name', 'url_resolved']) assert.equal(new Set(list.map((s) => s[key])).size, list.length, key);
    app.close();
  });

  it('POLICY: only broadcasters that publish free streams; no paywalled/DRM services', async () => {
    const app = await loadApp({ radio: () => [] });
    const banned = ['siriusxm', 'sxm.', 'spotify', 'tidal', 'deezer', 'apple.com', 'amazon', 'pandora', 'qobuz', 'napster', 'audible'];
    for (const s of plain(app.sb.FEATURED_STATIONS)) {
      const host = new URL(s.url_resolved).hostname;
      for (const b of banned) assert.ok(!host.includes(b), `${s.name} -> ${host}`);
    }
    app.close();
  });

  it('includes the headline free broadcasters', async () => {
    const app = await loadApp({ radio: () => [] });
    const names = plain(app.sb.FEATURED_STATIONS).map((s) => s.name).join('|');
    for (const n of ['SomaFM', 'Radio Paradise', 'KEXP', 'FIP', 'NTS', 'Radio Swiss', 'BBC World Service', 'Jazz24']) assert.ok(names.includes(n), n);
    app.close();
  });

  it('the source list stays raw: normalising for display never mutates it', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    for (const s of app.sb.FEATURED_STATIONS) assert.equal('signal' in s, false);
    app.close();
  });
});

describe('Featured tab', () => {
  it('is offered next to Dial / Saved / Log and highlights when active', async () => {
    const app = await loadApp({ radio: () => [] });
    const labels = [...app.document.querySelectorAll('.nav-tab')].map((b) => b.dataset.tab);
    assert.deepEqual(labels, ['explore', 'featured', 'favorites', 'recent']);
    app.click('[data-tab="featured"]');
    assert.match(app.document.querySelector('[data-tab="featured"]').className, /bg-white\/15/);
    assert.doesNotMatch(app.document.querySelector('[data-tab="explore"]').className, /bg-white\/15/);
    assert.equal(app.document.getElementById('active-filter-dot').classList.contains('hidden'), false);
    app.close();
  });

  it('lists every featured station, even when Radio Browser is completely down', async () => {
    const app = await loadApp({ radio: offline });
    assert.equal(app.sb.state.usingFallback, true);
    app.click('[data-tab="featured"]');
    assert.equal(app.document.querySelectorAll('#station-list article').length, app.sb.FEATURED_STATIONS.length);
    assert.match(app.document.getElementById('station-list').textContent, /SomaFM — Groove Salad/);
    assert.deepEqual(app.errors, []);
    app.close();
  });

  it('is independent of the place scope (Bengaluru city vs World)', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    const before = app.document.querySelectorAll('#station-list article').length;
    app.click('.scope-btn[data-scope="global"]');
    // changing scope returns to the Dial, so go back to Featured and compare
    app.click('[data-tab="featured"]');
    assert.equal(app.document.querySelectorAll('#station-list article').length, before);
    app.close();
  });

  it('tapping a featured card plays that stream; next/previous stay inside Featured', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    const first = app.sb.getVisibleStations()[0];
    app.click('#station-list article');
    assert.equal(app.calls.audio.play[0], first.url_resolved);
    app.click('#btn-next');
    assert.ok(app.sb.state.currentStation.stationuuid.startsWith('featured-'));
    assert.notEqual(app.sb.state.currentStation.stationuuid, first.stationuuid);
    app.close();
  });

  it('genre chips filter Featured (jazz -> only jazz stations)', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    app.click('.genre-btn[data-genre="jazz"]');
    const names = plain(app.sb.getVisibleStations().map((s) => s.name));
    assert.ok(names.length >= 3);
    for (const n of ['Jazz24', 'Radio Swiss Jazz', 'FIP — Jazz', 'SomaFM — Sonic Universe']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('KEXP Seattle'));
    app.close();
  });

  it('saving a featured station persists it to Saved', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    app.click('#station-list [data-action="fav"]');
    assert.equal(app.sb.state.favorites.length, 1);
    assert.ok(app.sb.state.favorites[0].stationuuid.startsWith('featured-'));
    app.click('[data-tab="favorites"]');
    assert.equal(app.document.querySelectorAll('#station-list article').length, 1);
    app.close();
  });

  it('a failed featured stream is auto-skipped to the next featured one (stall guard)', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a);
    app.clock.tick(7000); app.clock.tick(450);
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    assert.equal(app.sb.state.currentStation.stationuuid, b.stationuuid);
    app.close();
  });

  it('Dial still works after visiting Featured', async () => {
    const app = await loadApp({ radio: () => [] });
    app.click('[data-tab="featured"]');
    app.click('[data-tab="explore"]');
    assert.equal(app.sb.state.activeTab, 'explore');
    assert.ok(app.sb.state.stations.every((s) => !s.stationuuid.startsWith('featured-')));
    app.close();
  });
});
