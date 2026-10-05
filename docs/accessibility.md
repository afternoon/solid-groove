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
| axe-core over every surface | [`tests/e2e/emulator/accessibility.spec.ts`](../tests/e2e/emulator/accessibility.spec.ts), in the per-push `@sanity` subset | The dashboard (empty, listing a project, the delete confirmation), the editor's five views, the shortcut guide, the assistant floating and docked, and the Export dialog |
| Palette contrast | [`src/theme.test.ts`](../src/theme.test.ts) | Every text alias against the ground, a panel, a well and a raised card |
| Modal focus | [`tests/e2e/emulator/dialogFocus.spec.ts`](../tests/e2e/emulator/dialogFocus.spec.ts) | Tab never leaves the Export dialog, and the editor behind it is `inert` |
| Library focus | [`tests/e2e/emulator/libraryFocus.spec.ts`](../tests/e2e/emulator/libraryFocus.spec.ts) | Where focus goes as the library opens, filters and inserts |
| Component tests | `*.test.tsx` beside each component | Names, roles and pressed/selected state, queried by role the way assistive technology reads them |

axe sees one state of a page. It cannot tell whether a focus order makes
sense, whether an announcement is said at the right moment, or whether a
keyboard path exists for a pointer gesture. Those are the scripts below.

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
5. **Clips.** With focus in the arrangement, press Cmd/Ctrl+A. Hear the
   selection ("Selected 2 clips on BD, bars 1–2"). Cmd/Ctrl+D duplicates it,
   Delete removes it, Cmd/Ctrl+Z puts it back; each change is announced.
6. **Loop.** Tab to the loop brace (a slider named "Loop brace"). Left and
   Right move it a bar, Shift+Left and Shift+Right resize it; hear the new
   range each time ("Loop over bars 1–4, looping on").
7. **Sequence view.** With a clip selected, press Enter or `2`. Tab reaches
   the steps; each is a toggle named for its step and pad and says whether it
   is on.
8. **Instrument view.** Press `3`. Hear the track's name as a heading, then
   the "Instrument" type choice as a radio group. Every fader is a slider with
   a spelled-out name and its value with its unit.
9. **Library view.** Press `4`. Focus lands on the search field. Down moves
   into the results; each sound is announced with its name. Enter inserts it
   and returns to the instrument; `?` lists the library's own keys.
10. **Mixer.** Press `5`. Each strip's fader, pan, mute, solo and sends are
    reachable by Tab, named for their track.

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
