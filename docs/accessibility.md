# Accessibility

What Groove holds itself to, what checks it automatically, and the keyboard and
screen-reader scripts a person runs for what automation cannot see. Issue #76
set this up; any change to how a surface is reached, named or announced updates
the matching script here in the same PR.

## The bar

**WCAG 2.1 A and AA**, plus axe-core's best practices (heading order,
landmarks, keyboard-scrollable regions). In particular:

- **Contrast.** Text clears 4.5:1 on every surface it sits on, small labels
  included: the interface's labels are 9–11px, so nothing leans on the 3:1
  large-text allowance. Dimmed text dims to `--color-foreground-muted`, never
  with `opacity`, which is how most of the failures #76 found got there.
  Disabled controls are exempt, as WCAG allows.
- **Keyboard.** Everything a pointer can do has a keyboard path, even when the
  path is different (the arrangement's canvas, below). Focus is always visible
  and never trapped, except inside a modal, where it is meant to be.
- **Names.** Every control has an accessible name that contains its visible
  label (WCAG 2.5.3), and state (pressed, selected, current view) is exposed,
  not only drawn.
- **Announcements.** Changes a producer cannot see from where focus is (the
  arrangement's selection, the loop range, the assistant's replies) are spoken
  through a live region.

- **Zoom and small windows.** The editor lays out down to **960x600** CSS
  pixels, which is a 1920x1200 screen at 200% zoom. Below that it stops
  shrinking and the document scrolls, in both directions, rather than letting
  controls run into each other or the dock cover a view. The editor is a
  two-dimensional instrument panel, the kind of content WCAG 1.4.10 lets
  scroll rather than reflow; the dashboard and dialogs reflow.
- **Reduced motion.** With the system's reduce-motion setting on, nothing
  slides, fades, spins or blinks: one rule in `src/app.css` stops every CSS
  animation and transition, and script that animates asks
  `src/shared/motion.ts` first. The playhead and the meters still move; they
  are the music's position and level, not decoration.

### What is not in the bar, and why

**WCAG 2.2's 24px minimum target size (2.5.8).** The editor is an instrument
panel: mute and solo toggles, the playhead's bar and beat fields and the
faders' value fields are 15–18px, as a hardware desk's buttons are small. Each
has a keyboard path and an accessible name, so the cost of the size falls on
pointer precision alone. Revisiting this is a design decision
([`docs/design.md`](./design.md)), not an implementation detail; the automated
check leaves the rule out rather than waiving it control by control.

## The automated checks

| Check | Where | What it covers |
| --- | --- | --- |
| axe-core over every surface | [`tests/e2e/emulator/accessibility.spec.ts`](../tests/e2e/emulator/accessibility.spec.ts), in the per-push `@sanity` subset | The dashboard (empty, listing a project, the delete confirmation), the editor's five views, a muted track, strip and pad and a bypassed device, the shortcut guide, the assistant floating and docked, and the Export dialog |
| Palette contrast | [`src/theme.test.ts`](../src/theme.test.ts) | Every text alias against the ground, a panel, a well and a raised card |
| Modal focus | [`tests/e2e/emulator/dialogFocus.spec.ts`](../tests/e2e/emulator/dialogFocus.spec.ts) | Tab never leaves the Export dialog, and the editor behind it is `inert` |
| Library focus | [`tests/e2e/emulator/libraryFocus.spec.ts`](../tests/e2e/emulator/libraryFocus.spec.ts) | Where focus goes as the library opens, filters and inserts |
| Zoom, minimum size, reduced motion | [`tests/e2e/emulator/resilientLayout.spec.ts`](../tests/e2e/emulator/resilientLayout.spec.ts) | The editor at 640x360 (200% of 1280x720) keeps its minimum and scrolls, with no header controls overlapping in any view; at 960x600 it fits exactly; with reduced motion nothing transitions |
| The canvas's keyboard twins | [`tests/e2e/emulator/clipList.spec.ts`](../tests/e2e/emulator/clipList.spec.ts), [`tests/e2e/emulator/focusRescue.spec.ts`](../tests/e2e/emulator/focusRescue.spec.ts) | Picking, opening, duplicating and deleting a clip from the keyboard alone; focus kept in the editor when its element goes |
| Component tests | `*.test.tsx` beside each component | Names, roles and pressed/selected state, queried by role the way assistive technology reads them |

axe sees one state of a page. It cannot tell whether a focus order makes
sense, whether an announcement is said at the right moment, or whether a
keyboard path exists for a pointer gesture. Those are the scripts below.

### The arrangement's canvas, and its keyboard twins

The timeline is drawn on a canvas, which assistive technology cannot read and a
keyboard cannot reach. Every action that matters on it has a DOM equivalent:

| On the canvas | From the keyboard |
| --- | --- |
| Click a clip to select it | The "Clips" listbox: Up and Down, selection follows |
| Cmd/Ctrl-click or Shift-click a clip to add it to the selection | Shift+Up and Shift+Down in the "Clips" listbox add the previous or next clip; Cmd/Ctrl+A selects them all |
| Double-click a clip to open it | Enter on the selected clip |
| Drag a clip to copy it | Cmd/Ctrl+D duplicates it after itself, or copy and paste |
| Drag a clip along its track | Cut, set the playhead where it goes (the playhead field in the header), Escape, paste |
| Drag a clip's end to trim or lengthen it | Shift+Left and Shift+Right in the "Clips" listbox move the selected clips' ends a bar, never under one bar; a clip lengthened over the next one overwrites it, as a drop does. (Dragging the end past where the clip ends tiles linked copies; Cmd/Ctrl+D is the keyboard's way to repeat a clip) |
| Drag a clip's start to trim its head | Alt+Shift+Left and Alt+Shift+Right (Option on a Mac) in the "Clips" listbox move the selected clips' starts a bar, trimming or rewinding their content as the drag does |
| Drag a clip onto another track | There is no such gesture on the canvas either, so nothing to twin: a clip belongs to its track (its notes are written for that track's instrument), a drag stays on its row, and `placement.update` refuses to re-parent a placement. Copy and paste, and cut and paste, put a clip back on the track it came from |
| Double-click an empty bar to create a clip | A new track opens with an empty one-bar clip; duplicate or paste it from there |
| Drag the loop brace | The "Loop brace" slider: arrows move it, Shift+arrows resize it |
| Click a track's row | The track header's "Edit *track*" button, or Up and Down on it |

The selection, the loop range and the tracks are mirrored as live regions and
lists, so what the canvas draws is always also said.

## The manual scripts

Run them before a release, and on any PR that changes how a surface is reached
or announced. Use a real screen reader: **VoiceOver** with Safari or Chrome on
macOS, and **NVDA** with Firefox or Chrome on Windows. Unplug the mouse, or
leave it alone: every step is the keyboard. Record a failure as a bug naming
the surface, the step and the screen reader.

Each step says what to press and what must happen. "Hear" means the screen
reader speaks it; "see" means a sighted keyboard user can tell, which for focus
means a visible focus ring.

### Dashboard (`/projects`)

1. Load the page. Hear the page title and the "Projects" heading. The first
   Tab lands on the account and project controls in reading order.
2. Tab to **New Project** and press Enter. The editor opens on the new
   project; hear its name as the page's heading.
3. Go back to `/projects`. Tab through the list: each project is reached once,
   with its name, and its delete button is named "Delete *name*".
4. Press Enter on a delete button. Hear an alert dialog, "Delete this
   project?", with focus on **Cancel**. Tab and Shift+Tab stay in the dialog.
5. Press Escape. The dialog closes and focus is back on the same delete
   button.
6. Tab to **Privacy** (bottom right). Enter opens it; the switch inside is
   named "Share usage and error reports" and says whether it is on.

### Editor

1. Open a project. Hear the project name as the level-1 heading. Tab moves
   through the header: Projects, the project name (rename), Play, Loop, the
   playhead, Tempo, Swing, Metronome, Undo, Redo, Assistant, Export, Keyboard
   shortcuts.
2. Press Space: playback starts, and the Play button's name becomes "Stop
   playback". Space again stops it.
3. Press `1`–`5`. Each opens its view; the dock's current tile is announced as
   the current page ("Mixer, current page"). The view's region is named
   ("Sequence editor", "Mixer", …).
4. **Tracks.** In the arrangement, Tab to a track header. Hear "Edit *track*",
   then Mute *track*, Solo *track* (each a toggle saying pressed or not),
   the volume slider ("Volume for *track*", with its value in dB), and
   Delete *track*. Up and Down, with focus on a header button, select the
   previous and next track.
5. **Clips.** Tab to the "Clips" list, the canvas's keyboard twin; the
   timeline gets a focus ring. Down and Up select the next and previous clip
   in reading order (track by track, left to right), and hear each one
   ("Selected clip on BD, bar 1"); the timeline scrolls to it. Shift+Down and
   Shift+Up add the next or previous clip to the selection instead. Shift+Right
   and Shift+Left lengthen and shorten the selected clips a bar, and
   Alt+Shift+Right and Alt+Shift+Left (Option on a Mac) move their starts;
   hear the new span in the option ("bars 1 to 2"). Enter opens it
   in the sequence view, Cmd/Ctrl+D duplicates it, Cmd/Ctrl+C, X and V copy,
   cut and paste, Delete removes it, Cmd/Ctrl+A selects every clip, and
   Cmd/Ctrl+Z puts any of it back; each change is announced.
6. **Loop.** Tab to the loop brace (a slider named "Loop brace"). Left and
   Right move it a bar, Shift+Left and Shift+Right resize it; hear the new
   range each time ("Loop over bars 1–4, looping on").
7. **Sequence view.** With a clip selected, press Enter or `2`. Tab reaches
   the steps; each is a toggle named for its step and pad and says whether it
   is on.
8. **Instrument view.** Press `3`. Hear the track's name as a heading, then
   the "Instrument" type choice as a radio group. Every fader is a slider with
   a spelled-out name and its value with its unit.
9. **Library view.** Press `4`. Focus stays where it was, so the view keys
   and Enter keep working; Down moves into the results, and each sound is
   announced with its name. Enter inserts it
   and returns to the instrument; `?` lists the library's own keys.
10. **Mixer.** Press `5`. Each strip's fader, pan, mute, solo and sends are
    reachable by Tab, named for their track.
11. **Focus is never stranded.** Focus a fader in the mixer and press `1`: the
    mixer is gone, and focus is on the arrangement (hear it, and see its
    ring), not back at the top of the page. Delete a track from its header's
    Delete button: focus lands on the arrangement again. In any other view,
    the same loss puts focus on the view itself, and the next Tab goes to its
    first control.

### Shortcut guide

1. Press `?` (or the Keyboard shortcuts button). Hear a dialog, "Keyboard
   shortcuts", with focus in **Search shortcuts**.
2. Type "loop". The list narrows; with nothing matching, hear "No shortcuts
   match your search".
3. Tab to the list itself and use the arrow keys or Page Down to scroll it.
   Tab and Shift+Tab stay inside the guide.
4. Press Escape. The guide closes and focus returns to where it was.

### Assistant

1. Press Cmd/Ctrl+K (or the Assistant button). Hear the "Assistant" region;
   focus is in **Message the assistant**.
2. Type a request and press Enter. Replies arrive in the "Conversation" log
   and are spoken as they land.
3. A proposal is a region named "Proposal" with Preview, Apply and Cancel
   buttons; after Apply, hear "Applied".
4. Tab to the resize edge (a separator named "Resize height" or "Resize
   width"). The arrow keys resize the panel.
5. Press Escape. A floating panel minimises; a docked one closes. Focus never
   lands on nothing: it stays in the panel or returns to the Assistant button.

### Export dialog

1. Press the Export button. Hear a dialog, "Export", with focus on its first
   control. The editor behind it cannot be reached by Tab.
2. The format cards are a radio group: the arrow keys choose Song or Stems.
3. In Stems, the track list is a listbox: Up and Down move, Shift extends,
   Cmd/Ctrl toggles a track, and each track says whether it is selected.
4. Start the export. Progress is announced; when it finishes, focus moves to
   **Back** on the finished screen and the files are links named for what
   they download.
5. Press Escape. The dialog closes and focus is back on the Export button.

### Zoom, small windows and motion

1. Set the browser to 200% zoom on a 1280x720 window. The editor keeps its
   layout: the header's controls do not overlap, and the page scrolls to reach
   the rest. Every view key still works and the dock stays on screen.
2. Zoom back to 100% and shrink the window to 960x600. Nothing scrolls and
   nothing overlaps.
3. Turn on the system's reduce-motion setting (macOS: Accessibility, Display,
   Reduce motion; Windows: Settings, Accessibility, Visual effects, Animation
   effects off). Load a project, open the assistant, drag a track: nothing
   slides or fades, and the loading label does not blink.
