# Keyboard shortcuts

Solid Groove's keyboard mappings (PRD `KEY-01`, `KEY-02`) live in one typed
registry, [`src/shortcuts/registry.ts`](../src/shortcuts/registry.ts). Event
handling, tooltips, menu labels, the in-app `?` guide, the `shortcut_used`
analytics `action_id` set, and the table below are all derived from it — a key
combination is never written down twice.

This page is the *human* copy of that registry, for reviewers and for anyone
deciding a new mapping. `src/shortcuts/docs.test.ts` fails if it drifts from the
registry, so it cannot quietly go stale.

## The mapping

Contexts are the surfaces a shortcut is valid in. `global` is always active;
`dialog` suppresses every other context while a modal or menu is open, so an
open dialog receives normal typing and nothing fires underneath it.

| Action ID | Action | macOS | Windows/Linux | Guide group | Contexts | Ableton Live 12 |
| --- | --- | --- | --- | --- | --- | --- |
| `transport.play_stop` | Play/stop | `Space` | `Space` | Transport | editor | Follows Live (`Space`) |
| `transport.continue` | Continue from stop position | `Shift+Space` | `Shift+Space` | Transport | editor | Follows Live (`Shift+Space`) |
| `transport.metronome` | Toggle metronome | `O` | `O` | Transport | editor | Solid Groove addition — no single-key Live equivalent is claimed |
| `edit.undo` | Undo | `Cmd+Z` | `Ctrl+Z` | Global Editing | global | Follows Live (`Cmd/Ctrl+Z`) |
| `edit.redo` | Redo | `Cmd+Shift+Z` | `Ctrl+Y / Ctrl+Shift+Z` | Global Editing | global | Follows Live (`Cmd+Shift+Z / Ctrl+Y`) |
| `edit.cut` | Cut | `Cmd+X` | `Ctrl+X` | Global Editing | selection | Follows Live (`Cmd/Ctrl+X`) |
| `edit.copy` | Copy | `Cmd+C` | `Ctrl+C` | Global Editing | selection | Follows Live (`Cmd/Ctrl+C`) |
| `edit.paste` | Paste | `Cmd+V` | `Ctrl+V` | Global Editing | selection | Follows Live (`Cmd/Ctrl+V`) |
| `edit.select_all` | Select all | `Cmd+A` | `Ctrl+A` | Global Editing | selection | Follows Live (`Cmd/Ctrl+A`) |
| `edit.delete` | Delete selection | `Delete / Backspace` | `Delete / Backspace` | Global Editing | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`Delete / Backspace`) |
| `edit.duplicate` | Duplicate selection | `Cmd+D` | `Ctrl+D` | Global Editing | selection | Follows Live (`Cmd/Ctrl+D`) |
| `arrangement.split_clip` | Split clip | `E` | `E` | Arrangement | arrangement | Differs from Live's `Cmd/Ctrl+E` |
| `arrangement.toggle_loop` | Toggle arrangement loop | `L` | `L` | Arrangement | arrangement | Differs from Live's `Cmd/Ctrl+L` |
| `arrangement.toggle_automation_view` | Toggle automation view | `A` | `A` | Automation | arrangement | Follows Live (`A`) |
| `clip.quantize` | Quantize selected notes | `Q` | `Q` | Clips and Notes | step_editor, piano_roll | Differs from Live's `Cmd/Ctrl+U` |
| `clip.toggle_draw_mode` | Toggle draw mode | `B` | `B` | Clips and Notes | step_editor, piano_roll, automation_lane | Follows Live (`B`) |
| `view.zoom_to_selection` | Zoom to selection | `Z` | `Z` | Navigation | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`Z`) |
| `view.zoom_back` | Zoom back | `X` | `X` | Navigation | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`X`) |
| `view.zoom_in` | Zoom in | `+` | `+` | Navigation | timeline, arrangement, step_editor, piano_roll, automation_lane | Follows Live (`+`) |
| `view.zoom_out` | Zoom out | `-` | `-` | Navigation | timeline, arrangement, step_editor, piano_roll, automation_lane | Follows Live (`-`) |
| `view.close_surface` | Close or cancel | `Escape` | `Escape` | Navigation | global, dialog, gesture | Follows Live (`Esc`) |
| `help.shortcut_guide` | Open keyboard mapping guide | `?` | `?` | Navigation | editor | Solid Groove addition — `?` is the web convention |

`Mixer and Devices` and `Browser` are declared guide groups with no mappings
yet. The tasks that build those surfaces add entries to the existing group
rather than inventing a section.

## Deviations from Ableton Live

Solid Groove follows Live where the same concept exists *and* the browser leaves
the combination alone. Three mappings drop Live's modifier because the browser
owns it:

| Action | Live | Solid Groove | Why |
| --- | --- | --- | --- |
| Split clip | `Cmd/Ctrl+E` | `E` | `Cmd/Ctrl+E` drives browser search / the address bar. |
| Toggle arrangement loop | `Cmd/Ctrl+L` | `L` | `Cmd/Ctrl+L` focuses the address bar and cannot be reclaimed. |
| Quantize notes | `Cmd/Ctrl+U` | `Q` | `Cmd/Ctrl+U` is view-source on Windows/Linux. |

Two mappings have no Live baseline at all and say so rather than implying one:
`O` (metronome) and `?` (this guide).

## Browser and OS conflicts

`RESERVED_CHORDS` in the registry lists combinations the browser or operating
system keeps for itself — `Cmd/Ctrl+T`, `+N`, `+W`, `+Q`, `+L`, `+E`, `+U`, the
`Shift` variants of the tab commands, `Cmd/Ctrl+Tab`, `Alt+Tab`, `F5`, `F11`,
and `F12`. A registry test fails if any mapping claims one, which is what stops
"parity with Live" from costing a user their tab.

A cancellable browser combination may still be taken over, but only with the
override recorded on the entry:

| Action | Combination | Note |
| --- | --- | --- |
| `edit.duplicate` | `Cmd/Ctrl+D` | Bookmarks the page in most browsers. Solid Groove cancels the default while an editor selection exists, matching Live. |

## Rules the registry enforces

- **Text entry wins.** Inputs, textareas, content-editable elements, and
  `<select>` receive normal typing; single-letter and `Space` mappings never
  leak into them. `Escape` is the one mapping marked `textEntry: "allowed"`,
  because a modal has to close from its own search box.
- **Deterministic context resolution.** A shortcut fires only if one of its
  declared contexts is active. A registry test proves no two mappings can match
  the same event in the same context, so dispatch is never ambiguous.
- **Layout-aware character matching.** Matching reads `KeyboardEvent.key`, not
  `code`, and ignores the Shift *modifier* for punctuation keys — `?` works
  whether the layout needs Shift, AltGr, or nothing.
- **Platform labels.** `Cmd`/`Option` on macOS, `Ctrl`/`Alt` on Windows/Linux,
  from `chordLabel`.
- **Disabled and unimplemented actions do nothing.** Every PRD mapping is
  registered, but an action with no handler, or whose handler reports
  `isEnabled() === false`, does not run and does not suppress the browser
  default. The guide shows it as "Not available here".
- **Analytics comes from the registry.** `ShortcutController` logs
  `shortcut_used` with the matched entry's `action_id`; handlers never log, so a
  handler cannot report an action other than the one pressed. The catalog pins
  the same ID list, so a new mapping without an analytics decision fails
  `catalog.test.ts`.

## Adding or changing a mapping

1. Add the entry to `SHORTCUTS` in `src/shortcuts/registry.ts` with its ID,
   keys, group, contexts, and Ableton position.
2. Add the ID to `SHORTCUT_ACTION_IDS` in both the registry and
   `src/analytics/catalog.ts`.
3. Register a handler on the surface that owns the action (see
   `src/editor/EditorView.tsx`). Nothing else changes: tooltips, the guide, and
   analytics pick the entry up automatically.
4. Update the table above. `src/shortcuts/docs.test.ts` checks it.

P0 mappings are read-only for users. User remapping is P1: entries are keyed by
stable action ID and resolved through lookups, so an override layer can replace
an entry's `keys` without changing this file's shape or any consumer.
