'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');
const { many } = require('./helpers/fixtures');

const radio = () => many(4, (i) => ({ name: `Station ${i}`, clickcount: 100 - i }));
const beirut = [{ class: 'boundary', importance: 0.7, lat: '33.8938', lon: '35.5018', address: { city: 'Beirut', state: 'Beirut Governorate', country: 'Lebanon', country_code: 'lb' } }];
const search = (app, q) => { const i = app.document.getElementById('search-input'); i.value = q; i.dispatchEvent(new app.window.Event('input', { bubbles: true })); app.click('[data-search-live]'); return app.flush(); };
const heading = (app) => app.document.getElementById('location-heading').textContent;

describe('typing a place that is not a built-in city', () => {
  it('flies there: the card, map location and subline follow the search (was: stuck on the old city)', async () => {
    const app = await loadApp({ radio, geocode: () => beirut });
    await search(app, 'beirut');
    assert.equal(app.sb.state.location.city, 'Beirut');
    assert.equal(app.sb.state.location.countryCode, 'LB');
    assert.equal(app.sb.state.searchQuery, '');
    assert.equal(heading(app), 'Beirut');
    assert.match(app.document.getElementById('location-subline').textContent, /Lebanon/);
    app.close();
  });

  it('still honours a genre next to the place ("jazz beirut")', async () => {
    const seen = [];
    const app = await loadApp({ radio, geocode: (q) => { seen.push(q); return beirut; } });
    await search(app, 'jazz beirut');
    assert.deepEqual(seen, ['beirut']);
    assert.equal(app.sb.state.location.city, 'Beirut');
    assert.equal(app.sb.state.genre, 'jazz');
    app.close();
  });

  it('falls back to a station-name search when it is not a place, and the card says so', async () => {
    const app = await loadApp({ radio, geocode: () => [] });
    await search(app, 'radio orient');
    assert.equal(app.sb.state.location.city, 'Bengaluru');
    assert.equal(app.sb.state.searchQuery, 'radio orient');
    assert.equal(heading(app), '“radio orient”');
    assert.match(app.document.getElementById('location-subline').textContent, /Station search/);
    app.click('#search-clear-btn'); await app.flush();
    assert.equal(heading(app), 'Bengaluru');
    app.close();
  });

  it('ignores weak or non-place matches and bad data', async () => {
    for (const geo of [[{ class: 'amenity', importance: 0.9, lat: '1', lon: '1', address: { city: 'X' } }], [{ class: 'place', importance: 0.05, lat: '1', lon: '1', address: { city: 'X' } }], [{ class: 'place', importance: 0.8, lat: '999', lon: '1', address: { city: 'X' } }], 'nope', null]) {
      const app = await loadApp({ radio, geocode: () => geo });
      await search(app, 'somewhere');
      assert.equal(app.sb.state.location.city, 'Bengaluru');
      assert.deepEqual(app.errors, []);
      app.close();
    }
  });

  it('does not geocode built-in cities, bare genres or short text', async () => {
    const seen = [];
    const app = await loadApp({ radio, geocode: (q) => { seen.push(q); return beirut; } });
    await search(app, 'london'); await search(app, 'jazz'); await search(app, 'ab'); await search(app, 'fm 101');
    assert.deepEqual(seen, []);
    app.close();
  });

  it('SECURITY: place and query text is shown as text, not markup', async () => {
    const app = await loadApp({ radio, geocode: () => [{ class: 'place', importance: 0.9, lat: '1', lon: '1', address: { city: '<img src=x onerror=alert(1)>', country: 'X' } }] });
    await search(app, 'xss');
    assert.equal(app.document.querySelector('#location-heading img'), null);
    app.close();
  });
});
