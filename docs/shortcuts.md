# Keyboard shortcuts

Groove's keyboard mappings live in one typed registry,
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
| `transport.metronome` | Toggle metronome | `O` | `O` | Transport | editor | Groove addition — no single-key Live equivalent is claimed |
| `transport.toggle_loop` | Toggle loop | `Shift+L` | `Shift+L` | Transport | editor | Groove addition — no Live shortcut is claimed for the loop switch itself |
| `edit.undo` | Undo | `Cmd+Z` | `Ctrl+Z` | Global Editing | global | Follows Live (`Cmd/Ctrl+Z`) |
| `edit.redo` | Redo | `Cmd+Shift+Z` | `Ctrl+Y / Ctrl+Shift+Z` | Global Editing | global | Follows Live (`Cmd+Shift+Z / Ctrl+Y`) |
| `edit.cut` | Cut | `Cmd+X` | `Ctrl+X` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+X`) |
| `edit.copy` | Copy | `Cmd+C` | `Ctrl+C` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+C`) |
| `edit.paste` | Paste | `Cmd+V` | `Ctrl+V` | Global Editing | selection, arrangement | Follows Live (`Cmd/Ctrl+V`) |
| `edit.select_all` | Select all | `Cmd+A` | `Ctrl+A` | Global Editing | selection, arrangement, step_editor | Follows Live (`Cmd/Ctrl+A`) |
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
| `arrangement.loop_move_earlier` | Move loop earlier | `Left` | `Left` | Arrangement | loop_brace | Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_move_later` | Move loop later | `Right` | `Right` | Arrangement | loop_brace | Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_shorten` | Shorten loop | `Shift+Left` | `Shift+Left` | Arrangement | loop_brace | Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `arrangement.loop_lengthen` | Lengthen loop | `Shift+Right` | `Shift+Right` | Arrangement | loop_brace | Groove addition — Live sets its loop by dragging or `Cmd/Ctrl+L` on a selection |
| `view.zoom_to_arrangement` | Zoom to arrangement | `Shift+Z` | `Shift+Z` | Navigation | editor | Groove addition — Live has no single key that frames the whole set |
| `view.scroll_to_playhead` | Scroll to playhead | `P` | `P` | Navigation | editor | Groove addition — Live's Follow switch (`Cmd/Ctrl+Shift+F`) is a mode, this is a one-shot jump |
| `view.show_arrangement` | Show the arrangement | `1` | `1` | Navigation | editor, sequence_editor | Groove addition — Live shows everything at once and has no view to switch to |
| `view.show_instrument` | Show the instrument | `2` | `2` | Navigation | editor, sequence_editor | Groove addition — Live shows everything at once and has no view to switch to |
| `view.show_mixer` | Show the mixer | `3` | `3` | Navigation | editor, sequence_editor | Groove addition — Live shows everything at once and has no view to switch to |
| `view.close_surface` | Close or cancel | `Escape` | `Escape` | Navigation | global, dialog, gesture | Follows Live (`Esc`) |
| `help.shortcut_guide` | Open keyboard mapping guide | `?` | `?` | Navigation | editor, library | Groove addition — `?` is the web convention |
| `assistant.toggle` | Open or close the assistant | `Cmd+K` | `Ctrl+K` | Navigation | editor | Groove addition — Live has no assistant; `Cmd/Ctrl+K` is the web's convention for summoning one |
| `assistant.grow` | Grow the assistant | `Up / Left` | `Up / Left` | Navigation | resize_edge | Groove addition — Live has no assistant panel |
| `assistant.shrink` | Shrink the assistant | `Down / Right` | `Down / Right` | Navigation | resize_edge | Groove addition — Live has no assistant panel |
| `assistant.grow_more` | Grow the assistant more | `Shift+Up / Shift+Left` | `Shift+Up / Shift+Left` | Navigation | resize_edge | Groove addition — Live has no assistant panel |
| `assistant.shrink_more` | Shrink the assistant more | `Shift+Down / Shift+Right` | `Shift+Down / Shift+Right` | Navigation | resize_edge | Groove addition — Live has no assistant panel |
| `device.move_earlier` | Move device earlier | `Option+Up` | `Alt+Up` | Mixer and Devices | editor | Groove addition — Live reorders devices by dragging only |
| `device.move_later` | Move device later | `Option+Down` | `Alt+Down` | Mixer and Devices | editor | Groove addition — Live reorders devices by dragging only |
| `track.move_left` | Move track left | `Left` | `Left` | Mixer and Devices | editor | Groove addition — Live reorders tracks by dragging only |
| `track.move_right` | Move track right | `Right` | `Right` | Mixer and Devices | editor | Groove addition — Live reorders tracks by dragging only |
| `track.select_previous` | Select previous track | `Up` | `Up` | Navigation | editor | Groove addition — the arrow keys step the editor's selected track through the track list. |
| `track.select_next` | Select next track | `Down` | `Down` | Navigation | editor | Groove addition — the arrow keys step the editor's selected track through the track list. |
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
| `library.pick_1` | Pick 1 | `1` | `1` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_2` | Pick 2 | `2` | `2` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_3` | Pick 3 | `3` | `3` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_4` | Pick 4 | `4` | `4` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_5` | Pick 5 | `5` | `5` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_6` | Pick 6 | `6` | `6` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_7` | Pick 7 | `7` | `7` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_8` | Pick 8 | `8` | `8` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_9` | Pick 9 | `9` | `9` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.select_previous` | Previous sound | `Up` | `Up` | Browser | library | Follows Live (`Up`) |
| `library.select_next` | Next sound | `Down` | `Down` | Browser | library | Follows Live (`Down`) |
| `library.audition` | Audition again | `Space` | `Space` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.insert` | Insert sound | `Enter` | `Enter` | Browser | library | Follows Live (`Enter`) |
| `library.like` | Like sound | `L` | `L` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.similar` | Similar sounds | `S` | `S` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.shuffle` | Shuffle | `R` | `R` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.pick_all` | All of the family | `0` | `0` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.category_previous` | Previous category | `Left` | `Left` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.category_next` | Next category | `Right` | `Right` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.family_previous` | Previous family | `[` | `[` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.family_next` | Next family | `]` | `]` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.genre_menu` | Genre menu | `G` | `G` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.loop_tempo` | Loop tempo | `T` | `T` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.all_sounds` | All sounds | `A` | `A` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.favourites` | Favourites | `F` | `F` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.browse_packs` | Browse packs | `P` | `P` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.back` | Back | `Backspace` | `Backspace` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `library.search` | Search | `/` | `/` | Browser | library | Groove addition — Live's browser has no single-key equivalent; the library's own keys are Groove's |
| `export.focus_previous` | Focus previous track | `Up` | `Up` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |
| `export.focus_next` | Focus next track | `Down` | `Down` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |
| `export.extend_previous` | Extend pick upward | `Shift+Up` | `Shift+Up` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |
| `export.extend_next` | Extend pick downward | `Shift+Down` | `Shift+Down` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |
| `export.toggle_focused` | Include or leave out track | `Space / Enter` | `Space / Enter` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |
| `export.pick_all` | Pick every track | `Cmd+A` | `Ctrl+A` | Browser | export_tracks | Groove addition — Live's export dialog has no track list; these are Groove's own list keys. |

The `export.*` entries are the keys of the Export dialog's track list
(`EXP-004`), in the same `Browser` group. `export_tracks` is a focus context
kept beside `dialog`, like `library`: it is active only while the list has
keyboard focus, so `Space`, the arrows and `Cmd/Ctrl+A` mean the list's own
actions there and nothing behind the dialog. `Escape` stays `view.close_surface`;
the dialog clears a pick before it closes.

The `library.*` entries are the `Browser` group: the keys of the library modal
(`LIB-010`), live only while it is open. The `library` context is active
*beside* `dialog`, never instead of it: `dialog` still suppresses every other
context, so no editor binding fires underneath, and `library` is the one
context a modal may keep alive with it. Every other modal is `dialog` alone.
`Escape` is `view.close_surface` and `?` is `help.shortcut_guide`; the library
reuses both. Typing in the search field keeps every key except `Escape` and
`Down`, which leaves the field. `Enter` and `Space` leave the browser default
alone, so a focused button or checkbox still presses.
The two `device.*` moves act on the device whose header has focus: they are the
keyboard way to reorder a chain, which the pointer does by dragging.

In `piano_roll` the eight `note.*` moves act on the selected notes: Up and Down
step through the rows the roll shows, so in a scale they move by scale degree;
Shift moves by an octave, or changes the length. `piano_roll` is an overlay
context: while the roll is open, its arrows outrank the editor's
`track.move_*` and `track.select_*` behind it. `value_field` is a focus
context, above that again: while a typed value field has focus, Up and Down
nudge the value.

`assistant.toggle` opens the assistant (#849) where it was last left, floating
or docked, and closes it. It works from a focused text field too, because it
types nothing. The four `assistant.grow`/
`shrink` entries are the keys of the assistant's focused resize edge, in the
`resize_edge` focus context: the top edge while it floats, the left edge while
it is docked. Each takes the arrow for either orientation, so Up and Left both
move the edge outward by 16px, and `Shift` moves it 64px. Only one element has
focus, so `resize_edge` is never live beside `loop_brace` or `value_field`, and
may claim the arrows they claim.

## Deviations from Ableton Live

Groove follows Live where the same concept exists *and* the browser leaves
the combination alone. Three mappings drop Live's modifier because the browser
owns it:

| Action | Live | Groove | Why |
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
| `edit.duplicate` | `Cmd/Ctrl+D` | Bookmarks the page in most browsers. Groove cancels the default while an editor selection exists, matching Live. |
| `assistant.toggle` | `Cmd/Ctrl+K` | Ctrl+K focuses the browser's search box in Chrome and Firefox on Windows and Linux. Groove cancels the default while the editor is open. |

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

The `KEY-01` specification listed "enabled state" among what an entry declares. Groove keeps
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
