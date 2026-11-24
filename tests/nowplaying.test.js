'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

const soma = { stationuuid: 'soma-groove', name: 'SomaFM — Groove Salad', url_resolved: 'https://ice1.somafm.com/groovesalad-128-mp3', country: 'United States', countrycode: 'US', state: 'California', codec: 'MP3', bitrate: 128, lastcheckok: 1 };
const kexp = { stationuuid: 'kexp', name: 'KEXP 90.3', url_resolved: 'https://kexp.streamguys1.com/kexp160.aac', country: 'United States', countrycode: 'US', state: 'Washington', codec: 'AAC', bitrate: 160, lastcheckok: 1 };
const other = { stationuuid: 'other', name: 'Other FM', url_resolved: 'https://example.test/live.mp3', country: 'France', countrycode: 'FR', codec: 'MP3', bitrate: 128, lastcheckok: 1 };
const somaJson = { channels: [{ id: 'dronezone', lastPlaying: 'Wrong - Channel' }, { id: 'groovesalad', lastPlaying: 'Mindex - Jagga-jah' }] };
const kexpJson = { results: [{ play_type: 'trackplay', artist: 'Geese', song: 'Taxes' }] };
const subtitle = (app) => app.document.getElementById('player-subtitle').textContent;

const start = async (opts, st) => {
  const app = await loadApp({ mediaSession: true, ...opts });
  app.sb.playStation(st); app.audioEvent('playing'); await app.flush();
  return app;
};

describe('now playing', () => {
  it('recognises supported stations only', async () => {
    const app = await loadApp();
    assert.deepEqual({ ...app.sb.nowPlayingSource(soma) }, { kind: 'soma', id: 'groovesalad' });
    assert.equal(app.sb.nowPlayingSource(kexp).kind, 'kexp');
    assert.equal(app.sb.nowPlayingSource(other), null);
    app.close();
  });

  it('shows the SomaFM track for the matching channel, in the player and on the lock screen', async () => {
    const app = await start({ nowPlaying: () => somaJson }, soma);
    assert.equal(subtitle(app), '♪ Mindex - Jagga-jah');
    assert.equal(app.media.metadata.title, 'Mindex - Jagga-jah');
    assert.equal(app.media.metadata.artist, soma.name);
    app.close();
  });

  it('shows the KEXP track, ignoring non-music plays', async () => {
    const app = await start({ nowPlaying: () => kexpJson }, kexp);
    assert.equal(subtitle(app), '♪ Geese — Taxes');
    app.close();
    const talk = await start({ nowPlaying: () => ({ results: [{ play_type: 'airbreak' }] }) }, kexp);
    assert.doesNotMatch(subtitle(talk), /♪/);
    talk.close();
  });

  it('fails silently when the feed errors, and never fetches for other stations', async () => {
    const bad = await start({ nowPlaying: () => { throw new Error('offline'); } }, soma);
    assert.doesNotMatch(subtitle(bad), /♪/);
    assert.deepEqual(bad.errors, []);
    bad.close();
    const app = await start({ nowPlaying: () => somaJson }, other);
    assert.equal(app.calls.fetch.filter((u) => /somafm|kexp/.test(u)).length, 0);
    app.close();
  });

  it('polls every 30s while playing, and stops when paused', async () => {
    let n = 0;
    const app = await start({ nowPlaying: () => { n++; return somaJson; } }, soma);
    assert.equal(n, 1);
    app.clock.tick(30000); await app.flush();
    assert.equal(n, 2);
    app.audioEvent('pause'); await app.flush();
    app.clock.tick(90000); await app.flush();
    assert.equal(n, 2);
    app.close();
  });

  it('drops the track name when switching to another station', async () => {
    const app = await start({ nowPlaying: () => somaJson }, soma);
    app.sb.playStation(other); app.audioEvent('playing'); await app.flush();
    assert.doesNotMatch(subtitle(app), /♪/);
    app.close();
  });

  it('SECURITY: track text is rendered as text, not markup', async () => {
    const app = await start({ nowPlaying: () => ({ channels: [{ id: 'groovesalad', lastPlaying: '<img src=x onerror=alert(1)>' }] }) }, soma);
    assert.equal(app.document.getElementById('player-subtitle').querySelector('img'), null);
    app.close();
  });
});

describe('media session (lock screen)', () => {
  it('sets metadata/state and wires play, pause, next and previous', async () => {
    const app = await start({}, other);
    assert.equal(app.media.metadata.title, 'Other FM');
    assert.equal(app.media.playbackState, 'playing');
    assert.deepEqual(Object.keys(app.media.handlers).sort(), ['nexttrack', 'pause', 'play', 'previoustrack', 'stop']);
    app.media.handlers.pause(); app.audioEvent('pause');
    assert.equal(app.media.playbackState, 'paused');
    app.close();
  });

  it('does nothing (and does not throw) where Media Session is unsupported', async () => {
    const app = await loadApp();
    app.sb.playStation(other); app.audioEvent('playing');
    assert.deepEqual(app.errors, []);
    app.close();
  });
});
