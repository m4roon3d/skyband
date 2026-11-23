# skyband — Project Handover to Claude (GitHub Pages Deployment)

## Quick Prompt to Paste into Claude
> Deploy the attached **skyband** single-file web app (`index.html`) to GitHub Pages under my GitHub account `M4roon3d` (suggested repo: `M4roon3d/skyband`, public). Place `index.html` and `.nojekyll` at the repository root, add a brief `README.md`, optionally add a minimal PWA `manifest.json` + favicon for iOS/Android "Add to Home Screen", enable GitHub Pages on `main` (`/` root), and verify the live `https://m4roon3d.github.io/skyband/` URL. Keep all existing UI, Safari/iOS fixes, and lowercase `skyband` branding intact.

---

## 1. Project Summary
- **App Name:** `skyband` (strictly all lowercase everywhere in UI and branding).
- **Purpose:** Global, location-aware internet radio player with a calm, radically decluttered two-surface floating UI over an edge-to-edge interactive map.
- **Target Hosting:** GitHub Pages (`https://m4roon3d.github.io/skyband/` under GitHub user `M4roon3d`).
- **Build System:** None required. Zero backend, zero API keys, zero build step — runs as a single static `index.html` file.

## 2. Included Files in Handover Bundle
- `index.html` — Production-ready, Safari/iOS/Android-hardened single-file `skyband` web app (copied from `skyband.html`).
- `.nojekyll` — Prevents GitHub Pages Jekyll processing.
- `CLAUDE_HANDOVER.md` — This handover guide.

## 3. Core Features Implemented
- **4-Tier Location Hierarchy + World Discovery:** `Nearby`, `City`, `State`, `Country`, and `World` scope scrubber with GPS `Near Me` (`navigator.geolocation` + reverse geocoding) and click-anywhere-on-map tuning.
- **4 Always-Visible Map Views (`Globe | Flat | Street | Satellite`):**
  - `Globe` & `Flat`: Zero-tile-server D3 v7 + TopoJSON Natural Earth 110m vector maps with drag-to-spin, scroll/button zoom, live astronomical Day/Night solar terminator shadow, and animated flight arcs.
  - `Street` & `Satellite`: Synced Leaflet 1.9.4 maps using keyless ArcGIS MapServer street and aerial imagery tiles.
- **Worldwide FM, AM & Web Radio Recall:** Parallel Radio Browser queries with multi-alias city matching, accent-stripping, national terrestrial station seeds, band filtering (`All`, `FM`, `AM`, `Web`), genre filters, and natural-language omnibox parsing (e.g., `"Tokyo jazz"`, `"FM"`).
- **Audio Engine & Reliability:**
  - Native Safari HLS playback (`canPlayType('application/vnd.apple.mpegurl')`) prioritized for iOS/macOS Safari, with `hls.js@1.7.4` fallback for Chrome/Firefox/Android.
  - 4-bar **Signal Strength & Stream Playability %** (`15–99%`) with live session verification (`Verified` on play, `Failed` on error).
  - **Auto-Heal** 7-second stall guard that automatically skips dead/offline streams to the next live station.
- **Discovery & Atmosphere:**
  - **Explore** menu: `Spin the Globe`, `Follow the Night`, `Golden Hour`, `World Tour` (45s auto-flight across cities with map arcs), and Quick Hop cities.
  - **World Passport:** Collects country stamps automatically as you listen.
  - **Web Audio Ambient Mixer:** Synthesized `Soft Rain`, `Vinyl Warmth`, and `Night Hum` layers + Sleep Timer (`15m`, `30m`, `60m`).
- **Typography & Brand Menu:** Visible lowercase `skyband` brand button in top-left omnibox opening live diagnostics, toggles, World Passport, and 5 persisted **App Font** themes (`Modern`, `Editorial`, `Clean`, `Studio`, `Mono`, stored in `localStorage` under `skyband_font`).

## 4. Safari, iOS & Android Compatibility Fixes Already Applied
- Dynamic viewport sizing (`100dvh`) with `viewport-fit=cover` and `env(safe-area-inset-bottom)` so the floating player pill is never clipped on iPhone/iPad Safari.
- Hardware-composited frosted glass (`-webkit-backdrop-filter`, `translate3d(0,0,0)`, `isolation: isolate`) and `transform`-based SVG radar pulse animation (replaces unsupported CSS `r` keyframes in Safari).
- Explicit SVG `width`, `height`, and `viewBox` updates on render and `orientationchange`, plus `touch-action: none` for smooth touch globe spinning.
- `16px` mobile search input font size to prevent iOS Safari auto-zoom on focus.
- Native Safari HLS detection before `hls.js`, `playsinline webkit-playsinline` on `<audio>`, and `DOMContentLoaded` startup instead of `window.load`.

## 5. External CDN Libraries & Keyless Public APIs Used
- **Tailwind CSS 3.4.17:** `https://cdn.tailwindcss.com/3.4.17`
- **D3 7.9.0:** `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`
- **TopoJSON Client 3.1.0:** `https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js`
- **World Atlas 2.0.2:** `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json`
- **Leaflet 1.9.4:** `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` & `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- **HLS.js 1.7.4:** `https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js`
- **Lucide Icons 0.460.0:** `https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js`
- **Radio Browser API Mirrors:** `https://de1.api.radio-browser.info`, `https://nl1.api.radio-browser.info`, `https://at1.api.radio-browser.info` ([Radio Browser](https://www.radio-browser.info/))
- **Nominatim Reverse Geocoding:** `https://nominatim.openstreetmap.org/reverse`
- **ArcGIS Keyless Tiles:** `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`
- **Verified HTTPS Fallback Streams:** Radio Paradise (`https://stream.radioparadise.com/aac-128`), SomaFM Groove Salad (`https://ice1.somafm.com/groovesalad-128-mp3`), Drone Zone (`https://ice1.somafm.com/dronezone-128-mp3`), DEF CON Radio (`https://ice1.somafm.com/defcon-128-mp3`).

## 6. Deployment Steps for Claude
1. Create a public GitHub repository `M4roon3d/skyband` (or use an existing repo if requested by the user).
2. Commit `index.html`, `.nojekyll`, and a concise `README.md` to the `main` branch root.
3. Enable GitHub Pages in repository settings: **Source → Deploy from a branch → `main` / `/ (root)`**.
4. *(Optional Enhancement)* Add a lightweight `manifest.json` + SVG app icon (`#ff7a18` radio emblem on `#070b12` dark background) and link it in `index.html` `<head>` so iOS/Android "Add to Home Screen" displays the `skyband` icon cleanly.
5. Verify the live HTTPS deployment:
   - Confirm `https://m4roon3d.github.io/skyband/` loads with zero console errors.
   - Verify GPS `Near Me` works over HTTPS on iPhone Safari and Android Chrome.
   - Confirm audio playback (both standard HTTPS and `.m3u8` HLS streams) after a user tap.

## 7. Design Guardrails (Do Not Regress)
- Always keep the brand name styled strictly lowercase: **`skyband`**.
- Preserve the radically decluttered **two-surface floating UI** (top-left omnibox + collapsible station sheet, bottom Dynamic-Island player pill) over the full-bleed map.
- Keep `Explore` and the top-right `Globe | Flat | Street | Satellite` switcher always visible (do not hide behind responsive breakpoints).
- Keep all external fetches HTTPS-only so GitHub Pages never hits mixed-content blocks.
