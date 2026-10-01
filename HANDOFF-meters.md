# Handoff: Meter Studio (next session)

> **Done 2026-09-27.** The meter studio is built and tested headlessly. The project memory has the summary. This file is kept for reference and can be deleted.

Status on 2026-09-27: the knob, slider and button studios are done and tested. The Meters tab is the last tab still using the old UI. The job is to replace it with a meter studio built the same way as the others.

## Start here

1. Read the memory file `vellum-companion-roadmap.md`. It holds the product decisions: free starter styles vs PRO designs, no paywall on Vellum exports, and ~500 users with enterprise polish as the goal.
2. Use the button studio as the template. Meters are closest to sliders (a level fills a track), so reuse SliderCore's helpers.
3. Don't start from scratch. Every studio shares one engine, `createStudio(root, cfg)`.

## What Vellum expects from a meter

The Vellum app is `C:\01 DEV\Figma\vellum-app.html`.

- **Widget:** kind `meter`, default size **24×60** (REGISTRY ~line 1336).
- **Sprite skins work for meters:**
  - Default is **48 frames** in a vertical strip.
  - Frame selection is `Math.round(level * (frames - 1))`, where level is the peak, 0..1 (~line 11919).
  - The frame count comes from the file name, same `(\d{1,4})f` rule as the other studios, so name strips `meter_sprite_48f`.
- **Built-in (unskinned) meter attributes, useful for free presets:**
  - `meterShape`: solid / blocks / dots
  - `meterOrientation`: v / h
  - `meterColorMode`: flat / threshold / gradient
  - Zone colors: green `#3ddc84`, yellow `#ffd166`, red `#ff4d5e`. Zone breaks at 0.66 and 0.90.
  - Segments: 16.
  - All of these are at ~line 8284; the XML writer is ~line 13367.
- **VU meter** (kind `vumeter`, 178×103) has **no sprite skin support in Vellum**, only color settings. Ask the user whether a VU studio is wanted at all, or only as a Figma graphic.
- **Open question:** does Vellum accept horizontal meter skins? Faders only take vertical skins. Check `paintSkinOnEl` before offering horizontal strips.

## How the studios are built (files and anchors)

### ui.html

- `<script id="knob-core">` (~2409) holds the cores:
  - SpecTools
  - KnobCore (~2477)
  - SliderCore (~2849), which exports rrPath / ellipsePath / insideStroke / paintIn
  - ButtonCore (~3182)
- **Add MeterCore after ButtonCore.** It needs:
  - BASE / LIMITS / ENUMS
  - `geometry(s, v)`
  - `render(g, s, v, S, opts)`, `drawInto`, `stageSize` (cap at 6×)
  - `note`
  - PRESETS (free + PRO)
- Studio configs: KNOB_STUDIO (~3531), SLIDER_STUDIO (~3601), BUTTON_STUDIO (~3695). Add METER_STUDIO beside them.
- `createStudio` (~3876) supports these config flags:
  - `states` / `fixedFrames` (buttons)
  - `pointValue` / `dragDelta` (sliders)
  - field types: seg, colors row (`first`, `titles`), text, plus the scrub fields
- **Old meter markup** is `#metersContent` (~1802–2000):
  - peak/VU settings, Generate Meter, VU sprite, Animate Peak Meter, and the Meter1–9 PRO gallery.
  - Replace it with an empty `<div id="metersContent" style="display: none;"></div>`, as was done for buttons. #metersContent is already in the split-layout CSS list (~1633) but also in the CSS-columns rule (~1638); move it out of that rule.
  - Also remove the meter branch in the tab switcher (~4671) and any handlers that point at the removed ids.

### code.js

- `normalizeSpec` (~1205) is generic. Add normalizeMeterSpec, meterGeometry, meterBuild*, createSpecMeter, createSpecMeterStrip.
- Copy the button pattern at ~2194:
  - Use `__awaiter` / `yield` for async.
  - Set pluginData keys meterSpec / meterKind / meterStrip.
  - Name frames `frame_000`….
- **Geometry parity rule:** the canvas renderer in ui.html and the Figma builder in code.js must produce the same geometry. The spec harness checks this.
- **Handlers:** add `create-meter-spec` / `update-meter-spec` next to `create-button-spec` (~215), and post meterSpec / meterKind / meterStrip in `selectionchange`.
- **Old meter code:** leave it in place but unused, as with buttons:
  - createPeakMeter (~4569)
  - createVUMeter (~4739)
  - createPeakMeterFilmstrip (~5007)
  - createVUSprite (~5409)
  - the `create-meter` / `create-peak-meter-animation` / `create-vu-sprite` handlers

## Suggested meter spec (a draft, confirm with the user)

- **Frame:** `orient` v/h, `length`, `thickness` in px. Parts are in units where thickness = 100, like sliders.
- **Parts:**
  - **housing:** background, radius, edge, inset shadow
  - **bar:** solid, or segments with count/gap/shape (rect, dot)
  - **color:** flat, threshold (zones), or gradient
  - **unlit segments:** off color or dimmed
  - **peak-hold line:** optional
  - **scale ticks / dB labels:** optional
  - **stereo:** two bars (L/R) in one frame
- **Frames:** default 48, but let users pick any count, including 64 and 128. With segmented meters it looks better when frames − 1 is a multiple of the segment count; ask the user whether to snap to that.
- **Presets:**
  - Free (3–4): Solid, Segmented LED, Dots, Stereo.
  - PRO: recreations of the old gallery Meter1–9 (look at `createGalleryMeter` in ui.html/code.js to see what those were), plus a few Vellum-style looks.

## Testing (Node is not installed; use headless Chrome)

The scratchpad from the last session may be gone. If so, rebuild the harnesses the same way:

- **spec-harness.html:**
  - Mock `figma` with createText / loadFontAsync.
  - Load code.js and the knob-core script.
  - Assert canvas vs Figma geometry parity.
  - Last run: 144 passing.
- **studio-test.html:**
  - Copy ui.html with a test script appended at the end. ui.html has **no `</body>`**.
  - Last run: 54 passing.
- **Gotchas:**
  - Inject the error listener before the first `<script` in ui.html, or load-time exceptions go unnoticed.
  - In headless Chrome, rAF never fires, and canvas.toBlob stalls (use toDataURL).
  - PowerShell here-strings eat backticks (`` `b `` becomes a backspace). Don't use JS template literals in code inserted through PowerShell; write files with the Write tool instead.

Back up ui.html before the big edit, for example `ui.backup-before-meters.html` in the scratchpad.

## User preferences seen so far

- Short answers. Direct fixes over options lists.
- Power-of-two frame counts (64/128) must work.
- Keep it simple when told: "just 2 frames" for buttons.
- Stage hint text must not overlap the component (`.knob-stage` has padding-bottom 28px).
- Drag must cover the full range, with the control following the cursor 1:1.
- No "Vellum" labeling in the PRO galleries.
- The user tests in real Figma (plugin "VST GUI Pro2").

## Still untested in real Figma

- Slider and button builders
- Inter font loading for button labels
- Glow/shadow clipping on strips
- A 2-frame button strip loaded into Vellum
