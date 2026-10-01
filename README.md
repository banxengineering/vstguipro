# VST GUI Pro

A Figma plugin for designing audio-plugin interfaces: knobs, sliders, wheels, buttons, meters and panels, exported as sprite strips or as a layout for Vellum.

## Files

| File | What it is |
|---|---|
| `manifest.json` | Figma plugin manifest |
| `code.js` | Plugin main thread: builds nodes on the canvas, exports |
| `ui.html` | Plugin UI: the studios, previews and presets |
| `CHANGELOG.md` | Release notes, one section per version |
| `docs/` | Release notes images and customer examples |

## Run it locally

In the Figma desktop app: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.

## Workflow

- `main` always holds working, shippable code.
- Do each change on its own branch (`feature/…` or `fix/…`), then merge it into `main`.
- Add a line to `CHANGELOG.md` under **Unreleased** with every change.
- On release, rename **Unreleased** to the version and date, and tag the commit (`git tag v2.2.0`, then `git push --tags`).
