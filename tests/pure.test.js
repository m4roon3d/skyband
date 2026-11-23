'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load');
const { rawStation } = require('./helpers/fixtures');

let app;
let sb;
before(async () => { app = await loadApp({ radio: () => [], now: '2026-11-23T03:30:00Z' }); sb = app.sb; });
after(() => app.close());

describe('text + geo helpers', () => {
  it('stripAccents removes diacritics and tolerates null', () => {
    assert.equal(sb.stripAccents('Zürich — Île-de-France, München'), 'Zurich — Ile-de-France, Munchen');
    assert.equal(sb.stripAccents(null), '');
    assert.equal(sb.stripAccents(undefined), '');
  });

  it('escapeHtml escapes all five dangerous characters and tolerates null', () => {
    assert.equal(sb.escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(sb.escapeHtml(null), '');
    assert.equal(sb.escapeHtml(undefined), '');
  });

  it('haversineKm: known distances, zero distance, and null on missing input', () => {
    const blr = sb.ANCHOR_PLACES.find((p) => p.city === 'Bengaluru');
    const mum = sb.ANCHOR_PLACES.find((p) => p.city === 'Mumbai');
    const lon = sb.ANCHOR_PLACES.find((p) => p.city === 'London');
    const nyc = sb.ANCHOR_PLACES.find((p) => p.city === 'New York');
    const d1 = sb.haversineKm(blr.lat, blr.lng, mum.lat, mum.lng);
    assert.ok(d1 > 830 && d1 < 860, `Bengaluru-Mumbai ${d1}`);
    const d2 = sb.haversineKm(lon.lat, lon.lng, nyc.lat, nyc.lng);
    assert.ok(d2 > 5500 && d2 < 5600, `London-New York ${d2}`);
    assert.equal(sb.haversineKm(10, 10, 10, 10), 0);
    assert.equal(sb.haversineKm(null, 1, 2, 3), null);
    assert.equal(sb.haversineKm(1, undefined, 2, 3), null);
  });

  it('haversineKm is symmetric and handles the antimeridian', () => {
    assert.equal(sb.haversineKm(0, 179, 0, -179), sb.haversineKm(0, -179, 0, 179));
    assert.ok(sb.haversineKm(0, 179, 0, -179) < 300);
  });

  it('mergeUnique de-duplicates by stationuuid, first occurrence wins', () => {
    const merged = sb.mergeUnique([{ stationuuid: 'a', n: 1 }, { stationuuid: 'b', n: 2 }], [{ stationuuid: 'b', n: 99 }, { stationuuid: 'c', n: 3 }]);
    assert.deepEqual(plain(merged.map((s) => [s.stationuuid, s.n])), [['a', 1], ['b', 2], ['c', 3]]);
  });

  it('hashJitter is deterministic and bounded to +/-0.7 degrees', () => {
    const a = plain(sb.hashJitter('station-1'));
    assert.deepEqual(a, plain(sb.hashJitter('station-1')));
    assert.notDeepEqual(a, plain(sb.hashJitter('station-2')));
    for (const seed of ['a', 'b', 'https://x/y.mp3', '', 'ünï']) {
      for (const v of sb.hashJitter(seed)) assert.ok(Math.abs(v) <= 0.7 + 1e-9, `${seed} -> ${v}`);
    }
  });
});

describe('detectBroadcastBand', () => {
  const band = (name, tags = '') => plain(sb.detectBroadcastBand({ name, tags }));
  it('detects FM from a frequency', () => {
    assert.deepEqual(band('Radio City 91.1 FM'), { band: 'fm', freqLabel: '91.1 FM' });
    assert.deepEqual(band('Rainbow 101.3'), { band: 'fm', freqLabel: '101.3 FM' });
    assert.equal(band('Hits 107 FM').band, 'fm');
  });
  it('detects FM from well-known brand words', () => {
    assert.equal(band('Radio Mirchi').band, 'fm');
    assert.equal(band('Classic FM').band, 'fm');
    assert.equal(band('Vividh Bharati').band, 'fm');
  });
  it('detects AM from kHz/MW frequencies and AM words', () => {
    assert.deepEqual(band('Radio One 1260 kHz'), { band: 'am', freqLabel: '1260 AM' });
    assert.equal(band('Station 720 AM').band, 'am');
    assert.deepEqual(band('Akashvani Bengaluru'), { band: 'am', freqLabel: 'AM' });
    assert.equal(band('Medium Wave Classics').band, 'am');
  });
  it('falls back to WEB for internet-only stations', () => {
    assert.deepEqual(band('SomaFM Groove Salad', 'ambient,electronic'), { band: 'web', freqLabel: 'WEB' });
    assert.deepEqual(band('Jazz Lounge'), { band: 'web', freqLabel: 'WEB' });
    assert.deepEqual(plain(sb.detectBroadcastBand({})), { band: 'web', freqLabel: 'WEB' });
  });
  it('does not treat random numbers as frequencies', () => {
    assert.equal(band('Top 40 Hits').band, 'web');
    assert.equal(band('Radio 2000').band, 'web');
  });
});

describe('computeStreamReliability', () => {
  const rel = (over) => sb.computeStreamReliability(sb.normalizeStation(rawStation(over)));
  it('a healthy https MP3 station scores Strong (98% cap, 4 bars)', () => {
    const s = rel({});
    assert.equal(s.pct, 98);
    assert.equal(s.bars, 4);
    assert.equal(s.label, 'Strong');
    assert.match(s.reasons, /Check OK · HTTPS · MP3/);
  });
  it('a failing http, unknown-codec, unpopular station is floored at 15% / Weak', () => {
    const s = rel({ lastcheckok: 0, url_resolved: 'http://x.example/stream', codec: '', clickcount: 0, clicktrend: 0 });
    assert.equal(s.pct, 15);
    assert.equal(s.bars, 1);
    assert.equal(s.label, 'Weak');
  });
  it('always stays inside 15..98 and bars map monotonically to pct', () => {
    let lastBars = 0;
    for (const clicks of [0, 5, 50, 500]) {
      for (const ok of [0, 1]) {
        const s = rel({ clickcount: clicks, lastcheckok: ok, clicktrend: 0 });
        assert.ok(s.pct >= 15 && s.pct <= 98);
        assert.ok([1, 2, 3, 4].includes(s.bars));
        lastBars = s.bars;
      }
    }
    assert.ok(lastBars >= 1);
  });
  it('HLS streams get the HLS bonus when the codec is not a plain audio codec', () => {
    const s = rel({ url_resolved: 'https://x.example/live.m3u8', codec: 'UNKNOWN' });
    assert.match(s.reasons, /HLS/);
  });
  it('recent check time adds a bonus, stale check time subtracts', () => {
    const fresh = rel({ clickcount: 0, clicktrend: 0, lastcheckoktime_iso8601: '2026-11-23T02:00:00Z' });
    const none = rel({ clickcount: 0, clicktrend: 0 });
    const stale = rel({ clickcount: 0, clicktrend: 0, lastcheckoktime_iso8601: '2026-11-01T00:00:00Z' });
    assert.equal(fresh.pct - none.pct, 4);
    assert.equal(none.pct - stale.pct, 8);
  });
  it('session health overrides everything: verified=99% Verified, failed=12% Failed', () => {
    const st = sb.normalizeStation(rawStation({ stationuuid: 'sess-1' }));
    sb.state.sessionStreamHealth['sess-1'] = 'verified';
    assert.deepEqual([sb.computeStreamReliability(st).pct, sb.computeStreamReliability(st).label], [99, 'Verified']);
    sb.state.sessionStreamHealth['sess-1'] = 'failed';
    assert.deepEqual([sb.computeStreamReliability(st).pct, sb.computeStreamReliability(st).label], [12, 'Failed']);
    delete sb.state.sessionStreamHealth['sess-1'];
  });
  it('renderSignalInline renders 4 bars, the percentage, and escapes the tooltip', () => {
    const html = sb.renderSignalInline({ tone: 'emerald', bars: 3, pct: 77, reasons: '<b>x</b>' });
    assert.equal((html.match(/class="sig-bar"/g) || []).length, 4);
    assert.equal((html.match(/background:/g) || []).length, 3);
    assert.match(html, />77%</);
    assert.doesNotMatch(html, /<b>x<\/b>/);
  });
});

describe('normalizeStation', () => {
  it('maps a Radio Browser record into the app shape', () => {
    const st = sb.normalizeStation(rawStation({ name: '  Radio Mirchi 98.3 FM  ', countrycode: 'in', url_resolved: ' https://a.example/s.mp3 ' }));
    assert.equal(st.name, 'Radio Mirchi 98.3 FM');
    assert.equal(st.countrycode, 'IN');
    assert.equal(st.url_resolved, 'https://a.example/s.mp3');
    assert.equal(st.band, 'fm');
    assert.equal(st.hasExactGeo, true);
    assert.equal(st.approxGeo, false);
    assert.equal(typeof st.signal.pct, 'number');
  });
  it('applies safe defaults for sparse records', () => {
    const st = sb.normalizeStation({ url: 'https://only.example/stream' });
    assert.equal(st.name, 'Unnamed');
    assert.equal(st.country, 'Global');
    assert.equal(st.url_resolved, 'https://only.example/stream');
    assert.equal(st.codec, 'STREAM');
    assert.equal(st.bitrate, 0);
    assert.equal(st.lastcheckok, 1);
    assert.equal(st.stationuuid, 'undefined-https://only.example/stream'); // documents current id fallback
  });
  it('flags HLS by .m3u8 url (with query), hls flag, or codec', () => {
    assert.equal(sb.normalizeStation(rawStation({ url_resolved: 'https://x/y.m3u8?token=1' })).isHls, true);
    assert.equal(sb.normalizeStation(rawStation({ hls: 1 })).isHls, true);
    assert.equal(sb.normalizeStation(rawStation({ codec: 'HLS' })).isHls, true);
    const st = sb.normalizeStation(rawStation({ url_resolved: 'https://x/y.m3u8' }));
    assert.equal(st.codec, 'HLS');
    assert.equal(sb.normalizeStation(rawStation({})).isHls, false);
  });
  it('treats 0,0 and blank coordinates as "no exact geo" and places same-country stations near the active city', () => {
    const loc = sb.state.location;
    for (const bad of [{ geo_lat: 0, geo_long: 0 }, { geo_lat: '', geo_long: '' }, { geo_lat: null, geo_long: null }]) {
      const st = sb.normalizeStation(rawStation({ ...bad, countrycode: loc.countryCode }));
      assert.equal(st.hasExactGeo, false);
      assert.equal(st.approxGeo, true);
      assert.ok(Math.abs(st.geo_lat - loc.lat) <= 0.7 + 1e-9);
      assert.ok(Math.abs(st.geo_long - loc.lng) <= 0.7 + 1e-9);
    }
  });
  it('leaves other-country stations without coordinates unplotted', () => {
    const st = sb.normalizeStation(rawStation({ geo_lat: null, geo_long: null, countrycode: 'JP', state: 'Tokyo', tags: 'pop', language: 'japanese' }));
    assert.equal(st.geo_lat, null);
    assert.equal(st.geo_long, null);
  });
  it('is local-match aware (city/state/alias terms, accent-insensitive)', () => {
    const near = sb.normalizeStation(rawStation({ name: 'Namma Bangalore FM', state: '', geo_lat: null, geo_long: null, countrycode: 'XX' }));
    assert.equal(near.isLocalMatch, true);
    assert.equal(near.distanceKm, 12);
    const far = sb.normalizeStation(rawStation({ name: 'Elsewhere', state: 'Oslo', tags: 'x', language: 'norwegian', geo_lat: 59.9, geo_long: 10.7 }));
    assert.equal(far.isLocalMatch, false);
    assert.ok(far.distanceKm > 6000);
  });
  it('getActivePlaceTerms expands aliases for the active place', () => {
    const terms = sb.getActivePlaceTerms();
    for (const t of ['Bengaluru', 'bangalore', 'kannada', 'Karnataka']) assert.ok(terms.includes(t), t);
  });
});

describe('getLocalTimeInfo (clock frozen at 2026-11-23T03:30Z)', () => {
  const at = (tz, lng = 0) => sb.getLocalTimeInfo({ tz, lng });
  it('maps IANA timezones to the right day period', () => {
    assert.equal(at('Asia/Kolkata').period, 'Morning'); // 09:00
    assert.equal(at('Asia/Kolkata').timeLabel, '9:00 AM');
    assert.equal(at('Asia/Tokyo').period, 'Daytime'); // 12:30
    assert.equal(at('America/New_York').period, 'Late Night'); // 22:30 (EST)
    assert.equal(at('Europe/London').period, 'Late Night'); // 03:30
    assert.equal(at('Asia/Bangkok').period, 'Morning'); // 10:30
    assert.equal(at('Asia/Singapore').period, 'Daytime'); // 11:30
  });
  it('falls back to longitude-derived solar time when no tz is known', () => {
    assert.equal(at(undefined, 0).hour, 3);
    assert.equal(at(undefined, 150).hour, 13);
    assert.equal(at(undefined, 150).period, 'Daytime');
    assert.equal(at(undefined, -150).hour, 17);
    assert.equal(at(undefined, -150).period, 'Evening');
  });
  it('survives an invalid timezone string', () => {
    const t = at('Not/AZone', 15);
    assert.equal(t.hour, 4);
    assert.ok(t.timeLabel);
  });
  it('period boundaries: 05:00 morning, 11:00 daytime, 17:00 evening, 22:00 late night', async () => {
    for (const [iso, period] of [['2026-11-23T04:59:00Z', 'Late Night'], ['2026-11-23T05:00:00Z', 'Morning'], ['2026-11-23T10:59:00Z', 'Morning'], ['2026-11-23T11:00:00Z', 'Daytime'], ['2026-11-23T17:00:00Z', 'Evening'], ['2026-11-23T22:00:00Z', 'Late Night'], ['2026-11-23T00:15:00Z', 'Late Night']]) {
      const a = await loadApp({ radio: () => [], now: iso });
      assert.equal(a.sb.getLocalTimeInfo({ tz: 'Europe/London' }).period, period, iso);
      a.close();
    }
  });
});

describe('globe maths', () => {
  it('night circle is a polygon that follows the season (north pole dark in December, lit in June)', async () => {
    const june = await loadApp({ radio: () => [], now: '2026-06-21T12:00:00Z' });
    const dec = await loadApp({ radio: () => [], now: '2026-12-21T12:00:00Z' });
    const pole = [0, 90];
    assert.equal(june.window.d3.geoContains(june.sb.computeNightCircleGeoJson(), pole), false);
    assert.equal(dec.window.d3.geoContains(dec.sb.computeNightCircleGeoJson(), pole), true);
    june.close(); dec.close();
  });
  it('night circle is centred on the antipode of the sub-solar point (noon UTC => lit at lng 0, dark at lng 180)', async () => {
    const a = await loadApp({ radio: () => [], now: '2026-03-20T12:00:00Z' });
    const night = a.sb.computeNightCircleGeoJson();
    assert.equal(a.window.d3.geoContains(night, [0, 0]), false);
    assert.equal(a.window.d3.geoContains(night, [180, 0]), true);
    a.close();
  });
  it('isPointVisibleOnGlobe respects the rotation; flat map shows everything', () => {
    sb.globeRotate = [-77.6, -13, 0]; // looking at lng 77.6, lat 13
    assert.equal(sb.isPointVisibleOnGlobe(77.59, 12.97), true);
    assert.equal(sb.isPointVisibleOnGlobe(-102.4, -13), false);
    sb.state.projMode = 'flat';
    assert.equal(sb.isPointVisibleOnGlobe(-102.4, -13), true);
    sb.state.projMode = 'globe';
  });
});
