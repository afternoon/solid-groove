# Solid Groove — UI Mocks (design reference)

Reference mocks for the Solid Groove editor. Agents should compare implemented
screens against the PNGs in `mocks/` and treat the visual language here as the
source of truth.

## Source

- `Solid Groove Mocks.dc.html` — the interactive mock. Open directly in a browser
  (keep `support.js` alongside it). It's a canvas of turns; each option has a
  stable id badge (e.g. `1a`, `7a`).

## Design DNA

- Dark, flat, **square corners everywhere** (no rounding except circular avatars/dots).
- Regions separate by **background tint + elevation**, never borders.
- A **single cyan accent** (`#20c8e8`) carries all state: selection, focus, active value, playhead.
- Surface tints (deep → near): `#141414` app · `#181818` well · `#1e1e1e` section · `#262626` inner · `#383838` control.
- Text: `#e6e6e6` primary · `#8a8a8a` label · `#666666` muted. All controls share a 30px height.

## Mocks (`mocks/`)

| File | Screen |
|------|--------|
| `01-editor-shell.png` | Full editor — transport, browser, arrangement, instrument, assistant |
| `03a-dashboard.png` | Project dashboard (guest start, genre starters, recents) |
| `03b-keyboard-guide.png` | Keyboard shortcut reference |
| `04-landing-page.png` | Marketing landing page |
| `05a-synth-voice.png` | Synth voice (Acid 303) device panel |
| `05b-sampler.png` | Sampler device panel |
| `06a-palette.png` | Color palette + surface tints |
| `06b-buttons.png` | Button styles |
| `06c-slider.png` | Vertical fill-slider (the one continuous control) |
| `07-assistant-video.png` | Assistant recommending an Underdog tutorial — idle |
| `07-assistant-video-playing.png` | Video player playing inline |
| `07-assistant-video-fullscreen.png` | Video player fullscreen |

## Assistant video recommendations

The assistant can surface a tutorial video from a trusted creator inline in the
thread. It is a real player: click the thumbnail to play inline, expand to
fullscreen, or open on YouTube. Same flat/square/single-accent DNA as the editor.
