'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load');

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME = IOS.replace('Version/17.0', 'CriOS/120.0');
const hidden = (app) => app.document.getElementById('btn-install').classList.contains('hidden');
const bip = (app) => {
  const ev = new app.window.Event('beforeinstallprompt', { cancelable: true });
  ev.prompt = () => { ev.prompted = true; }; ev.userChoice = Promise.resolve({ outcome: 'accepted' });
  app.window.dispatchEvent(ev);
  return ev;
};

describe('install prompt', () => {
  it('is hidden until the browser says the app is installable', async () => {
    const app = await loadApp();
    assert.equal(hidden(app), true);
    app.close();
  });

  it('shows after beforeinstallprompt, prompts on click, then hides again', async () => {
    const app = await loadApp();
    const ev = bip(app);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(hidden(app), false);
    app.click('#btn-install'); await app.flush();
    assert.equal(ev.prompted, true);
    assert.equal(hidden(app), true);
    app.close();
  });

  it('appinstalled hides it and says so', async () => {
    const app = await loadApp();
    bip(app);
    app.window.dispatchEvent(new app.window.Event('appinstalled'));
    assert.equal(hidden(app), true);
    assert.match(app.toast().text, /installed/);
    app.close();
  });

  it('iPhone Safari gets the Add-to-Home-Screen hint; iOS Chrome and desktop do not', async () => {
    const ios = await loadApp({ userAgent: IOS });
    assert.equal(hidden(ios), false);
    assert.match(ios.document.getElementById('install-hint').textContent, /Add to Home Screen/);
    ios.click('#btn-install');
    assert.match(ios.toast().text, /Share/);
    ios.close();
    const chrome = await loadApp({ userAgent: IOS_CHROME });
    assert.equal(hidden(chrome), true);
    chrome.close();
  });

  it('never shows inside the installed app', async () => {
    const app = await loadApp({ standalone: true, userAgent: IOS });
    bip(app);
    assert.equal(hidden(app), true);
    app.close();
  });
});

describe('no service worker', () => {
  it('never registers one, and removes any left by an earlier version', async () => {
    let unregistered = 0;
    const app = await loadApp({ serviceWorker: true, swRegistrations: [{ unregister: () => { unregistered++; } }, { unregister: () => { unregistered++; } }] });
    await app.flush();
    assert.deepEqual(app.sw.registered, []);
    assert.equal(unregistered, 2);
    app.close();
  });

  it('is not shipped: no sw.js in the repo or the deploy workflow', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'sw.js')), false);
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
    assert.doesNotMatch(wf, /sw\.js/);
  });
});
