'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { INDEX_PATH } = require('./helpers/load');

const html = fs.readFileSync(INDEX_PATH, 'utf8');
const doc = new JSDOM(html).window.document;
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

describe('static checks: index.html', () => {
  it('inline app script is syntactically valid and strict', () => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'index.html<script>' }));
    assert.match(script, /^\s*\(function \(\) \{\s*'use strict';/);
  });

  it('has exactly one inline script and the expected pinned CDN scripts', () => {
    const inline = [...doc.querySelectorAll('script:not([src])')];
    assert.equal(inline.length, 1);
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.src);
    assert.deepEqual(srcs, [
      'https://cdn.tailwindcss.com/3.4.17',
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
      'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
      'https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js',
      'https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js'
    ]);
    assert.ok(doc.querySelector('link[href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"]'));
  });

  it('never references a plain-http URL (mixed-content safe on GitHub Pages)', () => {
    const http = html.match(/http:\/\/[^\s"'`)<>]+/g) || [];
    assert.deepEqual(http, []);
  });

  it('every external URL in the file is https', () => {
    const urls = html.match(/\bhttps?:\/\/[^\s"'`)<>]+/g) || [];
    assert.ok(urls.length > 10);
    for (const u of urls) assert.ok(u.startsWith('https://'), u);
  });

  it('keeps the brand strictly lowercase "skyband" everywhere', () => {
    const all = html.match(/skyband/gi) || [];
    assert.ok(all.length >= 4);
    for (const m of all) assert.equal(m, 'skyband');
    assert.match(doc.title, /^skyband — world radio$/);
    assert.equal(doc.getElementById('btn-brand-status').textContent.trim(), 'skyband');
  });

  it('has unique element ids', () => {
    const ids = [...doc.querySelectorAll('[id]')].map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `duplicates: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  });

  it('every getElementById() target used by the script exists in the markup', () => {
    const dynamic = new Set(['btn-reset-empty']); // created at render time
    const wanted = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(wanted.length > 60);
    const missing = wanted.filter((id) => !dynamic.has(id) && !doc.getElementById(id));
    assert.deepEqual(missing, []);
  });

  it('exposes the 4 map views in order, the 5 scopes, 4 bands and 5 fonts', () => {
    const q = (s, a) => [...doc.querySelectorAll(s)].map((e) => e.dataset[a]);
    assert.deepEqual(q('#map-mode-switcher .proj-btn', 'proj'), ['globe', 'flat', 'street', 'satellite']);
    assert.deepEqual(q('#scope-scrubber .scope-btn', 'scope'), ['nearby', 'city', 'state', 'country', 'global']);
    assert.deepEqual(q('#band-chips .band-btn', 'band'), ['all', 'fm', 'am', 'web']);
    assert.deepEqual(q('#font-switcher .font-opt-btn', 'font'), ['modern', 'editorial', 'clean', 'studio', 'mono']);
  });

  it('design guardrail: Explore + map switcher are never hidden by a responsive breakpoint', () => {
    for (const sel of ['#map-mode-switcher', '#btn-explore']) {
      for (let el = doc.querySelector(sel); el && el.tagName !== 'HTML'; el = el.parentElement) {
        const bad = [...el.classList].filter((c) => /(^|:)(hidden|invisible)$/.test(c));
        assert.deepEqual(bad, [], `${sel} ancestor <${el.tagName.toLowerCase()} id=${el.id}> has ${bad}`);
      }
    }
  });

  it('design guardrail: two-surface UI (left dock + bottom player pill) over a full-bleed map', () => {
    assert.ok(doc.querySelector('#map-stage.absolute.inset-0'));
    assert.ok(doc.querySelector('#left-dock #search-input'));
    assert.ok(doc.querySelector('#left-dock #station-sheet'));
    assert.ok(doc.getElementById('btn-play-pause'));
  });
});

describe('static checks: Safari / iOS / Android hardening', () => {
  it('viewport uses viewport-fit=cover and dynamic viewport height', () => {
    assert.match(doc.querySelector('meta[name=viewport]').content, /viewport-fit=cover/);
    assert.match(html, /height:\s*100dvh/);
  });
  it('player pill respects the iOS safe-area inset', () => {
    assert.match(html, /bottom:\s*max\(1rem,\s*env\(safe-area-inset-bottom\)\)/);
  });
  it('search input is 16px on mobile (prevents iOS focus zoom)', () => {
    assert.match(doc.getElementById('search-input').className, /text-\[16px\]/);
  });
  it('frosted glass is hardware composited and -webkit- prefixed', () => {
    const rules = html.match(/\.frosted(-pop)?\s*\{[^}]*\}/g);
    assert.equal(rules.length, 2);
    for (const r of rules) {
      assert.match(r, /-webkit-backdrop-filter/);
      assert.match(r, /translate3d\(0, 0, 0\)/);
      assert.match(r, /isolation:\s*isolate/);
    }
  });
  it('radar pulse animates transform (not the unsupported CSS `r` property)', () => {
    const kf = html.match(/@keyframes radarRingPulse\s*\{[\s\S]*?\n\s{4}\}/)[0];
    assert.match(kf, /transform:\s*scale/);
    assert.doesNotMatch(kf, /\br:/);
  });
  it('globe supports touch dragging', () => {
    assert.match(html, /#world-svg\s*\{[^}]*touch-action:\s*none/);
  });
  it('audio element is inline-playable on iOS', () => {
    const a = doc.getElementById('radio-audio');
    assert.ok(a.hasAttribute('playsinline'));
    assert.ok(a.hasAttribute('webkit-playsinline'));
  });
  it('detects native Safari HLS before falling back to hls.js', () => {
    assert.ok(script.indexOf("canPlayType('application/vnd.apple.mpegurl')") < script.indexOf('new window.Hls('));
  });
  it('boots on DOMContentLoaded (not window.load)', () => {
    assert.match(script, /addEventListener\('DOMContentLoaded', init\)/);
    assert.doesNotMatch(script, /addEventListener\('load'|window\.onload/);
  });
});
