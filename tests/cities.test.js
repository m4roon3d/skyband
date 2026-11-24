'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

describe('anchor cities', () => {
  it('covers many countries on every continent with sane data', async () => {
    const app = await loadApp();
    const P = app.sb.ANCHOR_PLACES;
    assert.ok(P.length >= 70);
    assert.ok(new Set(P.map((p) => p.country)).size >= 55);
    assert.equal(new Set(P.map((p) => p.city)).size, P.length, 'city names are unique');
    for (const p of P) {
      assert.ok(p.city && p.country && /^[A-Z]{2}$/.test(p.countryCode), p.city);
      assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180, p.city);
      assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: p.tz }), p.city + ' tz');
    }
    app.close();
  });

  it('pickDestination avoids the current country and prefers unvisited ones', async () => {
    const app = await loadApp({ random: () => 0 });
    const { sb } = app;
    const here = sb.state.location.country;
    for (let i = 0; i < 20; i++) assert.notEqual(sb.pickDestination().country, here);
    const all = [...new Set(sb.ANCHOR_PLACES.map((p) => p.country))];
    sb.state.passportCountries = all.filter((c) => c !== 'Japan').map((country) => ({ country }));
    for (let i = 0; i < 10; i++) assert.equal(sb.pickDestination().country, 'Japan');
    app.close();
  });
});
