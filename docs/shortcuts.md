# Keyboard shortcuts

Solid Groove's keyboard mappings live in one typed registry,
[`src/shortcuts/registry.ts`](../src/shortcuts/registry.ts). Event handling,
tooltips, menu labels, the in-app `?` guide, the `shortcut_used` analytics
`action_id` set, and the table below are all derived from it — a key combination
is never written down twice.

This page and that registry are the source for the shortcut contract. It was
originally specified as `KEY-01` (the Ableton-familiar mapping) and `KEY-02` (the
`?` mapping guide) in `docs/prd.md`; that text was removed when the PRD became a
principles document, so the `KEY-01`/`KEY-02` citations still in `src/` comments
point here.

This page is the *human* copy of that registry, for reviewers and for anyone
deciding a new mapping. `src/shortcuts/docs.test.ts` fails if it drifts from the
registry, so it cannot quietly go stale.

## The mapping

Contexts are the surfaces a shortcut is valid in. `global` is always active;
`dialog` suppresses every other context while a modal or menu is open, so an
open dialog receives normal typing and nothing fires underneath it.
`sequence_editor` is the exception that proves that rule: the sequence editor
`UI-001` opens over the arrangement is `role="dialog"` to a screen reader, but
the transport, the note shortcuts and the view switches all have to keep working
while a producer programs a clip in it, so it gets a context of its own instead.
`loop_brace` is a focus context: it is active only while the ruler's loop brace
has keyboard focus, and for the keys it claims (`Left`, `Right` and their
`Shift` forms) it outranks the wider editor, so `Left` moves the brace rather
than also meaning `track.move_left`. It suppresses nothing else.

| Action ID | Action | macOS | Windows/Linux | Guide group | Contexts | Ableton Live 12 |
| --- | --- | --- | --- | --- | --- | --- |
| `transport.play_stop` | Play/stop | `Space` | `Space` | Transport | editor | Follows Live (`Space`) |
| `transport.continue` | Continue from stop position | `Shift+Space` | `Shift+Space` | Transport | editor | Follows Live (`Shift+Space`) |
| `transport.metronome` | Toggle metronome | `O` | `O` | Transport | editor | Solid Groove addition — no single-key Live equivalent is claimed |
| `transport.toggle_loop` | Toggle loop | `Shift+L` | `Shift+L` | Transport | editor | Solid Groove addition — no Live shortcut is claimed for the loop switch itself |
| `edit.undo` | Undo | `Cmd+Z` | `Ctrl+Z` | Global Editing | global | Follows Live (`Cmd/Ctrl+Z`) |
| `edit.redo` | Redo | `Cmd+Shift+Z` | `Ctrl+Y / Ctrl+Shift+Z` | Global Editing | global | Follows Live (`Cmd+Shift+Z / Ctrl+Y`) |
| `edit.cut` | Cut | `Cmd+X` | `Ctrl+X` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+X`) |
| `edit.copy` | Copy | `Cmd+C` | `Ctrl+C` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+C`) |
| `edit.paste` | Paste | `Cmd+V` | `Ctrl+V` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+V`) |
| `edit.select_all` | Select all | `Cmd+A` | `Ctrl+A` | Global Editing | selection | Follows Live (`Cmd/Ctrl+A`) |
| `edit.delete` | Delete selection | `Delete / Backspace` | `Delete / Backspace` | Global Editing | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`Delete / Backspace`) |
| `edit.duplicate` | Duplicate selection | `Cmd+D` | `Ctrl+D` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+D`) |
| `arrangement.split_clip` | Split clip | `E` | `E` | Arrangement | arrangement | Differs from Live's `Cmd/Ctrl+E` |
| `arrangement.toggle_loop` | Toggle arrangement loop | `L` | `L` | Arrangement | arrangement | Differs from Live's `Cmd/Ctrl+L` |
| `arrangement.toggle_automation_view` | Toggle automation view | `A` | `A` | Automation | arrangement | Follows Live (`A`) |
| `clip.quantize` | Quantize selected notes | `Q` | `Q` | Clips and Notes | step_editor, piano_roll | Differs from Live's `Cmd/Ctrl+U` |
| `clip.toggle_draw_mode` | Toggle draw mode | `B` | `B` | Clips and Notes | step_editor, piano_roll, automation_lane | Follows Live (`B`) |
| `view.zoom_to_selection` | Zoom to selection | `Z` | `Z` | Navigation | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`Z`) |
| `view.zoom_back` | Zoom back | `X` | `X` | Navigation | arrangement, step_editor, piano_roll, automation_lane | Follows Live (`X`) |
| `view.zoom_in` | Zoom in | `+` | `+` | Navigation | editor, timeline, arrangement, step_editor, piano_roll, automation_lane | Follows Live (`+`) |
| `view.zoom_out` | Zoom out | `-` | `-` | Navigation | editor, timeline, arrangement, step_editor, piano_roll, automation_lane | Follows Live (`-`) |
| `arrangement.loop_move_earlier` | Move loop earlier | `Left` | `Left` | Arrangement | loop_brace | Solid Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_move_later` | Move loop later | `Right` | `Right` | Arrangement | loop_brace | Solid Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_shorten` | Shorten loop | `Shift+Left` | `Shift+Left` | Arrangement | loop_brace | Solid Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_lengthen` | Lengthen loop | `Shift+Right` | `Shift+Right` | Arrangement | loop_brace | Solid Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `view.zoom_to_arrangement` | Zoom to arrangement | `Shift+Z` | `Shift+Z` | Navigation | editor | Solid Groove addition — Live has no single key that frames the whole set |
| `view.scroll_to_playhead` | Scroll to playhead | `P` | `P` | Navigation | editor | Solid Groove addition — Live's Follow switch (`Cmd/Ctrl+Shift+F`) is a mode, this is a one-shot jump |
| `view.show_arrangement` | Show the arrangement | `1` | `1` | Navigation | editor, sequence_editor | Solid Groove addition — Live shows everything at once and has no view to switch to |
| `view.show_instrument` | Show the instrument | `2` | `2` | Navigation | editor, sequence_editor | Solid Groove addition — Live shows everything at once and has no view to switch to |
| `view.show_mixer` | Show the mixer | `3` | `3` | Navigation | editor, sequence_editor | Solid Groove addition — Live shows everything at once and has no view to switch to |
| `view.close_surface` | Close or cancel | `Escape` | `Escape` | Navigation | global, dialog, gesture | Follows Live (`Esc`) |
| `help.shortcut_guide` | Open keyboard mapping guide | `?` | `?` | Navigation | editor | Solid Groove addition — `?` is the web convention |
| `device.move_earlier` | Move device earlier | `Option+Up` | `Alt+Up` | Mixer and Devices | editor | Solid Groove addition — Live reorders devices by dragging only |
| `device.move_later` | Move device later | `Option+Down` | `Alt+Down` | Mixer and Devices | editor | Solid Groove addition — Live reorders devices by dragging only |
| `track.move_left` | Move track left | `Left` | `Left` | Mixer and Devices | editor | Solid Groove addition — Live reorders tracks by dragging only |
| `track.move_right` | Move track right | `Right` | `Right` | Mixer and Devices | editor | Solid Groove addition — Live reorders tracks by dragging only |
| `track.select_previous` | Select previous track | `Up` | `Up` | Navigation | editor | Solid Groove addition — the arrow keys step the editor's selected track through the track list. |
| `track.select_next` | Select next track | `Down` | `Down` | Navigation | editor | Solid Groove addition — the arrow keys step the editor's selected track through the track list. |
| `note.move_up` | Move notes up | `Up` | `Up` | Clips and Notes | piano_roll | Follows Live (`Up`) |
| `note.move_down` | Move notes down | `Down` | `Down` | Clips and Notes | piano_roll | Follows Live (`Down`) |
| `note.octave_up` | Move notes up an octave | `Shift+Up` | `Shift+Up` | Clips and Notes | piano_roll | Follows Live (`Shift+Up`) |
| `note.octave_down` | Move notes down an octave | `Shift+Down` | `Shift+Down` | Clips and Notes | piano_roll | Follows Live (`Shift+Down`) |
| `note.move_earlier` | Move notes earlier | `Left` | `Left` | Clips and Notes | piano_roll | Follows Live (`Left`) |
| `note.move_later` | Move notes later | `Right` | `Right` | Clips and Notes | piano_roll | Follows Live (`Right`) |
| `note.shorten` | Shorten notes | `Shift+Left` | `Shift+Left` | Clips and Notes | piano_roll | Follows Live (`Shift+Left`) |
| `note.lengthen` | Lengthen notes | `Shift+Right` | `Shift+Right` | Clips and Notes | piano_roll | Follows Live (`Shift+Right`) |
| `value.nudge_up` | Nudge value up | `Up` | `Up` | Global Editing | value_field | Follows Live (`Up`) |
| `value.nudge_down` | Nudge value down | `Down` | `Down` | Global Editing | value_field | Follows Live (`Down`) |

`Browser` is a declared guide group with no mappings yet. The task that builds
that surface adds entries to the existing group rather than inventing a section.
The two `device.*` moves act on the device whose header has focus: they are the
keyboard way to reorder a chain, which the pointer does by dragging.

In `piano_roll` the eight `note.*` moves act on the selected notes: Up and Down
step through the rows the roll shows, so in a scale they move by scale degree;
Shift moves by an octave, or changes the length. `piano_roll` is an overlay
context: while the roll is open, its arrows outrank the editor's
`track.move_*` and `track.select_*` behind it. `value_field` is a focus
context, above that again: while a typed value field has focus, Up and Down
nudge the value.

## Deviations from Ableton Live

Solid Groove follows Live where the same concept exists *and* the browser leaves
the combination alone. Three mappings drop Live's modifier because the browser
owns it:

| Action | Live | Solid Groove | Why |
| --- | --- | --- | --- |
| Split clip | `Cmd/Ctrl+E` | `E` | `Cmd/Ctrl+E` drives browser search / the address bar. |
| Toggle arrangement loop | `Cmd/Ctrl+L` | `L` | `Cmd/Ctrl+L` focuses the address bar and cannot be reclaimed. |
| Quantize notes | `Cmd/Ctrl+U` | `Q` | `Cmd/Ctrl+U` is view-source on Windows/Linux. |

Three mappings have no Live baseline at all and say so rather than implying one:
`O` (metronome), `Shift+L` (the loop switch — Live's `Cmd/Ctrl+L` loops the
selection instead, and the browser keeps that chord), and `?` (this guide).

## Pointer modifiers

A key held during a pointer gesture changes what the gesture does. These are
read off the pointer event, not dispatched as shortcuts, so they are not in
`SHORTCUTS` and log no `shortcut_used`; they live beside it in
[`src/shortcuts/pointerGestures.ts`](../src/shortcuts/pointerGestures.ts), which
is the only place one is written down. A component asks `pointerModifierHeld`
rather than reading `altKey` itself, and `src/shortcuts/docs.test.ts` fails if
this table drifts from that file.

| Modifier ID | Action | macOS | Windows/Linux | Ableton Live 12 |
| --- | --- | --- | --- | --- |
| `arrangement.drag_copy` | Copy clips by dragging | `Option+drag` | `Alt+drag` | Differs from Live's `Option-drag (macOS) / Ctrl-drag (Windows)` |
| `piano_roll.drag_copy` | Copy notes by dragging | `Option+drag` | `Alt+drag` | Differs from Live's `Option-drag (macOS) / Ctrl-drag (Windows)` |
| `piano_roll.toggle_select` | Add or remove a note from the selection | `Cmd+click` | `Ctrl+click` | Follows Live (`Cmd/Ctrl-click`) |
| `piano_roll.shift_select` | Add or remove a note from the selection | `Shift+click` | `Shift+click` | Follows Live (`Shift-click`) |

`arrangement.drag_copy` is read at the drop, not the press: holding or letting
go of it partway through a clip-body drag switches between move and copy, and
the preview follows. It copies every selected clip, each as an independent
clip. On macOS it is exactly Live's Option-drag. Windows and Linux use Alt as
well rather than Live's Ctrl-drag, so one modifier copies on every platform and
Ctrl/Cmd-click stays the selection click (CF-015). While a drag holds it, the
bare modifier's own key events are cancelled, so letting go of Alt does not open
the Windows menu bar mid-gesture.

`piano_roll.drag_copy` is read at the press, as the piano roll's design has it:
the copies are made when the drag starts and follow the pointer, and the
originals stay where they were. `piano_roll.toggle_select` and
`piano_roll.shift_select` do the same thing, so either hand can add to a
selection; with a lasso they add what it touches.

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
- **No component owns a key listener.** Every surface that responds to a key —
  the editor, the `?` guide, and `ConfirmDialog` — registers a handler with
  `useShortcuts` instead of comparing `event.key`. `src/shortcuts/` is the only
  place in `src/` that reads `KeyboardEvent.key` for a mapping (`ShortcutGuide`
  reads it for its `Tab` focus trap, which is modal focus management, not a
  mapping). `src/shortcuts/docs.test.ts` enforces this over `src/` — the shipped
  app, and so the only code a keystroke reaches. Build tooling (`scripts/`) and
  the Playwright suites are out of its scope: a `keydown` there is a test
  pressing a key, not a second definition of a mapping. It looks for a `keydown`
  listener, a `key`/`code` read off an event, or a comparison against a named
  key — not every `.key`, since `key` and `code` are ordinary property names
  elsewhere in the app.

## Recorded deviation: enabled state is not in the registry

The `KEY-01` specification listed "enabled state" among what an entry declares. Solid Groove keeps
it on the *handler* instead: a surface passes `isEnabled()` alongside `run()`,
and an action with no registered handler is simply unavailable. Whether Undo can
run is a property of the open session, not of the mapping, and the registry is
imported by tests, docs generation, and the guide, none of which should have to
reach into session state to be built.

The observable behaviour it asked for is unchanged: a disabled action does
not run and does not suppress the browser default (`ShortcutController`), and
the guide marks it "Not available here" from `controller.isEnabled()`.

## Adding or changing a mapping

1. Add the entry to `SHORTCUTS` in `src/shortcuts/registry.ts` with its ID,
   keys, group, contexts, and Ableton position.
2. Add the ID to `SHORTCUT_ACTION_IDS` in both the registry and
   `src/analytics/catalog.ts`.
3. Register a handler on the surface that owns the action with `useShortcuts`
   (see `src/editor/EditorView.tsx`, or `src/components/ConfirmDialog.tsx` for a
   modal). Never add a `keydown` listener to a component. Nothing else changes:
   tooltips, the guide, and analytics pick the entry up automatically.
4. Update the table above. `src/shortcuts/docs.test.ts` checks it.

P0 mappings are read-only for users. User remapping is P1: entries are keyed by
stable action ID and resolved through lookups, so an override layer can replace
an entry's `keys` without changing this file's shape or any consumer.
