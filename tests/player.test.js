'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load');
const { rawStation, many } = require('./helpers/fixtures');

/** App preloaded with `n` healthy local stations. */
async function appWithStations(n = 5, opts = {}) {
  const list = many(n, (i) => ({ name: `Station ${i}`, clickcount: 1000 - i * 10, geo_lat: 12.95 + i * 0.01, geo_long: 77.6, ...(opts.over || {}) }));
  const app = await loadApp({ radio: () => list, ...opts });
  return app;
}
const live = (app) => { app.audioEvent('playing'); };

describe('playStation', () => {
  it('plays a plain https stream: sets src, shows loading, then live on "playing"', async () => {
    const app = await appWithStations();
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st);
    assert.equal(app.calls.audio.play[0], st.url_resolved);
    assert.equal(app.sb.state.isLoadingAudio, true);
    assert.match(app.document.getElementById('player-led').className, /animate-pulse/);
    assert.equal(app.document.getElementById('player-title').textContent, st.name);
    live(app);
    assert.equal(app.sb.state.isPlaying, true);
    assert.equal(app.sb.state.isLoadingAudio, false);
    assert.match(app.document.getElementById('player-led').className, /led-live/);
    assert.equal(app.sb.state.sessionStreamHealth[st.stationuuid], 'verified');
    app.close();
  });

  it('ignores empty/invalid stations', async () => {
    const app = await appWithStations();
    app.sb.playStation(null);
    app.sb.playStation({ stationuuid: 'x', url_resolved: '' });
    assert.equal(app.calls.audio.play.length, 0);
    app.close();
  });

  it('playing the current, playing station pauses it', async () => {
    const app = await appWithStations();
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st); live(app);
    app.sb.playStation(st);
    assert.equal(app.calls.audio.pause, 1);
    app.clock.tick(1);
    assert.equal(app.sb.state.isPlaying, false);
    app.close();
  });

  it('records history (most recent first, de-duplicated, max 25)', async () => {
    const app = await appWithStations(30);
    const list = app.sb.getVisibleStations();
    for (const s of list.slice(0, 28)) { app.sb.playStation(s); }
    app.sb.playStation(list[3]);
    const recent = app.sb.state.recent;
    assert.equal(recent.length, 25);
    assert.equal(recent[0].stationuuid, list[3].stationuuid);
    assert.equal(new Set(recent.map((r) => r.stationuuid)).size, 25);
    app.close();
  });

  it('first successful play stamps the passport once per country and persists it', async () => {
    const app = await appWithStations();
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a); live(app);
    assert.equal(app.sb.state.passportCountries.length, 1);
    assert.equal(app.document.getElementById('passport-count').textContent, '1 country');
    assert.match(app.toast().text, /Passport stamped: India/);
    app.sb.playStation(b); live(app);
    assert.equal(app.sb.state.passportCountries.length, 1);
    assert.deepEqual(plain(JSON.parse(app.window.localStorage.getItem('atlasfm_passport')).map((c) => c.country)), ['India']);
    app.close();
  });

  it('does not stamp "Global" (country-less) stations', async () => {
    const app = await loadApp({ radio: () => [] });
    app.sb.stampPassport({ country: 'Global' });
    app.sb.stampPassport(null);
    assert.equal(app.sb.state.passportCountries.length, 0);
    assert.match(app.document.getElementById('passport-stamps').textContent, /Play any station/);
    app.close();
  });

  it('learns taste from the first 3 tags of a verified station (persisted)', async () => {
    const app = await appWithStations(5, { over: { tags: 'Jazz, Soul ,smooth,extra' } });
    app.sb.playStation(app.sb.getVisibleStations()[0]); live(app);
    assert.deepEqual(plain(app.sb.state.tasteCounts), { jazz: 1, soul: 1, smooth: 1 });
    assert.deepEqual(JSON.parse(app.window.localStorage.getItem('atlasfm_taste')), { jazz: 1, soul: 1, smooth: 1 });
    app.close();
  });
});

describe('HLS playback paths', () => {
  const hlsRaw = () => many(7, (i) => ({ name: `HLS ${i}`, url_resolved: `https://x.example/${i}/live.m3u8`, codec: 'AAC', geo_lat: 12.95, geo_long: 77.6 }));

  it('uses hls.js on Chrome/Firefox/Android (no native HLS)', async () => {
    const list = hlsRaw();
    const app = await loadApp({ radio: () => list });
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st);
    assert.equal(app.calls.hls.length, 1);
    assert.equal(app.calls.hls[0].source, st.url_resolved);
    assert.equal(app.calls.hls[0].media, app.audio);
    assert.equal(app.calls.audio.play.length, 0); // waits for MANIFEST_PARSED
    app.calls.hls[0].handlers.hlsManifestParsed();
    assert.equal(app.calls.audio.play.length, 1);
    app.close();
  });

  it('prefers NATIVE Safari HLS and never constructs hls.js', async () => {
    const list = hlsRaw();
    const app = await loadApp({ radio: () => list, nativeHls: true });
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st);
    assert.equal(app.calls.hls.length, 0);
    assert.equal(app.calls.audio.play[0], st.url_resolved);
    app.close();
  });

  it('tears down the previous hls.js instance when switching stations', async () => {
    const list = hlsRaw();
    const app = await loadApp({ radio: () => list });
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a);
    app.sb.playStation(b);
    assert.equal(app.calls.hls.length, 2);
    assert.equal(app.calls.hls[0].destroyed, true);
    assert.equal(app.calls.hls[1].destroyed, false);
    app.close();
  });

  it('a fatal hls.js error destroys the instance and triggers error handling; non-fatal is ignored', async () => {
    const list = hlsRaw();
    const app = await loadApp({ radio: () => list });
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st);
    app.calls.hls[0].handlers.hlsError(null, { fatal: false });
    assert.equal(app.calls.hls[0].destroyed, false);
    app.calls.hls[0].handlers.hlsError(null, { fatal: true });
    assert.equal(app.calls.hls[0].destroyed, true);
    assert.equal(app.sb.state.sessionStreamHealth[st.stationuuid], 'failed');
    app.close();
  });

  it('falls back to a direct <audio src> when neither native HLS nor hls.js is supported', async () => {
    const list = hlsRaw();
    const app = await loadApp({ radio: () => list, hlsUnsupported: true });
    const st = app.sb.getVisibleStations()[0];
    app.sb.playStation(st);
    assert.equal(app.calls.hls.length, 0);
    assert.equal(app.calls.audio.play[0], st.url_resolved);
    app.close();
  });
});

describe('stall guard + auto-heal', () => {
  it('7s without "playing" marks the stream failed and auto-heals to the next live station', async () => {
    const app = await appWithStations(5);
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a);
    app.clock.tick(6999);
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], undefined);
    app.clock.tick(1);
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    assert.match(app.toast().text, /^Auto-healing to /);
    app.clock.tick(450);
    assert.equal(app.sb.state.currentStation.stationuuid, b.stationuuid);
    assert.equal(app.sb.state.autoHealAttempts, 1);
    app.close();
  });

  it('a successful "playing" cancels the stall guard and resets heal attempts', async () => {
    const app = await appWithStations(5);
    const a = app.sb.getVisibleStations()[0];
    app.sb.playStation(a); live(app);
    app.clock.tick(20000);
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], 'verified');
    assert.equal(app.sb.state.autoHealAttempts, 0);
    app.close();
  });

  it('heals at most twice, then shows an "offline" toast with a Next action', async () => {
    const app = await appWithStations(6);
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    app.clock.tick(7000); app.clock.tick(450);
    app.clock.tick(7000); app.clock.tick(450);
    app.clock.tick(7000);
    assert.equal(app.sb.state.autoHealAttempts, 2);
    assert.match(app.toast().text, /offline\.$/);
    assert.equal(app.document.getElementById('toast-action').textContent, 'Next');
    assert.equal(app.document.getElementById('toast-action').classList.contains('hidden'), false);
    app.close();
  });

  it('with Auto-Heal switched off the first failure just reports offline', async () => {
    const app = await appWithStations(5);
    app.click('#btn-auto-heal');
    assert.equal(app.sb.state.autoHeal, false);
    assert.equal(app.document.getElementById('btn-auto-heal').textContent, 'OFF');
    const a = app.sb.getVisibleStations()[0];
    app.sb.playStation(a);
    app.clock.tick(7000);
    assert.match(app.toast().text, /offline\.$/);
    assert.equal(app.sb.state.currentStation.stationuuid, a.stationuuid);
    app.close();
  });

  it('an <audio> error event on the current station fails it and heals', async () => {
    const app = await appWithStations(5);
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a);
    app.audioEvent('error');
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    app.clock.tick(450);
    assert.equal(app.sb.state.currentStation.stationuuid, b.stationuuid);
    app.close();
  });

  it('the Next button on the offline toast skips to the following station', async () => {
    const app = await appWithStations(5);
    app.click('#btn-auto-heal');
    const [a, b] = app.sb.getVisibleStations();
    app.sb.playStation(a);
    app.clock.tick(7000);
    app.click('#toast-action');
    assert.equal(app.sb.state.currentStation.stationuuid, plain(app.sb.getVisibleStations().find((s) => s.stationuuid !== a.stationuuid && s.stationuuid === b.stationuuid) || b).stationuuid);
    app.close();
  });
});

describe('play() promise rejections (autoplay policy / races)', () => {
  /** Make audio.play() reject with a DOMException-like error. */
  function rejectPlayWith(app, name) {
    app.audio.play = () => Promise.reject(Object.assign(new Error(name), { name }));
  }

  it('BUG REGRESSION: Safari blocking autoplay (NotAllowedError) must NOT mark the station failed or skip stations', async () => {
    const app = await appWithStations(5);
    const [a] = app.sb.getVisibleStations();
    rejectPlayWith(app, 'NotAllowedError');
    app.sb.playStation(a);
    await app.flush();
    app.clock.tick(500);
    assert.notEqual(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    assert.equal(app.sb.state.currentStation.stationuuid, a.stationuuid);
    assert.equal(app.sb.state.autoHealAttempts, 0);
    assert.match(app.toast().text, /tap play/i);
    app.close();
  });

  it('BUG REGRESSION: a play() aborted by switching stations must not mark the previous (healthy) station failed', async () => {
    const app = await appWithStations(5);
    const [a, b] = app.sb.getVisibleStations();
    let rejectA;
    app.audio.play = () => new Promise((_res, rej) => { rejectA = rej; });
    app.sb.playStation(a);
    app.audio.play = () => Promise.resolve();
    app.sb.playStation(b);
    rejectA(Object.assign(new Error('The play() request was interrupted'), { name: 'AbortError' }));
    await app.flush();
    assert.notEqual(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    assert.equal(app.sb.state.currentStation.stationuuid, b.stationuuid);
    app.close();
  });

  it('a genuine play() failure (e.g. NotSupportedError) still fails the station and heals', async () => {
    const app = await appWithStations(5);
    const [a] = app.sb.getVisibleStations();
    rejectPlayWith(app, 'NotSupportedError');
    app.sb.playStation(a);
    await app.flush();
    assert.equal(app.sb.state.sessionStreamHealth[a.stationuuid], 'failed');
    app.close();
  });
});

describe('transport controls', () => {
  it('next / previous wrap around the visible list', async () => {
    const app = await appWithStations(4);
    const list = app.sb.getVisibleStations();
    app.sb.playStation(list[0]);
    app.click('#btn-prev');
    assert.equal(app.sb.state.currentStation.stationuuid, list[list.length - 1].stationuuid);
    app.click('#btn-next');
    assert.equal(app.sb.state.currentStation.stationuuid, list[0].stationuuid);
    app.close();
  });

  it('next with nothing playing starts the first station; empty list is a no-op', async () => {
    const app = await appWithStations(4);
    app.click('#btn-next');
    assert.equal(app.sb.state.currentStation.stationuuid, app.sb.getVisibleStations()[0].stationuuid);
    const empty = await loadApp({ radio: () => [] });
    empty.sb.state.stations = [];
    empty.sb.playAdjacent(1);
    assert.equal(empty.sb.state.currentStation, null);
    app.close(); empty.close();
  });

  it('play/pause button: starts the top station, pauses, resumes the same one', async () => {
    const app = await appWithStations(4);
    app.click('#btn-play-pause');
    const cur = app.sb.state.currentStation;
    assert.ok(cur);
    live(app);
    app.click('#btn-play-pause');
    assert.equal(app.calls.audio.pause, 1);
    app.clock.tick(1);
    assert.equal(app.sb.state.isPlaying, false);
    app.click('#btn-play-pause');
    assert.equal(app.sb.state.currentStation.stationuuid, cur.stationuuid);
    assert.equal(app.calls.audio.play.length, 2);
    app.close();
  });

  it('Smart Play picks the best station that has not failed this session', async () => {
    const app = await appWithStations(4);
    const [a, b] = app.sb.getVisibleStations();
    app.sb.state.sessionStreamHealth[a.stationuuid] = 'failed';
    app.click('#btn-smart-play');
    assert.equal(app.sb.state.currentStation.stationuuid, b.stationuuid);
    app.close();
  });

  it('volume slider sets volume, and 0 mutes; mute button toggles', async () => {
    const app = await appWithStations(2);
    const slider = app.document.getElementById('volume-slider');
    slider.value = '0.4';
    slider.dispatchEvent(new app.window.Event('input'));
    assert.equal(app.audio.volume, 0.4);
    assert.equal(app.audio.muted, false);
    slider.value = '0';
    slider.dispatchEvent(new app.window.Event('input'));
    assert.equal(app.audio.muted, true);
    app.click('#btn-mute');
    assert.equal(app.audio.muted, false);
    app.close();
  });
});

describe('favorites', () => {
  it('toggle adds then removes, persists to localStorage, updates counters and toast', async () => {
    const app = await appWithStations(3);
    const st = app.sb.getVisibleStations()[0];
    app.sb.toggleFavorite(st);
    assert.equal(app.document.getElementById('fav-count').textContent, '1');
    assert.match(app.toast().text, /^Saved "Station/);
    assert.equal(JSON.parse(app.window.localStorage.getItem('atlasfm_favorites')).length, 1);
    app.sb.toggleFavorite(st);
    assert.equal(app.document.getElementById('fav-count').textContent, '0');
    assert.match(app.toast().text, /^Removed "Station/);
    assert.equal(JSON.parse(app.window.localStorage.getItem('atlasfm_favorites')).length, 0);
    app.close();
  });

  it('favorites survive a reload (hydrated from localStorage)', async () => {
    const saved = [{ ...rawStation({ stationuuid: 'fav-1', name: 'Kept FM' }), url_resolved: 'https://k.example/s.mp3', band: 'web', signal: { pct: 80, bars: 3, tone: 'sky', label: 'Good', reasons: '' } }];
    const app = await loadApp({ radio: () => [], storage: { atlasfm_favorites: JSON.stringify(saved) } });
    assert.equal(app.document.getElementById('fav-count').textContent, '1');
    app.sb.state.activeTab = 'favorites';
    app.sb.renderStationList();
    assert.match(app.document.getElementById('station-list').textContent, /Kept FM/);
    app.close();
  });

  it('the heart button on a card saves without starting playback', async () => {
    const app = await appWithStations(3);
    app.click('#station-list [data-action="fav"]');
    assert.equal(app.sb.state.favorites.length, 1);
    assert.equal(app.calls.audio.play.length, 0);
    app.close();
  });

  it('player heart button toggles the current station; no-op when nothing is playing', async () => {
    const app = await appWithStations(3);
    app.click('#player-fav-btn');
    assert.equal(app.sb.state.favorites.length, 0);
    app.sb.playStation(app.sb.getVisibleStations()[0]);
    app.click('#player-fav-btn');
    assert.equal(app.sb.state.favorites.length, 1);
    app.close();
  });

  it('empty Saved / Log tabs show friendly empty states', async () => {
    const app = await appWithStations(3);
    app.click('[data-tab="favorites"]');
    assert.match(app.document.getElementById('station-list').textContent, /No saved stations yet/);
    app.click('[data-tab="recent"]');
    assert.match(app.document.getElementById('station-list').textContent, /No listening history yet/);
    app.close();
  });
});

describe('sleep timer', () => {
  it('counts down mm:ss, pauses audio at zero, resets the select and hides the countdown', async () => {
    const app = await appWithStations(3);
    app.sb.playStation(app.sb.getVisibleStations()[0]); live(app);
    const sel = app.document.getElementById('sleep-timer-select');
    sel.value = '15';
    sel.dispatchEvent(new app.window.Event('change'));
    const cd = app.document.getElementById('sleep-countdown');
    assert.equal(cd.textContent, '15:00');
    assert.equal(cd.classList.contains('hidden'), false);
    app.clock.tick(1000);
    assert.equal(cd.textContent, '14:59');
    app.clock.tick(15 * 60 * 1000 - 1000);
    assert.equal(app.calls.audio.pause, 1);
    assert.equal(sel.value, '0');
    assert.equal(cd.classList.contains('hidden'), true);
    assert.equal(app.toast().text, 'Sleep timer finished');
    assert.equal(app.sb.state.sleepIntervalId, null);
    app.close();
  });

  it('re-arming replaces the previous timer; selecting Off cancels it', async () => {
    const app = await appWithStations(2);
    app.sb.setSleepTimer(30);
    app.sb.setSleepTimer(15);
    app.clock.tick(2000);
    assert.equal(app.document.getElementById('sleep-countdown').textContent, '14:58');
    app.sb.setSleepTimer(0);
    assert.equal(app.document.getElementById('sleep-countdown').classList.contains('hidden'), true);
    assert.equal(app.clock.pending() >= 0, true);
    app.close();
  });
});

describe('ambient mixer', () => {
  it('rain / vinyl / hum label the status, light the active dot; off clears it', async () => {
    const app = await appWithStations(2);
    for (const [fx, label] of [['rain', 'Soft Rain'], ['vinyl', 'Vinyl Warmth'], ['hum', 'Night Hum']]) {
      app.click(`.fx-btn[data-fx="${fx}"]`);
      assert.equal(app.document.getElementById('ambient-status').textContent, label);
      assert.equal(app.document.getElementById('fx-active-dot').classList.contains('hidden'), false);
    }
    app.click('.fx-btn[data-fx="off"]');
    assert.equal(app.document.getElementById('ambient-status').textContent, 'Off');
    assert.equal(app.document.getElementById('fx-active-dot').classList.contains('hidden'), true);
    assert.deepEqual(app.errors, []);
    app.close();
  });

  it('degrades silently when Web Audio is unavailable', async () => {
    const app = await appWithStations(2);
    app.window.AudioContext = undefined;
    app.click('.fx-btn[data-fx="rain"]');
    assert.equal(app.sb.state.ambientFx, 'rain');
    assert.deepEqual(app.errors, []);
    app.close();
  });
});
