# Changelog

⚠️ Major updates in v2.1

## [Unreleased]
- Once submitted for approval
- The user community will have input on future features

## [2.2.0] - 2026-10-11
### Added
- Two new PRO knob styles, **Frost** (light) and **Graphite** (dark): a smooth top-lit dome with a thin value arc, three ticks and a short pointer. Only the pointer and arc move, so the knob body can sit in the panel art with Vellum's ring on top
- **3D knobs**: a new **3D** section in the Knob studio tilts the camera toward the knob and gives it height. Works on any knob, including your own designs
  - **Tilt** (look down on the knob or up from below), **Height** and **Perspective**
  - Lit sides with their own colors, **Shine** and **Rim light**. Smooth round sides are shaded in one even sweep. Knurls, flutes and slots turn on the sides with the value while the lighting stays put
  - Side shapes: **Flare** (a skirt or bell, or a straight cone for speed knobs), **Grooves** (diamond knurling on a knurled body), **Slots** and a plain **Base band**
  - A raised **cap** with its own height, taper (chamfer, cone or witch hat) and optional dome, and a raised **bar** for chicken-head knobs
  - A **cast shadow** that grows with the knob's height, plus a contact shadow where it meets the panel
- **Printing** for 3D knobs: a number scale printed on the top or down the side that turns with the knob, like guitar knobs. 0–10 (Gibson style) or 1–10 with the 0 spot left blank (Fender style), each number standing with its foot toward the knob's edge, read where the pointer starts (lower left) or at the top, with an optional **index mark** on the panel. Also a **label** on top (VOL., TONE) and a **side stripe** under the pointer, like mixer knobs
- Two new free 3D starter styles, **Puck** and **Studio**
- 13 new PRO 3D knobs: **Machined**, **Bakelite**, **Cream**, **Anodized** (LED ring), **Diamond**, **Gold Line**, **Amp**, **Gold Slot**, **Witch Hat**, **Top Hat**, **Skirted**, **Speed** and **Mixer**
- **What's new** card: shows once after an update with the release's highlights and a **Try it** button

### Notes
- Flat knobs are unchanged: existing designs and saved specs build exactly the same knobs and strips as before
- 3D knobs are still flat images frame by frame, so strips, @2x export, Download PNG and Vellum skins work as usual. A 3D strip has more layers than a flat one (about 35–100 per frame), so a 128-frame strip takes a little longer to build
- Use the same Tilt for every knob on a panel so they share one camera

## [2.1.0] - 2026-09-30
### Added
- Endless knobs: a new **Endless** switch in the Knob studio (Output section) and for BYOC knobs. The knob turns a full 360° and loops, for hardware-style endless rotary encoders
- Endless strips stop one step short of a full turn (frame i = 360° × i / frames), so the last frame flows into the first with no repeated frame and no hitch
- Endless strips are named `knob_endless_sprite_128f`, and the PNG Sprite Tester switches to Loop playback on its own when it sees "endless" in the name
- Help text in the Ring section explaining which ring styles work on endless knobs
- **Tips button (?)** next to the tabs: short tips for whichever tab is open (Knobs, Sliders, Wheels, Buttons, Meters, Panels, BYOC, Tester). It pulses gently until you first open it

### Changed
- Endless knobs start pointing straight up (12 o'clock) at frame 0
- Ticks and LED-dot rings spread evenly all the way round on endless knobs: use Track alone for a 360° dotted ring, or add Value for a single dot that follows the pointer
- Arc rings, scale labels (Min/Max, 0–10), Bipolar and Position only are left out on endless knobs, since an arc that never fills reads as a meter
- BYOC endless knobs hide the Sweep setting and skip the value ring
- Studio preview and gallery playback turn continuously in one direction for endless knobs, and dragging or scrolling past the end wraps around
- Updated tooltips for Endless, Ring Track and Value, and Tick Count

### Notes
- Normal knobs are unchanged: existing designs and saved specs build exactly the same strips as in 2.0.0
- In your plugin code, wrap the frame number for an endless knob (`frame = floor(position × frames) mod frames`) instead of clamping it
- For LED-dot rings or encoders with detents, use a frame count that's a multiple of the dot or detent count (e.g. 24 dots → 24, 48, 96 or 120 frames)

## [2.0.0] - 2026-09-28
### Added
- Knob studio: design knobs from layers (body, cap, bar, pointer, ring, ticks) with a live preview you can drag to turn. Free starter styles plus a PRO gallery, and **My designs** for saving your own
- Slider studio: straight and curved sliders, with segmented and stepped "volume" fills
- Wheels studio: pitch bend and mod wheels that roll or slide, with a spring-back preview for pitch
- Button studio: on/off buttons (2 frames) with labels, power icons and LEDs on or beside the button
- Meter studio: bar and LED meters with color zones, plus VU needle meters
- Panel studio: plugin background art (textures, header, sections, screws), with layout templates and **Export to Vellum**
- BYOC (bring your own component): animate a knob, fader or button image made elsewhere, with automatic background cleanup
- **Export @2x** and **Download PNG**: save sharp strips straight to a file, with or without a copy on the canvas
- Landscape layout with a resizable window

### Changed
- PNG Sprite Tester is now the **Tester** tab, with frame detection that matches Vellum
- PRO license is checked with the server at launch, with a 30-day grace period when offline
- Knob, slider, button and meter galleries are rebuilt as editable studio designs

### Removed
- Polisher tab (its textures live on as Panel texture styles)
- Old fixed galleries and their unused code

## [0.1.2] - 2025-11-05
### Added
- PNG Sprite Tester - test animations and save time before adding to your plugin builder

### Fixed
- Fixed default knob error
- Fixed spacing issues and frame gaps: knobs, sliders, meters, buttons
- Resolved pattern recognition issues with dark knob component

### Changed
- Removed drop shadow from default knob
- Smoothing to png rendering inside PNG Sprite Tester
- Adjusted LED Slate Knob - drop shadow too big

## [0.1.1] - 2025-10-29
### Fixed
- Fixed dark knob animation button activation by implementing proper naming convention
- Flattened dark knob layers into single `rotate_knob` element for cleaner structure
- Resolved pattern recognition issues with dark knob component

### Changed
- Updated `createSunkDarkKnob()` function to follow consistent naming convention
- Improved knob structure to match other knob components

## [0.1.0] - 2025-01-XX
### Added
- Initial release of VST GUI Pro
- Knob Gallery with multiple knob designs
- Animation frame generation for knobs
- Pattern recognition system for UI components
- PRO license system
- User profile modal
- Support for various knob types (Ableton, Modern, Metallic, etc.)

### Features
- Dark knob component
- Animation button activation based on component selection
- Gallery-based component creation
- Professional UI design system
