# skyband

A calm, location-aware world radio player: a floating search dock and a bottom player pill over a full-bleed interactive map.

**Live:** https://m4roon3d.github.io/skyband/

- **Map views:** Globe, Flat, Street and Satellite (D3 + Natural Earth vectors, Leaflet + keyless ArcGIS tiles), with a live day/night terminator.
- **Radio:** FM, AM and web stations from [Radio Browser](https://www.radio-browser.info/), scoped Nearby, City, State, Country or World, with natural-language search ("Tokyo jazz", "FM").
- **Playback:** native HLS on Safari, `hls.js` elsewhere, a 7 second stall guard that auto-skips dead streams, and a 15–99% playability meter.
- **Extras:** Explore (Spin the Globe, Follow the Night, Golden Hour, World Tour), a World Passport, an ambient mixer, a sleep timer and five font themes.

No backend, no API keys, no build step: the whole app is the single static `index.html`.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Geolocation ("Near Me") needs HTTPS or `localhost`.

## Tests

```sh
npm ci
npm test
```

Tests run on Node's built-in runner against the real `index.html` loaded into jsdom (real D3/TopoJSON, stubbed audio/Leaflet/Web Audio/network). They cover pure logic, station loading and failover, the player and auto-heal, the omnibox, map views, keyboard shortcuts, HTML-escaping, and the GitHub Pages/PWA packaging.

## Deploy

Every push to `main` runs the tests, then deploys `index.html`, `manifest.json`, `.nojekyll` and `icons/` to GitHub Pages (`.github/workflows/pages.yml`). A failing test blocks the deploy.

## Design guardrails

- The brand is always lowercase: **skyband**.
- Two floating surfaces (top-left omnibox + station sheet, bottom player pill) over the map.
- Explore and the Globe | Flat | Street | Satellite switcher are always visible.
- All external requests are HTTPS-only.

See [docs/CLAUDE_HANDOVER.md](docs/CLAUDE_HANDOVER.md) for the original handover notes.

## Listening extras

- **World Tour / Spin**: about 80 cities across every continent; prefers countries you haven't collected in your passport yet.
- **Remembers where you left off**: last place, scope and station come back on reload (it never autoplays).
- **Lock-screen controls**: play, pause, next and previous from the lock screen, headset or car (Media Session).
- **Now playing**: track names for SomaFM and KEXP streams. Other stations don't publish an open feed, so they show the normal subtitle.
- **Mood radio**: Explore menu, worldwide tag search (Focus, Chill, Cozy, Party, Workout, Classical, Sleep, World).
- **Wake-up alarm**: player menu. Rings only while skyband is open in a tab; browsers can't wake a sleeping phone or closed page.
- **Install**: Explore menu shows Install when the browser allows it (iPhone Safari shows an Add to Home Screen hint). `sw.js` caches nothing, it only makes the app installable.
- **Share link**: the share button in the player copies (or opens the share sheet for) a link to your station and place. Opening it loads them without autoplay.
- **Listening stats**: Today, last 7 days, countries heard and most-played stations, in the skyband menu. Stored only in this browser.
- **Featured chip**: one tap next to Best for the free official high-quality streams.
