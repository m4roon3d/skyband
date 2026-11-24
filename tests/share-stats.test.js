'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');
const { many, rawStation } = require('./helpers/fixtures');

const radio = () => many(4, (i) => ({ name: `Station ${i}`, clickcount: 100 - i }));
const UUID = '11111111-2222-3333-4444-555555555555';
const shared = { stationuuid: UUID, name: 'Shared FM', url_resolved: 'https://example.test/s.mp3', url: 'https://example.test/s.mp3', country: 'France', countrycode: 'FR', codec: 'MP3', bitrate: 128, lastcheckok: 1 };

describe('Featured chip', () => {
  it('is visible without opening filters, toggles the Featured tab and highlights', async () => {
    const app = await loadApp({ radio });
    const chip = app.document.getElementById('btn-featured');
    assert.ok(chip);
    assert.equal(app.document.getElementById('filter-shelf').classList.contains('hidden'), true);
    app.click(chip);
    assert.equal(app.sb.state.activeTab, 'featured');
    assert.equal(chip.getAttribute('aria-pressed'), 'true');
    assert.ok(app.document.querySelectorAll('#station-list [data-station-id]').length > 0 || app.sb.getVisibleStations().length > 0);
    app.click(chip);
    assert.equal(app.sb.state.activeTab, 'explore');
    assert.equal(chip.getAttribute('aria-pressed'), 'false');
    app.close();
  });
});

describe('share link', () => {
  it('builds a link with station and place, no secrets', async () => {
    const app = await loadApp({ radio });
    app.sb.state.currentStation = { ...shared };
    const u = new URL(app.sb.buildShareUrl());
    const p = new URLSearchParams(u.hash.slice(1));
    assert.equal(p.get('u'), UUID);
    assert.equal(p.get('c'), 'Bengaluru');
    assert.ok(Number.isFinite(Number(p.get('la'))));
    app.close();
  });

  it('uses the native share sheet, falls back to clipboard, ignores cancel', async () => {
    const a = await loadApp({ radio, share: true, clipboard: true });
    a.click('#btn-share'); await a.flush();
    assert.equal(a.shared.share.length, 1);
    assert.match(a.shared.share[0].url, /^https:\/\/m4roon3d\.github\.io\/skyband\/#/);
    a.close();
    const b = await loadApp({ radio, clipboard: true });
    b.click('#btn-share'); await b.flush();
    assert.equal(b.shared.clip.length, 1);
    assert.match(b.toast().text, /copied/i);
    b.close();
    const c = await loadApp({ radio, share: 'abort', clipboard: true });
    c.click('#btn-share'); await c.flush();
    assert.equal(c.shared.clip.length, 0);
    c.close();
  });

  it('opening a shared link loads the place and station without autoplay, then cleans the URL', async () => {
    const app = await loadApp({ radio, byuuid: (u) => (u === UUID ? [rawStation({ ...shared })] : []),
      url: `https://m4roon3d.github.io/skyband/#u=${UUID}&n=Shared%20FM&la=48.857&lo=2.352&c=Paris&co=France&cc=FR` });
    await app.flush();
    assert.equal(app.sb.state.location.city, 'Paris');
    assert.equal(app.sb.state.currentStation.stationuuid, UUID);
    assert.equal(app.sb.state.isPlaying, false);
    assert.equal(app.sb.state.isLoadingAudio, false);
    assert.match(app.toast().text, /Tap play/);
    assert.equal(app.window.location.hash, '');
    app.close();
  });

  it('resolves shared Featured stations locally', async () => {
    const probe = await loadApp({ radio }); const fid = probe.sb.FEATURED_STATIONS[0].stationuuid; probe.close();
    assert.match(fid, /^featured-/);
    const app = await loadApp({ radio, url: `https://m4roon3d.github.io/skyband/#u=${fid}` });
    await app.flush();
    assert.equal(app.sb.state.currentStation.stationuuid, fid);
    app.close();
  });

  it('rejects hostile or malformed links safely', async () => {
    for (const hash of ['u=%3Cscript%3E', 'la=999&lo=0&c=X', 'la=abc&lo=1', 'u=javascript:alert(1)', 'c=<img src=x onerror=alert(1)>&la=1&lo=1']) {
      const app = await loadApp({ radio, byuuid: () => [], url: `https://m4roon3d.github.io/skyband/#${hash}` });
      await app.flush();
      assert.deepEqual(app.errors, [], hash);
      assert.equal(app.sb.state.currentStation, null, hash);
      assert.equal(app.document.querySelector('#location-heading img'), null);
      app.close();
    }
  });

  it('a shared station that is gone says so', async () => {
    const app = await loadApp({ radio, byuuid: () => [], url: `https://m4roon3d.github.io/skyband/#u=${UUID}` });
    await app.flush();
    assert.match(app.toast().text, /no longer available/);
    app.close();
  });
});

describe('listening stats', () => {
  it('formats durations', async () => {
    const app = await loadApp();
    const f = app.sb.formatListen;
    assert.deepEqual([f(0), f(20), f(60), f(3600), f(3900)], ['0m', '<1m', '1m', '1h 00m', '1h 05m']);
    app.close();
  });

  it('counts time only while playing, per day, station and country', async () => {
    const app = await loadApp({ radio, now: '2026-11-24T10:00:00', advanceDate: true });
    await app.flush();
    app.click('#btn-play-pause'); app.audioEvent('playing');
    app.clock.tick(60000);
    let s = app.sb.loadStats();
    assert.equal(s.total, 60);
    assert.equal(s.days['2026-11-24'], 60);
    assert.equal(Object.keys(s.stations).length, 1);
    app.audioEvent('pause');
    app.clock.tick(60000);
    s = app.sb.loadStats();
    assert.equal(s.total, 60, 'paused time is not counted');
    assert.match(app.document.getElementById('stats-body').textContent, /Today\s*1m/);
    assert.equal(app.document.getElementById('stats-total').textContent, '1m');
    app.close();
  });

  it('survives corrupt storage and prunes old days', async () => {
    const bad = await loadApp({ storage: { skyband_stats: '"nope"' } });
    assert.equal(bad.sb.loadStats().total, 0);
    assert.deepEqual(bad.errors, []);
    bad.close();
    const days = {}; for (let i = 1; i <= 80; i++) days[`2026-01-${String(i).padStart(2, '0')}`] = 5;
    const app = await loadApp({ radio, storage: { skyband_stats: JSON.stringify({ total: 400, days, stations: {}, countries: {} }) } });
    await app.flush();
    app.click('#btn-play-pause'); app.sb.recordListening(10);
    assert.ok(Object.keys(app.sb.loadStats().days).length <= 60);
    app.close();
  });

  it('SECURITY: station names are escaped in the stats panel', async () => {
    const app = await loadApp({ storage: { skyband_stats: JSON.stringify({ total: 9, days: {}, stations: { a: { name: '<img src=x onerror=alert(1)>', sec: 9 } }, countries: {} }) } });
    assert.equal(app.document.getElementById('stats-body').querySelector('img'), null);
    app.close();
  });
});
