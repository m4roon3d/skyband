'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');
const { many } = require('./helpers/fixtures');

describe('mood radio', () => {
  it('renders a chip per mood in the Explore menu', async () => {
    const app = await loadApp();
    const chips = [...app.document.querySelectorAll('#mood-chips [data-mood]')];
    assert.equal(chips.length, app.sb.MOODS.length);
    assert.ok(chips.length >= 6);
    app.close();
  });

  it('tapping a mood searches that tag worldwide and starts playing', async () => {
    const seen = [];
    const app = await loadApp({ radio: (p) => { seen.push(p.get('tag') || p.get('name')); return many(5, (i) => ({ name: `Jazzy ${i}`, tags: 'jazz', clickcount: 100 - i })); } });
    await app.flush();
    app.click('[data-mood="cozy"]');
    await app.flush();
    assert.equal(app.sb.state.scope, 'global');
    assert.equal(app.sb.state.searchQuery, 'jazz');
    assert.equal(app.document.getElementById('search-input').value, 'jazz');
    assert.ok(seen.includes('jazz'));
    assert.ok(app.sb.state.currentStation, 'a station was auto-picked');
    assert.equal(app.document.getElementById('explore-popover').classList.contains('hidden'), true);
    app.close();
  });

  it('ignores unknown moods', async () => {
    const app = await loadApp();
    const before = app.sb.state.searchQuery;
    app.sb.tuneMood('nope');
    assert.equal(app.sb.state.searchQuery, before);
    app.close();
  });
});

describe('whole-word city matching', () => {
  it('does not fire inside other words', async () => {
    const app = await loadApp();
    const { containsWord } = app.sb;
    assert.equal(containsWord('climate music', 'lima'), false);
    assert.equal(containsWord('chrome radio', 'rome'), false);
    assert.equal(containsWord('jazz in rome', 'rome'), true);
    assert.equal(containsWord('rome', 'rome'), true);
    assert.equal(containsWord('hong kong fm', 'hong kong'), true);
    assert.equal(containsWord('x', 'a.c'), false); // regex chars are escaped
    app.close();
  });

  it('smart-tune "climate" stays a search instead of jumping to Lima', async () => {
    const app = await loadApp({ radio: () => [] });
    const i = app.document.getElementById('search-input');
    i.value = 'climate'; i.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.click('[data-search-live]'); await app.flush();
    assert.notEqual(app.sb.state.location.city, 'Lima');
    assert.equal(app.sb.state.searchQuery, 'climate');
    app.close();
  });
});
