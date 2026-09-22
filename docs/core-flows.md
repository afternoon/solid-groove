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

**Preconditions:** none. No account, no existing project.

1. Open the landing page.
2. Choose to start in your browser.
3. You arrive at the dashboard, signed in as a guest, with no projects yet.
4. Create a new project.
5. The project opens on the arrangement, with a four-on-the-floor starter
   pattern sitting on its only track.
6. Open that clip. The sequence editor comes up over the arrangement, showing
   the pattern.
7. Turn on a step that was off, and close the editor.
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

**Preconditions:** signed in as a guest with no projects — where CF-001 ends.
Building the loop in steps 2-5 depends on #223 (creating a sampler track) and
#225 (loading a library sound onto a sampler); until both land, this flow cannot
be walked by hand.

1. Create a new project. It opens on the step editor with the starter kick,
   four on the floor.
2. Add a sampler track named "Hats", load a closed hat onto it from the library,
   and put the hat on every offbeat.
3. Add a sampler track named "Claps", with a clap on beats 2 and 4.
4. Add a sampler track named "Chords", with a chord stab on steps 1, 4, 7, 10,
   13 and 16.
5. Add a sampler track named "Bass", following the kick.
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

Note that steps 1-6 exercise track management, the library browser, and the step
editor before the flow reaches its own subject. That is deliberate — a loop-to-song
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
   and insert it.
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
public landing page

**Preconditions:** a registered account whose personal library is empty. Importing
requires an account: a guest is offered the upgrade path instead, which is
asserted at the component layer rather than walked here.

1. Open the landing page and sign in.
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

**Out of scope:** using one of those sounds in a project, which is CF-005 and is
not re-proved here. Dropping files on empty space to create a pack called "My
Sounds", the file-picker fallback, renaming, deleting, and every rejection path
(unsupported file, oversized file, the account storage cap, a cancelled upload) —
all required, all covered at the component, repository and rules layers, none of
them the path that must not break.

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

**Preconditions:** signed in with no projects.

1. Create a new project. It opens on the arrangement, which fills the page, with
   the starter pattern sitting on the only track and a dock floating along the
   bottom naming the three views.
2. Open the clip on the timeline. The sequence editor comes up over the
   arrangement, nearly filling the window, showing the four-on-the-floor pattern.
3. Turn on a step that was off, then close the editor. The arrangement is
   underneath, exactly as it was apart from the edit.
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

<!--
  New flows go here, in ascending ID order. Never renumber or reuse an ID: a
  retired flow keeps its number and gains a "**Retired:** why" line, because
  closed issues, merged PRs, and old walkthroughs still reference it.
-->
