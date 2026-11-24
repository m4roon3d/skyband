'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');
const { many } = require('./helpers/fixtures');

const HOUR = 3600000;
const radio = () => many(4, (i) => ({ name: `Station ${i}`, clickcount: 100 - i }));
const boot = (opts = {}) => loadApp({ now: '2026-11-24T06:00:00', advanceDate: true, radio, ...opts });
const setAlarm = (app, hhmm) => { app.document.getElementById('alarm-time').value = hhmm; app.click('#alarm-toggle'); };
const status = (app) => app.document.getElementById('alarm-status').textContent;

describe('nextAlarmTime', () => {
  it('picks today if still ahead, otherwise tomorrow; rejects bad input', async () => {
    const app = await boot();
    const from = new app.window.Date('2026-11-24T06:00:00').getTime();
    assert.equal(app.sb.nextAlarmTime('07:00', from) - from, HOUR);
    assert.equal(app.sb.nextAlarmTime('06:00', from) - from, 24 * HOUR);
    assert.equal(app.sb.nextAlarmTime('05:30', from) - from, 23.5 * HOUR);
    for (const bad of ['', '25:00', '07:60', 'abc', null]) assert.equal(app.sb.nextAlarmTime(bad, from), null);
    app.close();
  });
});

describe('wake-up alarm', () => {
  it('rings at the set time: toasts, starts a station, and clears itself', async () => {
    const app = await boot();
    await app.flush();
    setAlarm(app, '07:00');
    assert.match(status(app), /Rings in 1h 00m/);
    assert.equal(app.document.getElementById('alarm-toggle').textContent, 'Cancel');
    app.clock.tick(HOUR - 10000); assert.equal(app.sb.state.currentStation, null);
    app.clock.tick(10000); await app.flush();
    assert.ok(app.sb.state.currentStation, 'a station starts');
    assert.match(app.toast().text, /Good morning/);
    assert.equal(app.sb.state.alarmAt, null);
    assert.equal(app.window.localStorage.getItem('skyband_alarm'), 'null');
    assert.equal(app.document.getElementById('alarm-toggle').textContent, 'Set');
    app.close();
  });

  it('does not pause a station that is already playing', async () => {
    const app = await boot();
    await app.flush();
    app.click('#btn-play-pause'); app.audioEvent('playing');
    const cur = app.sb.state.currentStation;
    setAlarm(app, '07:00');
    app.clock.tick(HOUR + 10000); await app.flush();
    assert.equal(app.sb.state.isPlaying, true);
    assert.equal(app.sb.state.currentStation.stationuuid, cur.stationuuid);
    app.close();
  });

  it('cancel stops it from ringing', async () => {
    const app = await boot();
    await app.flush();
    setAlarm(app, '07:00'); app.click('#alarm-toggle');
    assert.equal(app.sb.state.alarmAt, null);
    app.clock.tick(2 * HOUR); await app.flush();
    assert.equal(app.sb.state.currentStation, null);
    app.close();
  });

  it('is restored after a reload and still rings', async () => {
    const at = new Date('2026-11-24T07:00:00').getTime();
    const app = await boot({ storage: { skyband_alarm: String(at) } });
    await app.flush();
    assert.equal(app.sb.state.alarmAt, at);
    app.clock.tick(HOUR + 10000); await app.flush();
    assert.ok(app.sb.state.currentStation);
    app.close();
  });

  it('on reload: an alarm missed by under 15 min still rings, an older one is dropped silently', async () => {
    const recent = await boot({ storage: { skyband_alarm: String(new Date('2026-11-24T05:50:00').getTime()) } });
    await recent.flush();
    assert.ok(recent.sb.state.currentStation);
    assert.equal(recent.sb.state.alarmAt, null);
    recent.close();
    const old = await boot({ storage: { skyband_alarm: String(new Date('2026-11-24T05:30:00').getTime()) } });
    await old.flush();
    assert.equal(old.sb.state.alarmAt, null);
    assert.equal(old.sb.state.currentStation, null);
    old.close();
  });

  it('a late ring (device slept) only warns and does not start audio', async () => {
    const app = await boot();
    await app.flush();
    app.sb.fireAlarm(true);
    assert.match(app.toast().text, /missed/);
    assert.equal(app.sb.state.currentStation, null);
    assert.equal(app.sb.state.alarmAt, null);
    app.close();
  });

  it('corrupt stored value is ignored', async () => {
    const app = await boot({ storage: { skyband_alarm: '"soon"' } });
    assert.equal(app.sb.state.alarmAt, null);
    assert.deepEqual(app.errors, []);
    app.close();
  });
});
