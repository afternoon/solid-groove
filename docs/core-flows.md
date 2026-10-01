# Core flows

A **core flow** is one user journey that must work end to end when a feature is
finished, written in plain English before any code exists. It is the durable QA
record: the thing a reviewer walks through on a preview channel, and the thing an
automated test reproduces on every push.

This file is the register of those flows. Each one has a stable ID (`CF-001`,
`CF-002`, …) that an issue links to, an E2E spec is named after, and a screenshot
walkthrough is captured from. Those three artefacts are traceably one thing
because they all carry the same ID.

## What a core flow is, and is not

A core flow **is** a journey a person takes through the product, from an
entrypoint they could actually arrive at, to an outcome they can see. It is
written so that someone who has never read the code can follow it by hand.

A core flow is **not**:

- a product principle (that is the PRD's job),
- an acceptance criterion (that is the issue's job),
- a unit of implementation (that is the PR's job), or
- an exhaustive test plan. A flow covers the path that must not break, not every
  branch off it. Edge cases, failure states, and empty states are still tested at
  the lowest useful layer, as they always were.

Most features need one or two flows. A feature that seems to need six probably
contains a dependency that should be its own issue.

## Precedence

A registered flow **is** the specification of the behavior it describes. Nothing
else states it: [`docs/prd.md`](./prd.md) holds the product's principles — vision,
target user, goals and non-goals, sample licensing, privacy — and no longer
specifies features, and an issue says what to build for one task rather than what
the product does.

So a flow answers to two things above it. It must not contradict a **product
principle** in the PRD — a flow that requires the product to behave against its
own principles is wrong, and the principle wins. And where a flow and an issue
disagree about the same behavior, the flow wins: it is the frozen contract the
implementation is measured against, and an issue that needs different behavior
needs the flow changed first, deliberately and separately, before the work
starts.

## Who edits this file

**The product owner, and no one else.** Implementing and reviewing agents must
treat this file as read-only:

- An implementer that finds a flow ambiguous, impossible, or contradicted by a
  product principle in the PRD **stops and says so** on the issue. It does not edit the flow to match what
  it built.
- A reviewer treats any diff to `docs/core-flows.md` in an implementation PR as a
  **blocking finding**. Retro-fitting the specification to the implementation is
  the exact failure this rule exists to prevent.

The same applies to `docs/prd.md`, for the same reason and by the same rule.

## Lifecycle of a flow

1. **Written.** The product owner adds the flow here with a fresh ID, and links
   it from the feature's GitHub issue by ID. If the flow depends on work that does
   not exist yet, that dependency is broken out as its own issue first.
2. **Specified.** The first PR in the feature's stack adds
   `tests/e2e/emulator/flows/<ID>.spec.ts`, written from this file, marked
   `test.fixme` because the implementation does not exist. It is reviewed on its
   own — it is the acceptance contract for everything that follows — and it merges
   green, because a `fixme` test does not fail.
3. **Frozen.** From that point the spec is the contract. A later PR in the stack
   may not change its assertions without saying so in the PR body and having the
   reviewer confirm it; see `CLAUDE.md`, "Landing work".
4. **Live.** The PR that closes the issue removes the `test.fixme` in the same
   diff that makes it pass, and captures the screenshot walkthrough from that
   now-passing run.

`bun run verify:core-flows` enforces the 1:1 mapping between the IDs in this file
and the spec files, and reports any flow still parked at step 2 so a stack cannot
quietly land with its flow permanently skipped.

## Which suite a flow belongs in

**`tests/e2e/emulator/flows/`, and nowhere else.** Every core flow runs against
a real (emulated) Firestore and Auth.

There is no choice to make here, and that is deliberate. A journey is not
finished when the screen looks right — it is finished when the producer comes
back tomorrow and their work is still there. So **persistence is part of every
flow's outcome**, and every flow ends by reloading the page and finding what it
made. The in-memory mock backend cannot answer that: it is a fresh, empty store
on every page load, so a reload there proves the opposite of what a flow needs
to claim.

The mock browser E2E suite (`tests/e2e/mock/`) remains, and remains the right
home for a fast, dependency-free browser test of a single surface. It just does
not hold flows. `bun run verify:core-flows` enforces the single location, and
`bun run walkthrough:capture` captures from it.

See [`docs/testing.md`](./testing.md) for what each suite covers and how CI gates
on them.

## Anatomy of a flow

Copy this shape. Keep the steps in the second person and free of selectors, CSS
classes, and function names — if a step cannot be followed by a person with a
browser, it is written at the wrong altitude.

```markdown
### CF-0NN — Short title in the user's language

**Issue:** #NN · **Suite:** `tests/e2e/emulator/flows/CF-0NN.spec.ts` · **Entrypoint:** the public landing page

**Preconditions:** what must already be true. "None" is a good answer.

1. A step you can perform.
2. Another step.
3. The step that produces the outcome.

**Outcome:** what you can now see, hear, or do that you could not before.

**Out of scope:** the neighbouring things this flow deliberately does not prove,
so nobody reads its passing as coverage of them.
```

The **entrypoint** matters: a flow starts where a person would actually arrive —
the public landing page, the project dashboard, or a project page — not at a deep
link with seeded state. That is what makes the captured walkthrough worth looking
at, and it is why a walkthrough is a byproduct of the flow test rather than a
separate errand.

---

## Flows

### CF-001 — A visitor with no account reaches a playing loop

**Issue:** #304 for this revision (the flow itself pre-dates the register and
described shipped `FND-009`/`LOOP-010` behavior) · **Suite:**
`tests/e2e/emulator/flows/CF-001.spec.ts` · **Entrypoint:** the public landing page

**Rewritten for the three-view shell (#304).** The journey is the one it always
was — arrive with no account, edit a pattern, hear it — but the editor it walks
through is being replaced: a project now opens on the arrangement, and the
pattern is edited in the sequence editor opened from the clip. Parked at
`test.fixme` until #304's stack lands, which is the only way a flow can describe
a shell that does not exist yet without reddening `main`. It is the register's
one flow that was live before this, so getting it back to live is part of what
#304 is finished by.

**Revised for #496 (a sampler is a tonal instrument; the drum machine is the
one-shot player).** The starter project is a drum-machine track, its kick on the
"BD" pad, so steps 5-7 read the pattern as a pad lane rather than a sampler's
single lane. The journey is unchanged. Parked at `test.fixme` until #496 lands.

**Preconditions:** none. No account, no existing project.

1. Open the landing page.
2. Choose to start in your browser.
3. You arrive at the dashboard, signed in as a guest, with no projects yet.
4. Create a new project.
5. The project opens on the arrangement, with a four-on-the-floor starter
   pattern sitting on its only track, a drum machine named "BD".
6. Open that clip. The sequence editor comes up over the arrangement, showing
   the pattern on the "BD" pad: steps 1, 5, 9 and 13 on.
7. Turn on a step that was off on the "BD" pad, and close the editor.
8. Start playback.

**Outcome:** a visitor who arrived with no account is listening to a loop they
just edited, and the transport shows it is running.

**Out of scope:** that the loop is *audible*. A headless browser records no audio
and Playwright captures none, so this flow proves the transport starts, not that
a sound reached a speaker. Playback is asserted in Chromium only — see
[`docs/testing.md`](./testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap)
and issue #43. Moving between the three views, which is CF-008's subject: this
flow only ever sees the arrangement. And persistence — it never reloads, and
CF-004 onwards are where coming back to your work is proved.

### CF-002 — A producer turns a loop into a song outline

**Issue:** #61 · **Suite:** `tests/e2e/emulator/flows/CF-002.spec.ts` · **Entrypoint:** the
project dashboard

**Revised for #496 (a sampler is a tonal instrument; the drum machine is the
one-shot player).** The drum parts are drum-machine tracks and are sequenced on
the step grid by pad; the pitched parts (chord stab, bass) are sampler tracks
written in the piano roll, where a note plays the sample at its pitch and C4
plays it as recorded. The loop, the outline and the undos are unchanged.

**Preconditions:** signed in as a guest with no projects — where CF-001 ends.
Building the pitched parts in steps 4-5 depends on #225 (loading a library sound
onto a sampler) and #496 (a sampler's clip opens in the piano roll); until both
land, this flow cannot be walked by hand.

1. Create a new project. It opens on the arrangement with the starter kick, a
   drum machine named "BD", four on the floor.
2. Add a drum-machine track named "Hats", and put the "HH" pad on every offbeat.
3. Add a drum-machine track named "Claps", with the "CP" pad on beats 2 and 4.
4. Add a sampler track named "Chords", load a chord stab onto it from the
   library, and write a C4 in the piano roll on steps 1, 4, 7, 10, 13 and 16.
5. Add a sampler track named "Bass", load a bass note onto it from the library,
   and write a C4 in the piano roll following the kick, on steps 1, 5, 9 and 13.
6. Play the loop — five parts, one bar, tight.
7. Select the loop's bar range in the arrangement.
8. Apply the structure template. The arrangement fills out: named, coloured
   sections along the ruler, each carrying its own copy of all five tracks.
9. Select the hats and the claps in the "Intro" and delete them together, so the
   song opens on the chord stab and the bass.
10. Play from the top — the drums arrive at the section boundary.
11. Undo twice: the drums come back, and then the outline collapses to the loop.

**Outcome:** a five-part loop became a multi-section song that opens quietly and
lands its drums where the producer chose, and two undos put it back to the loop
it started from.

**Out of scope:** that any of it is *audible* — as in CF-001, a headless browser
records no audio, so this proves the transport runs and the arrangement changed,
not that a sound reached a speaker. It also does not prove that the source clips
survive the outline untouched, which is asserted at the command layer; nor
automation across the new sections (`ARR-004`); nor persistence, since this runs
against the mock backend.

Note that steps 1-6 exercise track management, the library browser, the step
editor and the piano roll before the flow reaches its own subject. That is deliberate — a loop-to-song
outline stamped onto a single-track project demonstrates nothing — but it does
mean a break in any of those surfaces will surface here as an `ARR-003` failure.

### CF-003 — A producer names and rearranges the parts of their song

**Issue:** #61 · **Suite:** `tests/e2e/emulator/flows/CF-003.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in as a guest with no projects.

1. Create a new project and duplicate its placement further along the timeline,
   so there are two distinct parts to label.
2. Add a section over the first part and name it "Intro".
3. Add a section over the second part, name it "Drop", and give it a different
   colour.
4. Move "Drop" ahead of "Intro".
5. The two sections swap places on the ruler, and the placements inside each one
   travel with it.
6. Undo once.

**Outcome:** the producer has labelled the parts of their song and reordered one,
its clips moving with it, and a single undo puts the order back.

**Out of scope:** the template-driven path, which is CF-002; section-aware
automation (`ARR-004`); and whether sections survive a reload, which would belong
to a flow in `tests/e2e/emulator/flows/`.

### CF-004 — A producer sets the span they are working in

**Issue:** #280 · **Suite:** `tests/e2e/emulator/flows/CF-004.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. Above the tracks, the ruler carries a loop brace spanning
   the first bar, and looping is on.
2. Start playback. The playhead runs to the end of bar 1 and jumps back to the
   start, over and over.
3. Drag the right-hand edge of the brace out to the end of bar 2.
4. The brace now spans two bars. Playback never stopped, and the playhead now
   turns around at the end of bar 2.
5. Switch looping off. The playhead runs past the end of the brace and keeps
   going; the brace stays where it is.
6. Switch looping back on, stop, and reload the page.
7. The project reopens with the brace still spanning bars 1 and 2, and looping
   still on.

**Outcome:** the producer chose the span they are working inside, changed it
without interrupting playback, and found it exactly as they left it when they
came back.

**Out of scope:** that any of it is *audible* — a headless browser records no
audio, so this proves the playhead and the transport, not that a sound reached a
speaker (see [`docs/testing.md`](./testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap)
and issue #43). It also does not prove that anything else in the product moves
the brace: nothing does, deliberately, and CF-005 is where that is asserted from
the other side.

### CF-005 — A producer brings a library loop into their project

**Issue:** #281 · **Suite:** `tests/e2e/emulator/flows/CF-005.spec.ts` · **Entrypoint:** the
project dashboard

**Retitled and rewritten by #304**, which makes the library a modal opened from a
slot rather than a panel standing open beside the arrangement. The journey is
unchanged — a loop out of the library lands on a new track at bar 1 and nothing
else in the project moves — but the drag this flow used to describe no longer
exists, so the producer asks the arrangement for a loop and picks one instead.

**Preconditions:** signed in with no projects. The library contains a
tempo-labelled loop whose source tempo is not the tempo a new project opens at.

1. Create a new project. It opens on the arrangement, carrying the starter kick
   pattern.
2. Choose to add a loop from the library. The library opens over the arrangement.
3. Find a drum loop that was recorded at a different tempo from the project's,
   and insert it. The library opens on loops near the project's tempo, so widen
   it to any tempo to find one.
4. The library closes. A new track appears at the bottom of the track list,
   carrying that loop as a clip starting at bar 1.
5. Open that clip. It is named as a loop that follows the project tempo rather
   than a pitched one-shot, and it states the tempo it was recorded at. Close it
   again.
6. Nothing else moved: the project tempo is unchanged, the loop brace is where it
   was, and the transport is still stopped.
7. Reload the page. The new track and its loop are still there.

**Outcome:** a producer brought a loop out of the library into their project
without leaving the arrangement, and the project it landed in is otherwise
exactly as they left it.

**Out of scope:** playback of any kind — pressing play belongs to CF-004, and
audibility is not provable here in any case. Loading a one-shot onto a sampler
from its instrument slot, which is the library modal's other entrypoint and is
asserted at the command layer. Choosing which bar the clip lands at, which the
product deliberately does not offer. And whether the stretched loop *sounds*
right, which no browser test can tell you.

### CF-006 — A producer brings their own sounds into a pack

**Issue:** #282 · **Suite:** `tests/e2e/emulator/flows/CF-006.spec.ts` · **Entrypoint:** the
project dashboard

**Rewritten by #308.** This flow used to start on the landing page and log in
through the identity provider. Logging in was never what it set out to prove, and
depending on it made this flow answer for the login control's markup and for
Google's own account chooser — so a change to either reddened a flow about
importing sounds. Being signed in is now a precondition, the way "signed in with
no projects" already is for its neighbours, and the flow starts where the producer
starts. What it proves is unchanged.

**Preconditions:** signed in to a registered account whose personal library is
empty. Importing requires an account: a guest is offered the upgrade path instead,
which is asserted at the component layer rather than walked here.

1. You arrive on the dashboard signed in to your own account, not working as a
   guest.
2. Open a project, so the library browser is on screen.
3. Choose "Add pack". A new pack appears in the browser with its name in an
   input, waiting to be typed.
4. Type a name for the pack and press Return. The pack is now listed, and empty.
5. Drag three audio files from the desktop onto that pack. Each shows its own
   progress, and each lands as a sound in the pack when it finishes.
6. Audition one of them from the browser, and find it by searching the library
   the same way you would find a factory sound.
7. Reload the page. The pack and all three sounds are still there.

**Outcome:** the producer's own audio is in their library, in a pack they named,
sitting alongside the factory content and reachable the same way — which means
the next thing they can do is CF-005 with a sound of their own.

**Out of scope:** logging in — reaching an account through the identity provider
is a journey of its own and belongs to a flow of its own, so this one asserts only
that it begins signed in. Using one of those sounds in a project, which is CF-005
and is not re-proved here. Dropping files on empty space to create a pack called
"My Sounds", the file-picker fallback, renaming, deleting, and every rejection
path (unsupported file, oversized file, the account storage cap, a cancelled
upload) — all required, all covered at the component, repository and rules layers,
none of them the path that must not break.

### CF-007 — A producer drives the whole mix through an overdrive

**Issue:** #283 · **Suite:** `tests/e2e/emulator/flows/CF-007.spec.ts` · **Entrypoint:** the
project dashboard

**Rewritten by #304.** The master chain is reached by selecting the master strip
in the **mixer view**, not by switching a main-region tab — #304 replaces that
tab with the three-view shell — and step 1 brings its loop in through the library
modal, as CF-005 now does. What the flow proves is unchanged.

**Preconditions:** signed in with no projects.

1. Create a new project and bring a library loop into it, so the starter kick and
   a loop are in the project together.
2. Start playback. The two parts repeat over the loop brace.
3. Switch to the mixer.
4. Select the master strip. The master's effects are on screen, with an empty
   chain. Add an overdrive to it.
5. Undo once. The overdrive comes off the master chain.
6. Redo. It is back.
7. While it is still playing, drive the overdrive up. The control follows and
   playback never drops out.
8. Reload the page. The project reopens on the mixer, and the overdrive is still
   on the master chain, still at that drive.

**Outcome:** a producer reached the master, put an effect across everything they
had made, pushed it while it played, and found the whole thing intact — on the
view they left it on — when they came back.

**Out of scope:** that the overdrive *sounds* like anything — a headless browser
records no audio, so this proves the chain, the controls, and the state, not the
processing, which is asserted in the audio suite. Track device chains (#241),
the other five device types, device presets, and reordering a chain, all of which
are tested at their own layers. Moving between the three views, which is CF-008's
subject and is only used here. Two orderings here are deliberate rather than
incidental. The undo and redo come *before* the drive is pushed, because a
parameter gesture is its own history entry: undoing after it would take back the
drive rather than the device, and redoing an add restores the device as its
payload described it. And both come before the reload, because history is
session-local — a reload legitimately ends the undo stack, so a flow that undid
afterwards would assert something the product does not promise.

### CF-008 — A producer works across the arrangement, the instrument and the mixer

**Issue:** #304 · **Suite:** `tests/e2e/emulator/flows/CF-008.spec.ts` · **Entrypoint:** the
project dashboard

**Revised for #496.** The starter track is a drum machine, so steps 2-3 work on
its "BD" pad lane. The track keeps the name "BD", so steps 4-7 are unchanged.
Parked at `test.fixme` until #496 lands.

**Preconditions:** signed in with no projects.

1. Create a new project. It opens on the arrangement, which fills the page, with
   the starter pattern sitting on the only track and a dock floating along the
   bottom naming the three views.
2. Open the clip on the timeline. The sequence editor comes up over the
   arrangement, nearly filling the window, showing the four-on-the-floor pattern
   on the starter drum machine's "BD" pad.
3. Turn on a step that was off on the "BD" pad, then close the editor. The
   arrangement is underneath, exactly as it was apart from the edit.
4. Go to the instrument view with the keyboard. The track's instrument fills the
   page, with a list of the project's tracks down the left edge and the dock
   still showing which view you are on.
5. Go to the mixer with the keyboard, and pull the track's volume fader down.
6. Go back to the arrangement from the dock. The timeline is as you left it, and
   the dock marks the arrangement as the view you are on.
7. Return to the mixer and reload the page. The project reopens on the mixer,
   with the fader still where you put it.

**Outcome:** a producer did three different jobs on three uncluttered screens,
moved between them by dock and by keyboard without losing anything they had done,
and the view they were on survived a reload because it is part of the address.

**Out of scope:** that any of it is *audible*, as in every other flow here. The
library modal, which is CF-005's. Device chains, which the instrument view only
reserves a place for — #241 and #283 own those and have their own flows. Touch
and tablet layouts, which #304 explicitly does not claim. And the sequence
editor's own editing behavior beyond one step toggling, which CLP-02 and CLP-03
already cover at the component layer.

### CF-009 — A producer clicks a clip and is told which one it is

**Issue:** #292 · **Suite:** `tests/e2e/emulator/flows/CF-009.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. The starter clip sits on the "BD" track in bar 1, and
   nothing is selected.
2. Click the clip. It gets a solid outline, and the arrangement announces
   "Selected clip on BD, bar 1".
3. Click the empty space halfway through bar 3 on the same track. The clip's
   outline goes away, a cursor marks the start of the bar you clicked in, and
   the arrangement announces "Position 3.1.1".
4. Drag along the same track from the second sixteenth of bar 3 to its last
   sixteenth. A dotted outline follows the pointer while you drag. It touches
   no clip, so when you let go nothing is selected, and the arrangement
   announces "No selection".
5. Click the clip again, then reload the page.
6. The project reopens with nothing selected. Clicking the clip selects it and
   announces it exactly as before.

**Outcome:** there is one selection in the arrangement. Clicking a clip selects
that clip and names its bars. Clicking empty space sets a point at the start of
the bar you clicked in and names its position. Dragging over empty space selects
the clips the drag touches, and a drag that touches none selects nothing. Each
replaces the last, the band you drag and a selected clip look different, and a
screen reader is told which one happened. The clip is still there after a
reload, and the selection is not, because a selection belongs to the session and
not to the song.

**Out of scope:** what the outlines and the cursor look like. They are canvas
pixels, so this flow shows them in its walkthrough and the renderer's own tests
check them. Selecting several clips, which is CF-010. Zooming, which is CF-011.
Keyboard-only selection from the accessible track list.

### CF-010 — A producer drags across tracks to select clips and deletes them

**Issue:** #292 · **Suite:** `tests/e2e/emulator/flows/CF-010.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project, duplicate the "BD" clip, and drag the copy along to
   bar 3, so "BD" has a clip in bar 1 and another in bar 3 with bar 2 empty
   between them. Add a sampler track and drag the right edge of its clip out to
   the end of bar 2, so "Sampler" repeats its clip: one in bar 1 and a linked
   copy in bar 2.
2. Press in the empty bar 2 on "BD", at 2.3.1, and drag down and along to 4.3.1
   on "Sampler". A dotted outline follows the pointer across both tracks. When
   you let go it goes away, and the clips it touched are selected as whole
   clips: the "BD" clip in bar 3, which it wholly contained, and the "Sampler"
   clip in bar 2, which it overlapped. Each gets a solid outline, and the
   arrangement announces "2 clips selected". The "BD" and "Sampler" clips in
   bar 1 are not selected.
3. Press Delete. Both selected clips are gone, whole: nothing is trimmed. The
   clips in bar 1 on "BD" and "Sampler" are untouched. Clicking in bar 2 on
   "Sampler", where the deleted copy was, finds empty space and announces
   "Position 2.1.1". The same drag as in step 2 now touches no clip, and is
   announced as "No selection".
4. Reload the page.
5. The project reopens exactly as step 3 left it: both tracks are still there,
   and "BD" and "Sampler" each have only their clip in bar 1.

**Outcome:** a drag across more than one track selected every clip it contained
or overlapped, as whole clips. Delete removed exactly those clips, whole, and
nothing else: a clip the drag only partly covered went entirely rather than
being trimmed. The change was still there after a reload.

**Out of scope:** cut, copy, paste, duplicate and drag on a selection, which are
tested at the component layer against the same selection. Undo. What the
outlines look like, as in CF-009.

### CF-011 — A producer zooms in on what they selected

**Issue:** #292 · **Suite:** `tests/e2e/emulator/flows/CF-011.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project, add a sampler track, and duplicate the sampler's clip
   twice, so "Sampler" has clips in bars 1, 2 and 3 and "BD" has its one clip in
   bar 1.
2. Press halfway through the empty bar 2 on "BD" and drag down and along to
   halfway through bar 4 on "Sampler". The sampler's clips in bars 2 and 3,
   which the drag overlaps and wholly contains, are selected as whole clips, and
   the arrangement announces "2 clips selected".
3. Zoom to selection from the zoom control over the arrangement. The timeline now shows exactly the
   selected clips and nothing else: the start of bar 2 at its left edge and the
   end of bar 3 at its right edge. The half bars you dragged over either side
   of them are not framed.
4. Click the sampler's clip in bar 3 and press Z. Bar 3 alone now fills the
   timeline, edge to edge.
5. Reload the page.
6. The project reopens with nothing selected, so zoom to selection has nothing
   to act on until you select something again.

**Outcome:** zoom to selection frames exactly the selected clips, from the first
one's start to the last one's end, however far the drag that selected them
reached past them, and a single clicked clip, where it used to do nothing. It
works from the zoom control and from the keyboard.

**Out of scope:** "zoom back" to the previous zoom, which is its own shortcut. A
selection wider than the timeline can show at its closest zoom. What the
outlines look like, as in CF-009.

### CF-012 — A producer builds an effects chain on one track

**Issue:** #241 · **Suite:** `tests/e2e/emulator/flows/CF-012.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project and bring a library loop into it, so the starter kick and
   the loop sit on two tracks.
2. Switch to the mixer and select the loop's track. Go to the instrument view. It
   shows the loop's track, and its device chain is empty.
3. Add a filter to the chain. It appears with its own controls — cutoff and the
   rest of its settings — not a list of presets.
4. Add a delay. It appears after the filter, and the chain reads filter, then
   delay.
5. Undo once. The delay comes off; the filter stays. Redo. The delay is back,
   after the filter.
6. Start playback. While it plays, sweep the filter's cutoff down. The control
   follows, and playback never drops out.
7. Undo once. The cutoff returns to where it was before the sweep, in one step.
8. Select the kick's track in the mixer and return to the instrument view. Its
   device chain is empty — the filter and delay belong to the loop's track only.
9. Reload the page. Select the loop's track again. The filter and the delay are
   still on it, in that order, with the filter's settings as you left them.

**Outcome:** a producer put two effects on one sound, shaped one of them while it
played, took back a mistake in a single step, and found the chain — on the right
track, in the right order — when they came back.

**Out of scope:** that the effects are *audible*: a headless browser records no
audio, so this proves the chain, the controls, and the state; the processing is
asserted in the audio suite. The master chain, which is CF-007's (#283). The other
four device types, which share the same controls and are covered at the component
layer. The sixteen-insert limit, which is a unit-layer bound, not a journey.
Ordering is deliberate here, as in CF-007: undo/redo come before the reload
because history is session-local.

### CF-013 — A producer rearranges a track's chain while it plays

**Issue:** #241 · **Suite:** `tests/e2e/emulator/flows/CF-013.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. Go to the instrument view for the starter track, and add
   an overdrive and then a reverb to its chain.
2. Start playback.
3. While it plays, move the reverb before the overdrive. The chain now reads
   reverb, then overdrive, and playback never drops out.
4. Bypass the overdrive. It stays in its place in the chain, marked as bypassed,
   with its settings unchanged.
5. Duplicate the reverb. A second reverb appears directly after the first, with
   the same settings.
6. Turn the second reverb's size up, then reset it. Its controls return to their
   defaults; the first reverb is untouched.
7. Remove the second reverb. The chain reads reverb, then the bypassed overdrive.
8. Undo once. The removed reverb returns in the same place.
9. Stop playback and reload the page. The chain reads reverb, reverb, overdrive,
   with the overdrive still bypassed and the second reverb still at its defaults.

**Outcome:** a producer reshaped an effects chain without stopping the music —
reordered it, switched one effect out of the signal without losing it, copied,
reset and removed — and everything they kept was there when they came back.

**Out of scope:** that reordering is *click-free* in the audio sense, which a
headless browser cannot hear; the flow proves playback keeps running, and the
node reuse that makes it click-free is asserted against `DeviceChain` in the audio
suite. Return-bus chains and sends. Analytics (`device_added`,
`feature_first_use`), which are asserted once-per-action at the unit layer, not
through a journey.

### CF-014 — A producer drags their tracks into order

**Issue:** #331 · **Suite:** `tests/e2e/emulator/flows/CF-014.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. It opens on the arrangement with the starter track, BD.
   Add a synth track and then a sampler track. The track list reads BD, Synth,
   Sampler, top to bottom.
2. Start playback.
3. While it plays, drag the Sampler track's header up over BD. Before you let go,
   a marker shows the track will land at the top. Let go: the list reads Sampler,
   BD, Synth, and playback never stops.
4. Drag BD's header off the track list and let go over the view dock. Nothing
   moves: the list still reads Sampler, BD, Synth.
5. Undo once. The list reads BD, Synth, Sampler — the whole drag comes back in
   one step. Redo, and it reads Sampler, BD, Synth again.
6. Go to the mixer. The strips read Sampler, BD, Synth, left to right. Drag the
   Synth strip to the far left. Before you let go, a marker shows where it will
   land. Let go: the strips read Synth, Sampler, BD, and playback is still
   running.
7. Using only the keyboard, move BD one place to the left. The strips read Synth,
   BD, Sampler.
8. Go to the instrument view. The track list down its left edge reads Synth, BD,
   Sampler.
9. Stop playback and reload the page. The instrument view's track list still
   reads Synth, BD, Sampler, and so does the arrangement's.

**Outcome:** a producer put their tracks in the order they think in with one drag
each, in whichever view they were looking at, without stopping the music; a drag
they abandoned changed nothing, the keyboard can do the same job, and every view
agreed on the order when they came back.

**Out of scope:** that the reorder is *inaudible*, which a headless browser cannot
hear: the flow proves playback keeps running, and that `ProjectAudioGraph` reuses
every node on a reorder is asserted in the audio suite. That a track's clips,
instrument, devices and mixer settings travel with it, which `track.reorder`'s
command tests hold. Analytics, asserted once-per-action at the unit layer.
Reordering returns or the master, multi-select drags, and touch drags.

### CF-015 — A producer picks out several clips with the keyboard held down

**Issue:** #405 · **Suite:** `tests/e2e/emulator/flows/CF-015.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project, duplicate the "BD" clip twice, add a sampler track, and
   duplicate its clip twice, so "BD" and "Sampler" each have clips in bars 1, 2
   and 3.
2. Click the "BD" clip in bar 1. It alone is selected, and the arrangement
   announces "Selected clip on BD, bar 1".
3. Hold Cmd (Ctrl on Windows and Linux) and click the "BD" clip in bar 3. It
   joins the selection without replacing it, and the arrangement announces
   "2 clips selected". The "BD" clip in bar 2, between them, is not selected.
4. Hold Cmd and click the "BD" clip in bar 1 again. It leaves the selection, and
   the arrangement announces "Selected clip on BD, bar 3".
5. Hold Shift and click the "Sampler" clip in bar 2. The selection grows to every
   clip in the box from what was selected to the clip you clicked, across both
   tracks: the clips in bars 2 and 3 on "BD" and on "Sampler". The arrangement
   announces "4 clips selected". The clips in bar 1 on both tracks are not
   selected.
6. Press Delete. The four selected clips are gone, whole, and the clips in bar 1
   on both tracks are untouched.
7. Reload the page.
8. The project reopens exactly as step 6 left it: "BD" and "Sampler" each have
   only their clip in bar 1, and nothing is selected.

**Outcome:** holding Cmd while clicking a clip adds it to the selection or takes
it out, one clip at a time, without losing the rest. Holding Shift while clicking
a clip extends the selection to every clip in the box between the selection and
the clicked clip, on every track in between. What a producer builds this way is
one selection, which acts like any other: Delete removed exactly those clips, and
the change was still there after a reload.

**Out of scope:** Shift-click or Cmd-click on empty space, and Shift-drag or
Cmd-drag, which this flow does not define. Shift-click with nothing selected.
Cut, copy, paste, duplicate, drag and zoom on a selection built this way, which
act on the same selection as CF-010 and CF-011 and are tested at the component
layer. What the outlines look like, as in CF-009.

### CF-016 — A producer Alt-drags clips to copy them

**Issue:** #456 · **Suite:** `tests/e2e/emulator/flows/CF-016.spec.ts` · **Entrypoint:** the
project dashboard

**Revised for #496.** The "BD" clip is a drum-machine clip, so steps 5-8 read
and edit the "BD" pad's lane. Alt-drag itself is unchanged and already live;
parked at `test.fixme` only until #496's starter lands.

**Preconditions:** signed in with no projects.

1. Create a new project and add a sampler track, so "BD" (the starter drum
   machine) and "Sampler" each have one clip, in bar 1.
2. Press in the empty bar 2 on "BD" and drag down and back to the middle of bar 1
   on "Sampler". Both clips in bar 1 are selected, and the arrangement announces
   "2 clips selected".
3. Hold Alt (Option on macOS), press on the "BD" clip in bar 1, drag it along to
   bar 3, and let go. Copies of both selected clips land in bar 3, one on each
   track. The clips in bar 1 have not moved, and bar 2 is still empty on both
   tracks. The copies are now the selection, and the arrangement announces
   "2 clips selected".
4. Hold Alt again, press on the "BD" clip in bar 3, and drag it along to bar 5.
   Copies of both clips from bar 3 land in bar 5, one on each track, so the copies
   made in step 3 were what was selected.
5. Open the "BD" clip in bar 5. Turn on a step that was off on the "BD" pad, and
   close the editor.
6. Open the "BD" clip in bar 1. The step you turned on in bar 5 is still off on
   the "BD" pad here. Close the editor.
7. Reload the page.
8. The project reopens exactly as step 6 left it: "BD" and "Sampler" each have
   clips in bars 1, 3 and 5, with bars 2 and 4 empty, and the step you turned on
   is on only in the "BD" clip in bar 5.

**Outcome:** holding Alt while dragging a selected clip copied every selected clip
instead of moving it, keeping their spacing and their tracks, and left the
originals where they were. The copies became the selection, so a second Alt-drag
copied them again. Each copy is independent: editing it did not change the clip it
came from. All of it was still there after a reload.

**Out of scope:** letting go of Alt, or pressing it, partway through a drag, which
decides move or copy at the drop and is tested at the component layer, as are
Escape mid-drag and undoing an Alt-drag as one step. A copy landing on another
clip, which overwrites it exactly as a plain drag does (#290). Alt-drag on a clip
edge, which resizes as a plain edge drag does. Touch input. What the dragged
copies look like while they move, as in CF-009.

### CF-017 — A producer writes a bassline in the piano roll

**Issue:** #450 · **Suite:** `tests/e2e/emulator/flows/CF-017.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project and add a synth track. Its clip sits in bar 1. Open it. The
   sequence editor shows the piano roll: 16 steps, rows named down the left with
   white rows for white keys and black rows for black keys, and the key reads
   "Chromatic".
2. Click the empty cell at C2, step 1. A one-step note appears there, selected.
   Click C2 step 5, D♯2 step 9 and G2 step 13. The clip has four notes.
3. Drag the right edge of the note at C2 step 1 one step to the right. It is now two
   steps long. Click the empty cell at F2 step 15. The new note is also two steps
   long.
4. Drag the note at D♯2 step 9 up two rows and right one step. It lands at F2
   step 10.
5. Press in the empty cell at C2 step 6 and drag left to step 1. The two C2 notes
   are selected, and the roll reads "2 selected".
6. Hold Alt (Option on macOS), press on the note at C2 step 1, drag it right by
   eight steps and let go. Copies land at C2 steps 9 and 13. The originals have not
   moved.
7. Double-click the note at G2 step 13. It is deleted.
8. Close the editor and reload the page. Open the clip again.

**Outcome:** the clip holds six notes: C2 at steps 1 (two steps long), 5, 9 (two
steps long) and 13, F2 at step 10, and F2 at step 15 (two steps long). Clicking,
dragging, resizing, lassoing, Alt-copying and double-click deleting all went through
the command layer, and the result survived a reload.

**Out of scope:** keyboard nudges and shortcuts (CF-019), the velocity lane, zoom,
auto-scroll, audition and Shift/Cmd-click toggling, which are tested at the
component layer. Touch input.

### CF-018 — A producer picks a key and pulls stray notes into it

**Issue:** #450 · **Suite:** `tests/e2e/emulator/flows/CF-018.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project, add a synth track and open its clip. The key reads
   "Chromatic", the root buttons are disabled, and Quantize to scale is disabled.
2. Add notes at C2 step 1, F♯2 step 5 and D♯2 step 9.
3. Choose Minor from the scale switch. The root buttons are enabled with C chosen,
   and the key reads "C minor". The roll shows only C minor rows, plus an F♯2 row
   marked Off, which holds the F♯2 note. No C♯2 or E2 row is shown.
4. Press Quantize to scale. The F♯2 note moves onto a C minor row, and the Off row
   disappears. The C2 and D♯2 notes have not changed.
5. Undo. The F♯2 note and its Off row are back. Redo. They are gone again.
6. Close the editor and reload the page. Open the clip again.

**Outcome:** the key reads "C minor" and the roll shows only C minor rows, so the key
was saved with the project. The clip holds three notes, all in C minor.

**Out of scope:** which scale note Quantize to scale picks (the rule is the
implementer's, tested at the unit layer). Every scale other than Minor. Changing the
root with notes out of key. Key changes from anywhere other than the piano roll.

### CF-019 — A producer copies, pastes and transforms notes from the keyboard

**Issue:** #450, #647, #650 · **Suite:** `tests/e2e/emulator/flows/CF-019.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project, add a synth track and open its clip. Add notes at C2 step 1
   and G2 step 3.
2. Press ⌘A (Ctrl+A on Windows and Linux). The roll reads "2 selected". Press ⌘C.
   Click the ruler at step 9, then press ⌘V. Copies land at C2 step 9 and G2
   step 11, and the copies are now the selection.
3. Press ↑. The copies move up one row, to C♯2 step 9 and G♯2 step 11. Undo. They
   are back at C2 and G2.
4. Press Delete. The copies are gone and two notes remain.
5. Nothing is selected now. The Transform panel reads "All 2 notes". The
   Transpose field reads "+12 st". Press Transpose. The notes are now at C3 step 1
   and G3 step 3.
6. Press Double. The one-bar clip becomes two bars long, and copies land at C3
   step 17 and G3 step 19.
7. Press Esc. The editor closes, as every dialog does on Esc (#650). Reload the
   page and open the clip again.

**Outcome:** the clip is two bars long and holds C3 at steps 1 and 17 and G3 at
steps 3 and 19. Keyboard copy and paste landed at the insert marker, arrow keys
and Delete acted on the selection, a transform with nothing selected acted on the
whole clip, and Double made room for its copies (#647).

**Out of scope:** ⌘D, cut, Shift+arrow resizing and octave moves, Quantize,
Velocity, Vary, Clear clip, and editing the value fields, which are tested at the
component layer. Double's stretching of the clip's arrangement placements, and its
refusal at the longest clip length, are tested at the command layer.

<!--
  New flows go here, in ascending ID order. Never renumber or reuse an ID: a
  retired flow keeps its number and gains a "**Retired:** why" line, because
  closed issues, merged PRs, and old walkthroughs still reference it.
-->

### CF-020 — A producer fills a drum row from the Generate panel

**Issue:** #643 · **Suite:** `tests/e2e/emulator/flows/CF-020.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. Go to the instrument view for the starter "BD" track and
   add a pad. It is called "Pad 2".
2. Go to the arrangement and open the "BD" clip. The step grid shows a "BD" row
   with steps 1, 5, 9 and 13 on, and an empty "Pad 2" row.
3. Click the "Pad 2" row's name. It becomes the selected row, and the Generate
   panel reads "into Pad 2".
4. Press Offbeats. The "Pad 2" row has steps 3, 7, 11 and 15 on. The "BD" row has
   not changed.
5. Set the Euclidean generator to 3 hits over 8 steps and press Write. The "Pad 2"
   row now has steps 1, 4, 7, 9, 12 and 15 on, and nothing else. The offbeats are
   gone. The "BD" row has not changed.
6. Undo once. The "Pad 2" row is back to the offbeats. Redo. It is back to the
   Euclidean pattern.
7. Close the editor and go to the instrument view. "Pad 2" is the selected pad.
8. Reload the page. Go to the arrangement and open the "BD" clip again.

**Outcome:** the "BD" row has steps 1, 5, 9 and 13 on, and the "Pad 2" row has
steps 1, 4, 7, 9, 12 and 15 on. A producer picked a row by its name and filled it
from a preset and from the Euclidean generator. Each generate replaced only that
row, as one undo step, and the result survived a reload.

**Out of scope:** the Random generator, whose output is random, and Clear row,
which are tested at the component layer. The hover preview. Generated
velocities and the velocity lane. The piano-roll toolbar's Zoom, Select all and
Delete, which CF-017 and CF-019 cover in the piano roll. The other presets.

### CF-021 — A producer exports their song as a stereo WAV

**Issue:** #64, #65 · **Suite:** `tests/e2e/emulator/flows/CF-021.spec.ts` · **Entrypoint:**
the project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. It opens with the starter drum machine, its "BD" pad four on
   the floor. Add a drum-machine track named "Drums", and on it put the "HH" pad on
   every offbeat and the "CP" pad on beats 2 and 4.
2. Add a synth track named "Bass" and write a bassline in the piano roll: C2 on steps
   1 and 9, D♯2 on step 5, G2 on step 13.
3. Add a loop from the library: a drum loop recorded at a different tempo from the
   project's. It lands on a new track as a clip starting at bar 1.
4. Add a sampler track named "Piano" and load the "Tine Electric Key" one-shot from the
   library. In the piano roll write a C minor chord on step 1 (C3, D♯3 and G3 at once) and a single A♯3
   on step 9, so the sample plays at four pitches and three at a time.
5. Add a reverb to the Piano track's effects.
6. Switch to the mixer and select the master strip. Add a saturator, then a compressor,
   to the master's effects.
7. There are now five tracks, each with a clip in bar 1. Play the song, then stop.
8. Press Export in the editor header. A dialog opens with two choices, Stereo WAV and
   Stems (ZIP). Stereo WAV is chosen.
9. Press Export. A progress bar with a Cancel button shows while it renders. When it
   finishes, the browser downloads one file named `<project name> <YYYY-MM-DD>.wav`, and
   the dialog says the export is done.
10. Close the dialog and reload the page.

**Outcome:** the file is a valid stereo WAV (two channels, 24-bit PCM, the project's
sample rate), and it is not silent. It runs from bar 1 to the end of the last clip at
the song tempo, plus no more than the release tail. Its level is the project's own:
nothing was normalized (DEC-004). After the reload the project is unchanged — five
tracks, same clips and notes, the reverb on Piano and the saturator and compressor on
the master — so exporting did not edit it.

**Out of scope:** cancelling, failure paths and analytics (unit and component layers).
Exact tail length, sample-accurate timing and live/offline parity (reference renders,
#64). The 40-track ten-minute fixture and memory limits. Stems (CF-022).

### CF-022 — A producer exports aligned stems for another DAW

**Issue:** #66 · **Suite:** `tests/e2e/emulator/flows/CF-022.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project. It opens with the starter drum machine, its "BD" pad four on
   the floor. Add a drum-machine track named "Drums", and on it put the "HH" pad on
   every offbeat and the "CP" pad on beats 2 and 4.
2. Add a synth track named "Bass" and write a bassline in the piano roll: C2 on steps
   1 and 9, D♯2 on step 5, G2 on step 13.
3. Add a loop from the library: a drum loop recorded at a different tempo from the
   project's. It lands on a new track as a clip starting at bar 1.
4. Add a sampler track named "Piano" and load the "Tine Electric Key" one-shot from the
   library. In the piano roll write a C minor chord on step 1 (C3, D♯3 and G3 at once) and a single A♯3
   on step 9, so the sample plays at four pitches and three at a time.
5. Add a reverb to the Piano track's effects.
6. Switch to the mixer and select the master strip. Add a saturator, then a compressor,
   to the master's effects.
7. There are now five tracks, each with a clip in bar 1. Play the song, then stop.
8. Press Export in the editor header and choose Stems (ZIP). No bit-depth choice
   appears: stems are always 24-bit.
9. Press Export and let it finish. The browser downloads one file named
   `<project name> <YYYY-MM-DD> stems.zip`.
10. Close the dialog and reload the page.

**Outcome:** the ZIP holds five WAVs, one per track, named with its position and track
name (`01 BD.wav`, `02 Drums.wav`, `03 Bass.wav`, `04 <loop track>.wav`, `05 Piano.wav`)
so they sort in track order, each with sound in it, plus `Reference mix.wav`, and nothing else. Every
WAV is stereo, 24-bit PCM, at the same sample rate, and exactly the same length. After
the reload the project is unchanged, devices included.

**Out of scope:** mute/solo (every track is exported whatever its
mute/solo state), return-bus stems (these go in a `Returns/` folder, but no UI adds a
return yet), sample-by-sample alignment, master processing
being excluded, cancelling, the maximum reference fixture, worker/memory limits,
failure paths and analytics — all tested at the unit and component layers.
Stereo export (CF-021).

### CF-023 — A producer finds a kick by ear and puts it on a pad

**Issue:** #449 · **Suite:** `tests/e2e/emulator/flows/CF-023.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects. The library holds kicks tagged
with genres.

1. Create a new project. It opens on the arrangement, with the starter kick on a
   drum machine's "BD" pad.
2. Go to the instrument view and press the "BD" pad's sample slot. The library
   opens over the editor, no larger than the pack browser used to be. It names
   the slot it will fill, shows the sound the pad has now, and is already
   showing kicks.
3. Choose a genre from the genre menu. The list narrows to kicks in that genre,
   and says how many there are.
4. Click a kick. It is selected, and the library says it is the one you are
   hearing.
5. Press the down arrow. The next kick is selected and is the one you are
   hearing now.
6. Press Escape. The library closes, and the pad's sample slot still names the
   sound it had before. Nothing in the project changed while you listened.
7. Open the slot again, select a different kick, and press Insert. The library
   closes, and the slot names the kick you chose.
8. Reload the page. The "BD" pad still holds the kick you inserted.

**Outcome:** a producer heard several kicks in place, walked away from them
without a trace, then chose one with a single button, and it is still there
when they come back.

**Out of scope:** that the auditions are *audible*, or heard through the pad in
the beat. No headless browser records audio, so hot-swap audio is asserted in
the audio suite. Loops, which are CF-005's. The similar-sounds view (CF-025) and
packs (CF-024). Shuffle, and the arrow buttons on the category row, are covered
at the component layer.

### CF-024 — A producer browses packs and uses a sound from one they did not have

**Issue:** #449 · **Suite:** `tests/e2e/emulator/flows/CF-024.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects.

1. Create a new project and go to the instrument view. Open the sample slot of
   the drum machine's "BD" pad.
2. Choose Browse packs. The sound list gives way to pack covers, and the packs
   this project already uses are marked as in the project.
3. Narrow the packs to those with FX.
4. Open Transitions & FX, a pack the project does not use. Its sounds replace
   the covers, under a banner that names the pack and says it joins the project
   when you insert one of its sounds.
5. Choose the FX family, then the Impact category. Only that pack's impacts are
   listed.
6. Select an impact and press Insert. The library closes, and the "BD" pad's
   slot names that impact.
7. Open the slot again. Transitions & FX is now listed with the project's own
   packs.
8. Reload the page. The "BD" pad still holds the impact, and Transitions & FX is
   still listed with the project's packs.

**Outcome:** a producer found a new pack, looked inside it, and used one of its
sounds. Taking the sound brought the pack into the project, with no separate
step to add it.

**Out of scope:** "Hear it" on a pack cover, which is audio. The pack search
text, and the scrolling of a long category row, which are component-layer.
Removing a pack from a project, which this issue does not offer. Third-party and
personal packs, whose cover and banner are the same parts.

### CF-025 — A producer follows similar sounds to a better kick

**Issue:** #449 · **Suite:** `tests/e2e/emulator/flows/CF-025.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects. The library holds several kicks
whose tags overlap.

1. Create a new project, go to the instrument view and open the "BD" pad's
   sample slot. The library shows kicks.
2. Press the similar-sounds button on a kick. The list gives way to that kick's
   closest matches. Each shows how close it is, and the kick you started from
   is named above them.
3. Turn off matching on genre. The matches update.
4. Press the similar-sounds button on one of the matches. Its own matches
   replace the list, and a trail shows both kicks, in the order you visited
   them.
5. Choose the first kick in the trail. Its matches come back.
6. Go back. The list of kicks you started from returns.
7. Open similar sounds again from any kick, select one of its matches and
   press Insert. The library closes, and the slot names that match.
8. Reload the page. The pad still holds it.

**Outcome:** a producer went from "like this, but…" to a sound they chose,
and could retrace every step of the way.

**Out of scope:** how the closeness is computed, which is unit-tested against
the similarity model. Whether the matches *sound* alike, which no browser test
can tell. Matches drawn from other packs, which the similarity model's unit
tests cover.

### CF-026 — A producer keeps a sound as a favourite and finds it in another project

**Issue:** #449 (favourites slice), after #691 · **Suite:**
`tests/e2e/emulator/flows/CF-026.spec.ts` · **Entrypoint:** the project dashboard

**Preconditions:** signed in with no projects and no favourites. Depends on
#691: until per-user favourites exist, this flow cannot be walked.

1. Create a new project, go to the instrument view and open the "BD" pad's
   sample slot.
2. Mark a kick as a favourite. Its heart fills, and Favourites counts one.
3. Close the library without inserting anything.
4. Go back to the dashboard and create a second project. Open its "BD" pad's
   sample slot and choose Favourites. The kick you marked is listed.
5. Insert it. The slot names that kick.
6. Reload the page. Open the slot again and choose Favourites. The kick is still
   there, still marked.

**Outcome:** a sound a producer liked once stays with them, across projects and
reloads, one click away from any slot.

**Out of scope:** favourites following the account to another device or
browser, and a guest's favourites carrying over when they register. Both are
#691's and are asserted in the emulator rules and repository suites.
Unfavouriting, which is component-layer.

### CF-027 — A producer asks the assistant for a change, tries it, and keeps it

**Issue:** #72 · **Suite:** `tests/e2e/emulator/flows/CF-027.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects. The assistant is answered by the
suite's scripted provider (#69). Asked to loosen the beat, it replies with a
proposal of two changes: swing up to 58%, and the BD track 3 dB quieter. Once
the assistant disclosure exists (#95), this account has already seen it.

1. Create a new project. It opens on the arrangement.
2. Press the Assistant button in the header. The assistant opens floating over
   the bottom-right corner of the editor, ready to type into. It says its scope
   is the selected track, BD.
3. Type "Loosen the beat" and press Enter. Your message appears in the
   conversation, marked with its scope, and the assistant's reply follows it.
4. The reply ends with a proposal that lists both changes, each from its
   current value to the new one. Nothing in the song has changed yet: swing
   reads what it did before.
5. Press Preview. The editor goes to the mixer, where the change can be seen.
   BD's volume fader sits at the proposed level, and swing reads 58%.
6. Press Cancel. The editor goes back to the arrangement. Swing reads what it
   did before, and BD's volume is where it was. There is nothing to undo.
7. Press Preview again, then Apply. The proposal says it was applied. Swing
   reads 58%, and BD's volume is at the proposed level.
8. Undo once. Both changes are gone. Redo once. Both are back.
9. Reload the page. Swing still reads 58%, and BD's volume is still at the
   proposed level.

**Outcome:** a producer asked for a change in words, tried it before anything
was saved, walked away from it without a trace, then kept it as one step they
can undo, and it is still there when they come back.

**Out of scope:** what the assistant says, and whether a real model proposes
anything useful, which `AI-005` evaluates. Stopping a reply, a provider failure,
a proposal that goes out of date under an edit, and "Why this works", which are
tested at the component and emulator layers. The outlines that mark previewed
and changed controls, which are component-layer. That a preview is audible. No
headless browser records audio. Pack and video recommendations, which are other
issues.

### CF-028 — The assistant stays where a producer puts it

**Issue:** #849 · **Suite:** `tests/e2e/emulator/flows/CF-028.spec.ts` · **Entrypoint:** the
project dashboard

**Preconditions:** signed in with no projects, in a browser that has never
opened the assistant.

1. Create a new project. It opens on the arrangement.
2. Press Ctrl+K (⌘K on a Mac). The assistant opens floating over the
   bottom-right corner of the editor.
3. Drag its top edge up. It grows taller and stays at the bottom of the window.
4. Press Minimise. It shrinks to a bar at the bottom-right that still names the
   assistant. Click the bar. It floats again, at the height you set.
5. Press Dock. It becomes a column down the right edge, and the arrangement
   narrows so that nothing is under it.
6. Drag its left edge to the left. The column widens, and the arrangement
   narrows with it.
7. Press Close. The column goes, and the arrangement fills the window again.
   Press Ctrl+K. The assistant comes back docked, at the width you set.
8. Reload the page. The assistant is docked at the same width, as you left it.
   Press Float. It floats at the height you set in step 3.

**Outcome:** a producer arranged the assistant to suit the way they work, and
it stays that way across a reload on this device.

**Out of scope:** the panel following the producer to another browser or
device, which it deliberately does not. Resizing from the keyboard, the
double-click that resets a size, and the smallest and largest sizes, which are
component-layer. That Ctrl+K does not clash with another shortcut, which the
shortcut registry's own tests assert. The conversation itself (CF-027).
