'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');
const { many } = require('./helpers/fixtures');

const list = () => many(5, (i) => ({ name: `Station ${i}`, clickcount: 500 - i }));
const saved = (app) => JSON.parse(app.window.localStorage.getItem('skyband_last'));

describe('remember last place and station', () => {
  it('saves location, scope and station after listening', async () => {
    const app = await loadApp({ radio: list });
    app.click('[data-anchor-city="London"]');
    await app.flush();
    app.click('#btn-play-pause');
    await app.flush();
    const s = saved(app);
    assert.equal(s.location.city, 'London');
    assert.equal(s.scope, 'city');
    assert.ok(s.station && /^https?:/.test(s.station.url_resolved));
    app.close();
  });

  it('restores place, scope and station on reload without autoplaying', async () => {
    const station = { stationuuid: 'u-1', name: 'Saved FM', url_resolved: 'https://example.test/s.mp3', country: 'France', countrycode: 'FR' };
    const loc = { city: 'Paris', county: 'Paris', state: 'Île-de-France', country: 'France', countryCode: 'FR', lat: 48.8566, lng: 2.3522 };
    const app = await loadApp({ radio: list, storage: { skyband_last: JSON.stringify({ location: loc, scope: 'country', station }) } });
    await app.flush();
    assert.equal(app.sb.state.location.city, 'Paris');
    assert.equal(app.sb.state.scope, 'country');
    assert.equal(app.sb.state.currentStation.name, 'Saved FM');
    assert.equal(app.sb.state.isPlaying, false);
    assert.equal(app.sb.state.isLoadingAudio, false);
    app.close();
  });

  it('ignores corrupt or hostile saved data', async () => {
    for (const bad of ['not json', '{"location":{"city":"X","lat":999,"lng":0},"scope":"nope","station":{"stationuuid":"a","url_resolved":"javascript:alert(1)"}}', 'null', '[]']) {
      const app = await loadApp({ radio: list, storage: { skyband_last: bad } });
      await app.flush();
      assert.equal(app.sb.state.location.city, 'Bengaluru');
      assert.equal(app.sb.state.scope, 'city');
      assert.equal(app.sb.state.currentStation, null);
      assert.deepEqual(app.errors, []);
      app.close();
    }
  });
});
