'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { ROOT, INDEX_PATH } = require('./helpers/load');

const html = fs.readFileSync(INDEX_PATH, 'utf8');
const doc = new JSDOM(html).window.document;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

/** Width/height from a PNG's IHDR chunk. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('GitHub Pages / PWA packaging', () => {
  it('ships .nojekyll at the repo root', () => {
    assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')));
  });

  it('manifest: lowercase brand, relative start_url/scope (works under /skyband/), dark theme colours', () => {
    assert.equal(manifest.name, 'skyband');
    assert.equal(manifest.short_name, 'skyband');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.background_color, '#070b12');
    assert.equal(manifest.theme_color, '#070b12');
  });

  it('manifest icons exist on disk with the declared sizes; includes 192, 512 and a maskable icon', () => {
    const png = manifest.icons.filter((i) => i.type === 'image/png');
    assert.ok(png.some((i) => i.sizes === '192x192'));
    assert.ok(png.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
    assert.ok(png.some((i) => i.purpose === 'maskable'));
    for (const icon of manifest.icons) {
      assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative`);
      const file = path.join(ROOT, icon.src);
      assert.ok(fs.existsSync(file), icon.src);
      if (icon.type === 'image/png') {
        const [w, h] = pngSize(file);
        assert.equal(`${w}x${h}`, icon.sizes, icon.src);
      }
    }
  });

  it('index.html links the manifest, SVG favicon and a 180px apple-touch-icon (all relative paths)', () => {
    const href = (sel) => doc.querySelector(sel).getAttribute('href');
    assert.equal(href('link[rel=manifest]'), 'manifest.json');
    assert.equal(href('link[rel=icon]'), 'icons/icon.svg');
    assert.equal(href('link[rel=apple-touch-icon]'), 'icons/apple-touch-icon.png');
    for (const h of ['manifest.json', 'icons/icon.svg', 'icons/apple-touch-icon.png']) assert.ok(fs.existsSync(path.join(ROOT, h)), h);
    assert.deepEqual(pngSize(path.join(ROOT, 'icons/apple-touch-icon.png')), [180, 180]);
  });

  it('index.html theme-color matches the manifest and the app is installable on iOS', () => {
    assert.equal(doc.querySelector('meta[name=theme-color]').content, manifest.theme_color);
    assert.equal(doc.querySelector('meta[name=apple-mobile-web-app-capable]').content, 'yes');
    assert.equal(doc.querySelector('meta[name=apple-mobile-web-app-title]').content, 'skyband');
  });

  it('no root-absolute local URLs (they would 404 on https://<user>.github.io/skyband/)', () => {
    const bad = [...doc.querySelectorAll('[src],[href]')]
      .map((e) => e.getAttribute('src') || e.getAttribute('href'))
      .filter((u) => u && u.startsWith('/') && !u.startsWith('//'));
    assert.deepEqual(bad, []);
  });

  it('every local file the page references exists', () => {
    const locals = [...doc.querySelectorAll('[src],[href]')]
      .map((e) => e.getAttribute('src') || e.getAttribute('href'))
      .filter((u) => u && !/^(https?:|data:|#|mailto:)/.test(u));
    for (const u of locals) assert.ok(fs.existsSync(path.join(ROOT, u)), u);
  });
});
