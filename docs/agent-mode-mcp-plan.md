# Agent mode: drive VST GUI Pro from Claude Code or Codex (MCP bridge)

Status (2026-10-17): Phase 2 built except Vellum, which is the last phase by decision. Built: every control type in Agent mode, the panel and layout tools, and Export UI (agent writes to disk, plugin downloads a zip) with PNGs and `layout.json`. Not yet tested in real Figma. Branch: `feature/agent-mode`.

Tested so far (scratchpad harnesses, not in the repo):
- `code.js` against a mock Figma API, 65/65: every tool for every control type, place/move/rebuild keeping name, position, value and the 1x export setting, arrange, labels (centering, font fallback), layout warnings, remove guards, export (dedupe, file names, background hides controls but keeps labels, nothing left on the page, layout.json boxes, 1x fallback and the too-long error), switching page for a panel elsewhere, the studio Export UI path, and a free user (agent blocked; Export UI leaves the PRO knob out and shows the PRO dialog).
- Bridge, 18/18: the review checks above, plus every tool registered, an old plugin refused with an "update the plugin" message, export files written under `<folder>/<panel>/`, a `../` path refused, and a re-export removing the last export's files but keeping the user's own.
- Zip writer: a zip built by the `ui.html` code opens in Windows with folders and non-ASCII names, CRC checked.

The mock can't show what the real renderer does, so steps 10–16 in real Figma are still the gate.

### First real-Figma run (2026-10-18): Gain plugin from a pencil sketch

The agent built a 720×456 gain UI from a hand sketch: a 260 px knob, four mono meters (L/R in and out), two toggle switches and 25 labels, then exported it to `vstgui-export/gain/`. The driver was a script that runs the new bridge as an MCP client, because the session still had the old bridge loaded.

- **Steps 10 and 12 pass, with the bugs below.** `get_layout` had no warnings. The four identical meters shared one strip. A re-export removed the previous knob file. `layout.json` matched the panel.
- **Bug, fixed: Figma's hard export limit is 32,768 px.** With `maxLength: 0`, the 128-frame knob (66,560 px at 2x) came out 256×32,768: Figma shrank it to fit without saying so, and `layout.json` claimed 260 px @2x cells. Export UI now caps every strip at 32,768 px whatever `maxLength` says, and checks each PNG's real size; a mismatch is an error that says to use fewer frames. Mock test added (66/66). Not yet re-run in Figma (the plugin needs a re-run to pick it up).
- **Bug, fixed (not yet re-tested in Figma): `build_panel` could take more than 30 s.** Speck textures (sandpaper, granite) made about 6,000 rectangles and flattened them. They're now one vector per shade (`panelRectsVector`), and panel tools get the 120 s timeout.
- **Follow-ups from the run, done:** the agent asks at most 5 questions before building (server instructions), stops after the build and exports only when asked, tells the user to watch Figma, and the plugin shrinks to a compact bar while it builds (`agent-mini`, Expand to restore). A `help` tool plus `help`/`build`/`export` MCP prompts cover Claude Code and Codex alike, with no separate skill file. Instructions are kept short, and they tell the agent to check with `get_layout` rather than a snapshot per control, to save tokens.
- **Slow export:** 7 min 22 s for the 128-frame knob at 2x. A big knurled knob with a brushed cap is many layers per frame.
- **Spec gaps:** no value-readout box (a dark display for the "0.0 dB" text, which the plugin should draw live anyway), no gear or icon on a button, no free-standing rectangle or line on the panel (`screen` is the only box and it isn't freely placed).
- **Shell note:** text sent through `curl` in Git Bash lost "∞" and "−" (it came through as "8" and "-"). JSON `\u` escapes worked. Real MCP calls aren't affected.
- A stereo meter is one strip, so both bars move together. For separate L/R use two mono meters, as here.

### Second real-Figma run (2026-10-18): Gain plugin, real MCP session

Driven from Claude Code through the real MCP tools (not a script). 760×480 panel, 290 px knob, two stereo meters, three buttons, 26 labels; then `update_panel` to a gradient, a meter restyle, a badge label and an export.

- **Steps 10, 11 and 12 pass.** No layout warnings. `update_panel` kept every control and label in place.
- **Bridge doesn't retry a busy port.** Started while another session held 7417, it kept answering "port in use" after the port was free, until `/mcp` reconnect. Retry the listen every few seconds instead.
- **No "background 2x, strips 1x" option.** `maxLength` also caps 1x strips, so a low `maxLength` errors every strip. It took two exports and a hand-merged `layout.json`. Add a `stripScale` (or `backgroundScale`) option.
- **The agent didn't warn about the 32,768 px limit before the export question.** A 290 px knob at 128 frames is 37,120 px even at 1x. `help` mentions the limit; the build summary should check each strip's length and say so up front.
- **"⚙" doesn't render on a button label** (Inter has no glyph; the label came out blank). "•••" works. Either warn on missing glyphs or add a gear `label.kind`.
- **Stereo meter = one value**, so L/R can't differ in the preview (known; two mono meters if that matters).

## Review fixes (2026-10-17)

- **Only the plugin can connect.** The bridge only accepts a `null` origin (Figma's plugin iframe), so a web page can't pose as the plugin. Scripted tests set `VSTGUI_MCP_ANY_ORIGIN=1`. A sandboxed iframe on a malicious page also sends `null`; a pairing code would close that gap, so decide on it before release.
- **No takeover.** While a plugin window answers pings, a second one is closed with code 4001 and its Agent dot turns steady amber. A window that stops answering is replaced, and its waiting requests fail at once.
- **Idle timeout, not total.** The UI forwards `agent-progress` to the bridge as `{ id, progress: true, done, total }`, and each one restarts the clock: 30 s, or 120 s for `build_strip`. `update_control` on a big strip no longer times out.
- **Screenshots capped at 2048 px** (`AGENT_PNG_MAX_SIDE`). Claude scales images to about 1568 px anyway, and larger PNGs can pass its per-image limit.
- Scripted test against a fake plugin, 8/8 passed: web origin refused, null origin accepted, second window gets 4001, the first keeps serving, a dead link is replaced and its waiting request fails in 1.7 s, and a 40 s update with progress survives the 30 s idle limit.
- Fixed later the same day: `update_control` keeps the node's 1x/2x export setting; `agent-hello` reports `protocol: 2` and the bridge refuses a mismatch with "update the plugin" or "update vstgui-mcp"; a `nodeId` or `panelId` on another page switches to that page first. Still open: parallel tool calls interleave builds (untested).

Built so far: `code.js` agent handlers (knob only), the Agent toggle and socket in `ui.html`, the dev-only manifest entry, and `mcp-bridge/`. The bridge passed a scripted test against a fake plugin: every tool, the PRO gate, out-of-range input, a busy port and a mid-request disconnect. Defaults taken on the open decisions for now: no free preview, port 7417, builds land at the viewport center. Agent mode doesn't stay on between plugin runs; it's off every time the plugin opens.

Differences from the plan below: there is an extra `get_status` tool. `snapshot_selection` is called `snapshot`. `update_control`, `snapshot` and `read_selection_spec` take an optional `nodeId` and fall back to the selection, so the loop survives the user clicking elsewhere. The toggle asks `code.js` (`agent-enable`) instead of reading the UI's license state. The UI only forwards `agent-*` types from the socket.

## Goal

A user pastes a reference image of a knob (or slider, meter, and so on) into Claude Code or Codex. The agent drives VST GUI Pro running in Figma to rebuild it as a real, exportable VST GUI Pro control. It screenshots the result, compares it to the reference, and tweaks the spec until it matches.

This doubles as an internal test: when the agent can't get close, it shows what the spec can't express yet.

## Why this fits the current code

- Every control is already built from a JSON spec. `create-knob-spec`, `create-slider-spec`, `create-wheel-spec`, `create-meter-spec`, `create-button-spec` and `create-panel-spec` are handled in `figma.ui.onmessage` in `code.js`.
- Each spec has `*_SPEC_BASE`, `*_SPEC_LIMITS` and `*_SPEC_ENUMS` tables. The knob tables are `KnobShapes.BASE`, `KnobShapes.LIMITS` and `KnobShapes.ENUMS`. These become the MCP tool schemas.
- `normalizeSpec()` already clamps and cleans any input, so bad values from the model can't break a build.
- Built nodes store their spec in plugin data (`knobSpec`, `sliderSpec`, `buttonSpec` and so on), so the agent can read back what is selected.
- Pro gating already lives in `proBlocked()`, inside the plugin, where the agent can't bypass it.

## Architecture

```
Claude Code / Codex
      │  MCP (stdio)
      ▼
vstgui-mcp bridge (Node, runs on the user's machine)
      │  WebSocket  ws://localhost:7417
      ▼
ui.html  (Agent mode toggle opens the socket)
      │  parent.postMessage / figma.ui.postMessage
      ▼
code.js  (same build functions the studios use)
```

Figma plugins can't be called from outside, so the plugin connects out to the bridge. The user has to have VST GUI Pro open with Agent mode turned on.

Port 7417 is a placeholder. Avoid 3055 (Talk to Figma) and 3845 (Figma's own desktop MCP server).

## Message protocol

Bridge to plugin:

```json
{ "id": "r12", "type": "agent-build", "control": "knob", "spec": { }, "value": 0.5, "animate": false, "frames": 64 }
{ "id": "r13", "type": "agent-update", "spec": { } }
{ "id": "r14", "type": "agent-snapshot", "scale": 2 }
{ "id": "r15", "type": "agent-read-selection" }
```

Plugin to bridge (always echoes `id`):

```json
{ "id": "r12", "ok": true, "nodeId": "12:345", "width": 110, "height": 110, "png": "<base64>", "spec": { } }
{ "id": "r12", "ok": false, "error": "pro-required", "message": "This design is PRO" }
```

`spec` in the reply is the normalized spec, so the agent sees what was clamped or ignored.

## MCP tools (first version)

| Tool | What it does |
|---|---|
| `get_spec_schema(control)` | Returns BASE defaults, LIMITS and ENUMS for one control type, sent from the plugin at connect time |
| `build_control(control, spec, value?)` | Builds one control at the viewport center, returns PNG and normalized spec |
| `update_control(spec)` | Rebuilds the selected control with a new spec, returns PNG and normalized spec |
| `snapshot_selection(scale?)` | PNG of the current selection |
| `read_selection_spec()` | Spec stored on the selected control |
| `build_strip(control, spec, frames, axis)` | The full sprite strip, once the look is right |

Start with knobs only. Add the other controls after the loop works.

## Changes by file

### `manifest.json`

During development, add a dev-only entry. It has no effect on the published plugin:

```json
"networkAccess": {
  "allowedDomains": ["https://dev-banxengineering.pythonanywhere.com"],
  "devAllowedDomains": ["ws://localhost:7417"]
}
```

For release, move `ws://localhost:7417` into `allowedDomains` and add:

```json
"reasoning": "Connects to a local AI agent (Claude Code or Codex) on the user's own computer, only when the user turns on Agent mode."
```

### `code.js`

1. Pull the bodies of the `create-*-spec` and `update-*-spec` handlers into functions that return the node, such as `buildKnobFromMsg(msg)`. The studio handlers call them as before, so the studios behave exactly the same.
2. Make Agent mode a PRO feature. Add an `AGENT_MESSAGES` set (every `agent-*` type except `agent-hello`) and gate it in `proBlocked()` the way `DESIGN_MESSAGES` is gated: `name = 'Agent mode'; feature = true;`.
3. Add `agent-*` handlers that:
   - run the request through `proBlocked()`. On a block, reply `{ ok: false, error: 'pro-required', message: 'Agent mode is a VST GUI Pro feature. Unlock it in the plugin to use it.' }` so the agent can tell the user why. The PRO dialog also shows in the plugin.
   - call the shared build function
   - export a PNG with `node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value } })`
   - reply with `figma.ui.postMessage({ type: 'agent-result', id, ... })`
4. Add `agent-hello`, which isn't gated and returns `{ connected: true, pro: proUnlocked, version }`. The bridge calls it on connect so it can report the license state in its errors.
5. Add `agent-schema` (gated), which returns the BASE, LIMITS and ENUMS tables for each control.

### `ui.html`

1. Add an Agent mode toggle (off by default) and a status dot (off, connecting, connected). Show a PRO badge on it like the other PRO features. When an unlicensed user turns it on, show the PRO dialog and leave the socket closed. The gate in `code.js` stays the real check; the UI gate is only for a clear experience.
2. When it's on, open `new WebSocket('ws://localhost:7417')`. Reconnect with backoff, and stop when the toggle is turned off.
3. Forward socket messages to `code.js` using the existing `post` helper, and send `agent-result` messages back down the socket.
4. Converting PNG bytes to base64 happens here, because the UI iframe has `btoa`.

### New: `mcp-bridge/` (separate package, not loaded by Figma)

- About 200 lines of Node using `@modelcontextprotocol/sdk` and `ws`.
- Speaks MCP over stdio to the agent and runs a WebSocket server on 7417 for the plugin.
- Matches replies to requests by `id`, with a timeout of about 60 s for strip builds.
- Returns PNGs to the agent as MCP image content, so the agent can see them.
- Clear errors: "VST GUI Pro isn't connected. Open the plugin in Figma and turn on Agent mode."
- Install for testing: the repo's `.mcp.json` registers the bridge for Claude Code (VS Code, desktop app and CLI alike). See `mcp-bridge/README.md` for the CLI and Codex options and for troubleshooting. Later this becomes an npm package: `npx vstgui-mcp`.
- Lesson from the first install (2026-10-15): the `claude` CLI often isn't on PATH for VS Code extension users, so `claude mcp add` fails. Lead with `.mcp.json` in user-facing setup instructions, and never write "Run `<command>`" where users might paste the "Run" too.

## Test plan (all in dev mode, before any release)

1. **Plumbing.** Import `manifest.json` under Plugins → Development, turn on Agent mode and confirm the status dot connects. Calling `get_spec_schema('knob')` from Claude Code returns the tables.
2. **One knob.** `build_control('knob', {...})` puts a knob on the canvas and Claude gets the PNG back.
3. **Bad input.** Out-of-range numbers, wrong enum values and missing fields come back normalized, with no crash.
4. **Pro gate.** Clear the license with `clear-license`. Turning on the toggle shows the PRO dialog and leaves the socket closed. If the socket is forced open, every gated tool returns `pro-required` with the upgrade message and builds nothing. `agent-hello` still answers with `pro: false`. Verify the license again and everything works.
5. **Match loop.** Paste three reference knobs (simple flat, ridged metal, 3D with depth). Let Claude iterate up to five rounds each and note what it couldn't reproduce.
6. **Strip.** `build_strip` produces a 64- or 128-frame strip that exports the same way as a studio-built strip.
7. **Disconnect.** Close the plugin mid-request. The bridge times out with a clear message, and turning Agent mode back on reconnects.
8. **Browser Figma.** Repeat steps 1 and 2 in Chrome. Note whether it works; desktop is the supported path.
9. **Codex.** Repeat steps 1 and 2 with Codex as the client.

Record the gaps found in step 5 in this doc. They become the next spec features.

## Open decisions

- **Free preview?** Agent mode is PRO (decided 2026-10-15). Optionally let free users try a few builds per file, for example 3, so they see it work before upgrading. Keep the count in `figma.clientStorage`.
- **Port.** Keep 7417, or let the user pick one in settings (manifest entries are fixed, so allow a short list).
- **Where the agent's builds land.** At the viewport center like the studios, or in a dedicated "Agent" frame on the page.

## Phase 2: full UI (same release)

Goal: from a reference image of a whole plugin UI, the agent builds the panel, places every control at the right position and size, checks the layout against the reference, and then exports the complete UI in one step: a clean background PNG, one strip PNG per control, and a layout file (Vellum XML, plus plain JSON for JUCE, HISE and others). Users without an agent get the same export from a button in the plugin.

### What already exists (no new engine work)

- **Panel studio**: `createSpecPanel` and `updateSpecPanel` in `code.js`. A panel is a frame "Panel · X" with a locked `panel_art` frame at the back (plugin data `panelArt`). Controls go inside it, and Update swaps only the art, so controls survive.
- **Every control type** has a spec and a strip builder, with plugin data `<type>Spec`, `<type>Kind` and `<type>Strip`: knob, slider, button, meter (including VU) and wheel. Paced strip steps (`knobStripSteps` and the others) are already used by Download PNG (`exportStudioStrip`).
- **Vellum layout export**: `exportVellumLayout` walks a panel, classifies layers by name, embeds `panel_art` as the background at 2x, and runs `vellumValidate` (outside the artboard, overlapping controls, non-square knobs, controls under 8 px). It's wireframe-only: controls get no `<skin>`.
- **Vellum skins** (from `parseWidgetEl` in `vellum-app.html`): `<skin file frames stripAxis nativeW nativeH gutter bleed reverse/>`. Files are matched to `<files><file name>` by name, so our `usedBy` spelling (Vellum writes `used-by`) doesn't matter on import. Default frames: knob and fader 128, meter 48, button 2.

### Model: a control on the panel is a preview, the strip is built at export

Placed controls stay single-frame, at their resting value, so the panel looks like the finished UI and stays light. The export rebuilds each control's strip from its stored spec, off to the side like `exportStudioStrip`, exports it and removes it. The canvas never fills up with strips.

### New agent tools

| Tool | What it does |
|---|---|
| `get_spec_schema(control)` | Extended to `panel`, `slider`, `button`, `meter`, `wheel` |
| `build_panel(spec)` | Builds a panel at the viewport center; returns `panelId`, size and PNG |
| `update_panel(panelId, spec)` | Swaps the panel art and keeps the controls |
| `place_control(panelId, control, spec, x, y, value?, name?)` | Builds one control inside the panel; x, y are the top-left in panel px. Returns `nodeId`, its box and a PNG of the panel |
| `update_control(nodeId, spec?, value?, x?, y?, name?)` | Existing tool: also moves and renames. With only x/y it moves without rebuilding |
| `arrange(panelId, items[{nodeId, x, y}])` | Moves many controls in one call, for aligning rows |
| `remove_control(nodeId)` | Deletes a placed control |
| `add_label(panelId, text, x, y, size, color, weight?, align?)` | A text layer on the panel; baked into the background on export |
| `get_layout(panelId)` | Every control's id, type, name, box and value, the `vellumValidate` warnings, and a PNG of the whole panel. The agent's checking step |
| `export_ui(panelId, folder?, options?)` | Builds every strip and writes the files to disk (see below). Long: sends progress |

All except `get_spec_schema` and `get_layout` are PRO, like the rest of Agent mode. Updated server instructions add the UI loop: panel first, then place controls roughly, `get_layout`, compare with the reference, `arrange` and resize, repeat, then `export_ui`.

### Export: what comes out

```
<folder>/<panel-slug>/
  background@2x.png          the panel with every control hidden (art + labels + anything else)
  knobs/cutoff_128f@2x.png   one strip per control, named for Vellum's framesFromFilename
  sliders/level_128f@2x.png
  buttons/bypass_2f@2x.png
  <panel-slug>.vellum.xml    widgets with <skin>, every file embedded
  layout.json                plain list: name, type, x, y, w, h, frames, axis, gap, file
```

- **Background** = the panel frame exported with its controls hidden, not just `panel_art`, so labels and anything else the user added on top come out baked in. Controls are found by their plugin data, not by name.
- **Identical controls share one file** (same spec, size and frames): six identical knobs become one PNG used by six widgets.
- **Names** come from the control's name in the panel, slugged and kept unique (`gain`, `gain-2`).
- **Vellum XML**: classify placed controls by plugin data (`knobKind` → `knob-primary`/`secondary`/`tertiary` by size, slider → `fader` or `slider-h`, button, meter, VU → `vumeter`, wheel → `pitchwheel`/`modwheel`), and add `<skin file frames stripAxis gutter nativeW nativeH/>`. Name-based classification stays for layers that aren't ours.
- **Agent path**: the bridge writes the files. It runs on the user's machine, so it can (default folder `./vstgui-export` next to where the agent runs). The plugin sends files one at a time over the socket, so no single message gets huge.
- **Plugin path**: an **Export UI** button in the Panels tab (next to the existing Vellum export) downloads one `.zip`. A small store-only zip writer in `ui.html` (CRC32 and headers, about 60 lines, no library).
- **Gating**: Vellum exports aren't paywalled (decided 2026-09-26), but a PRO control's strip is, as in Download PNG today. Free users get the export with free controls; PRO controls show the PRO dialog, listing which ones.

### Strip length (decided: fall back per control)

Past 16,384 px a PNG gets unwieldy for some tools and GPUs. It isn't a hard Figma limit (that's 32,768 px, found 2026-10-18: Figma shrinks a longer export to fit, so Export UI caps every strip there and checks the PNG's size); the Download PNG readout already warns at that length. A 110 px knob at 128 frames @2x is 28,160 px. Export UI keeps @2x where a strip fits and writes the rest at @1x, named without `@2x` and listed in `fallbacks`. A strip too long even at 1x is reported as an error, with no file. `maxLength` (agent) changes the limit; 0 turns it off. Vellum reads the scale from the file name, so mixed scales are fine.

### Changes by file

- **`code.js`**: `AGENT_CONTROLS` gets slider, button, meter, wheel and panel; one `buildControlFromMsg(control, msg, strip, progress)` dispatches to the existing builders instead of `buildKnobFromMsg` only. New `agent-*` handlers for the tools above. `exportUi(panel, options, onFile, progress)`, a paced generator that both paths share: find controls, dedupe, build, export, remove, background, XML, JSON. `buildVellumXml` learns `<skin>`, `kind` and `weight`.
- **`ui.html`**: forward the new `agent-*` types; pass `agent-file` messages down the socket; the Export UI button, progress card (reuse Download PNG's) and the zip writer.
- **`mcp-bridge/index.js`**: the new tools; file writing for `export_ui` (paths kept inside the chosen folder); add `protocol: 2` to `agent-hello` and refuse a mismatched plugin with a clear "update the plugin / the bridge" message.

### Test plan additions

10. **Panel loop.** From a reference of a simple effect UI (4 knobs, 2 buttons, a meter), the agent builds the panel and places everything; `get_layout` has no warnings, and the screenshot matches the reference within a few px.
11. **Update keeps layout.** `update_panel` with new art keeps every control where it was.
12. **Export UI, agent.** Files land on disk as listed above; identical knobs share one PNG; a 110 px knob falls back as decided.
13. **Export UI, plugin.** The same panel downloads as a zip with identical contents.
14. **Vellum round trip.** Import the XML into Vellum: the background lines up, every widget has its skin, frame counts are right, and knobs turn through their strips. Check `nativeW`/`nativeH` with @2x files.
15. **JSON.** `layout.json` positions match the XML and the panel in Figma.
16. **Free user.** A panel with one PRO knob: the export runs for everything else and names the PRO control.

### Decisions (2026-10-17)

- **Vellum last.** The Vellum XML with `<skin>` (and `kind`/`weight`) is the final phase, after Export UI is proven in real Figma. Test step 14 waits for it.
- **Strip length**: fall back per control (above).
- **Labels**: baked into the background.
- **Export folder**: `vstgui-export/<panel>/` in the agent's working folder, or `folder` / `VSTGUI_EXPORT_DIR`.
- **Pairing code**: deferred; still open before release (see Review fixes).

### Built as (differences from the plan above)

- `add_label` is `set_label`: it adds a label, or changes one when given its `nodeId`. Options: size, color, weight, font (falls back to Inter), align, width, tracking, opacity.
- `update_control` also takes `x`, `y` and `name`. Moving or renaming doesn't rebuild. A rebuild keeps the name, place, value and the node's 1x/2x export setting. Names are kept in plugin data `agentName`.
- `place_control` returns the control's PNG, not the panel's; `get_layout` is the full-panel check.
- Export UI in the plugin is its own view in the Panels studio ("Export UI", before "Vellum export"), with frame counts per type and Cancel. It uses the Export @2x setting.
- `layout.json` (format 1): `panel { name, width, height, background, scale }` and `controls[] { name, type, design, x, y, w, h, value, file, scale, frames, axis, gap, cell }`, plus `bipolar`, `endless`, `orient` (slider), `meter` (bar or vu), `wheel` (pitch or mod) where they apply.
- All of Agent mode moved to the end of `code.js` (its tables point at every studio's spec consts).

## Release checklist

- [x] Fix the leftovers from the review: `x2` carried over on update, protocol version, `nodeId` on another page
- [x] Phase 2 built, except Vellum
- [ ] Test plan steps 1–13 and 15–16 run in real Figma, results recorded here
- [ ] Vellum XML with skins, then test step 14: **moved to the release after 2.3.0** (decided 2026-10-18: ship Agent mode + Export UI first)
- [ ] Decide on the pairing code (2.3.0 ships without one)
- [x] Move the localhost entry from `devAllowedDomains` to `allowedDomains` and add `reasoning` (2.3.0; Figma's docs allow localhost there with `reasoning`)
- [x] `VERSION` 2.3.0, `BUILD_DATE` 10-18-2026, What's new card for 2.3.0, CHANGELOG `[2.3.0]`
- [ ] Add a plugin description line about Agent mode: off by default, connects only to the user's own machine
- [x] Publish the `vstgui-mcp` npm package (account `banxeng`, 2026-10-18). Users register `npx -y vstgui-mcp` (Windows: `cmd /c npx`)
- [x] One-line install instead of a setup skill: users paste "Install vstgui-mcp from https://www.npmjs.com/package/vstgui-mcp" and the agent follows the README's "Steps for the agent" (Node check, merge `.mcp.json` or Codex config, tell the user to restart and click Agent). User help: `docs/agent-mode-help.html`
- [ ] Add a CHANGELOG entry under **Unreleased**
- [ ] Record a demo: paste a knob, get a filmstrip (Shorts Studio)
