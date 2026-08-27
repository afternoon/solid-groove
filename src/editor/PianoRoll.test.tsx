import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import {
  createRecordingTransport,
  type RecordingTransport,
} from "../analytics/transport";
import type { Clip, NoteEvent } from "../domain/entities";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import { TICKS_PER_BAR, TICKS_PER_SIXTEENTH } from "../domain/time";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { createManualClock } from "../shared/clock";
import { clickAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import { EditorSession } from "./EditorSession";
import PianoRoll, { type PianoRollActions, type PianoRollProps } from "./PianoRoll";

afterEach(() => cleanup());

// jsdom does not implement `PointerEvent`, so `fireEvent.pointerDown` falls back
// to a bare `Event` that drops `clientX`/`button`/`shiftKey`. A `MouseEvent`
// carries them and bubbles to the same `onPointerDown`/`Move`/`Up` handlers, so
// the roll's real geometry runs. (`pointerId`/`setPointerCapture` are absent
// too; the component guards both with optional chaining.)
interface PointerInit {
  clientX?: number;
  clientY?: number;
  button?: number;
  shiftKey?: boolean;
}
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: PointerInit = {},
): void {
  fireEvent(
    el,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: init.button ?? 0,
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      shiftKey: init.shiftKey ?? false,
    }),
  );
  // Solid 2 applies writes on the next microtask, so a pointer sequence
  // dispatched synchronously would have `pointermove` reading the drag state
  // `pointerdown` had only just set. A browser flushes between the two because
  // each event is its own task; this restores that interleaving.
  flush();
}

const PIXELS_PER_TICK = 0.25;
const ROW_HEIGHT = 14;
const HIGHEST_PITCH = 96;
const CONTENT_LEFT = 50;
const CONTENT_TOP = 30;

/** Content-x (client px) of a tick, given the test's fixed content origin. */
function tickX(ticks: number): number {
  return CONTENT_LEFT + ticks * PIXELS_PER_TICK;
}
/** Content-y (client px) of a pitch's row centre. */
function pitchY(pitch: number): number {
  return CONTENT_TOP + (HIGHEST_PITCH - pitch) * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function noteEvents(clip: Clip): readonly NoteEvent[] {
  return clip.content.kind === "notes" ? clip.content.events : [];
}

async function setUp() {
  const repository = createInMemoryProjectRepository();
  const project = createPianoRollFixtureProject();
  const created = await repository.createProject(project);
  if (!created.ok) throw new Error("fixture failed to create");

  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");

  const session = new EditorSession({
    repository,
    project,
    clock: createManualClock(1_000),
    analytics,
    deviceStorage: memoryStorage(),
  });

  const [componentAnalytics] = [
    new Analytics({ transport, consent, storage: memoryStorage() }),
  ];
  componentAnalytics.setAccountType("anonymous");

  let actions: PianoRollActions | null = null;
  /**
   * `beginGesture` is overridable so a test can wrap it (e.g. to force a
   * synchronous re-entrant `commitVelocity()` from within `apply()`) while
   * still sharing this helper's analytics/dispatch wiring.
   */
  function renderRoll(overrides: { beginGesture?: PianoRollProps["beginGesture"] } = {}) {
    return render(() => (
      <PianoRoll
        clip={session.project.clips[0]}
        project={session.project}
        dispatch={session.dispatch.bind(session)}
        beginGesture={overrides.beginGesture ?? session.beginGesture.bind(session)}
        analytics={componentAnalytics}
        registerActions={(a) => {
          actions = a;
        }}
        contentLeftForTest={CONTENT_LEFT}
        contentTopForTest={CONTENT_TOP}
      />
    ));
  }

  return {
    repository,
    project,
    session,
    transport,
    renderRoll,
    getActions: () => actions,
  };
}

/** The scrollable content element the roll draws notes into. */
function contentEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".piano-roll-content");
  if (!el) throw new Error("no content element");
  return el as HTMLElement;
}

function noteEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-event-id="${id}"]`);
  if (!el) throw new Error(`no note element for ${id}`);
  return el as HTMLElement;
}

/** Stubs a note element's client rect from its inline style (jsdom returns 0s). */
function stubNoteRect(el: HTMLElement): void {
  const left = Number.parseFloat(el.style.left) + CONTENT_LEFT;
  const top = Number.parseFloat(el.style.top) + CONTENT_TOP;
  const width = Number.parseFloat(el.style.width);
  const height = Number.parseFloat(el.style.height);
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function clipEditedEvents(transport: RecordingTransport) {
  return transport.events.filter((event) => event.name === "clip_edited");
}
function featureFirstUseEvents(transport: RecordingTransport) {
  return transport.events.filter((event) => event.name === "feature_first_use");
}

describe("PianoRoll", () => {
  it("renders a note element per event in the clip", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const notes = noteEvents(session.project.clips[0]);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(container.querySelector(`[data-event-id="${note.id}"]`)).not.toBeNull();
    }
  });

  it("creates a note snapped to the 16th grid at the clicked pitch", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const before = noteEvents(session.project.clips[0]).length;

    // Click a little past the 2nd 16th, over pitch 62 (D4).
    firePointer(contentEl(container), "pointerdown", {
      button: 0,
      clientX: tickX(2 * TICKS_PER_SIXTEENTH) + 3,
      clientY: pitchY(62),
    });

    const notes = noteEvents(session.project.clips[0]);
    expect(notes).toHaveLength(before + 1);
    const added = notes[notes.length - 1];
    expect(added.startTicks).toBe(2 * TICKS_PER_SIXTEENTH);
    expect(added.durationTicks).toBe(TICKS_PER_SIXTEENTH);
    expect(added.trigger.kind === "pitch" && added.trigger.pitch).toBe(62);
  });

  it("ends a drag once when pointerup bubbles from the note to the grid", async () => {
    // Regression: a pointerup on a note runs the note's own handler and then
    // the grid's as it bubbles, and both end the drag. Under Solid 1 the
    // first call's `setDrag(null)` was visible to the second synchronously,
    // so the `if (drag())` guard short-circuited it. Solid 2 publishes that
    // write on the next microtask, so the second call saw a live drag, passed
    // the guard, and committed an already-finished gesture -- the command
    // layer threw "This gesture has already finished" on every real note drag.
    //
    // The assertion is on window `error` events, not on `firePointer`
    // throwing, because jsdom reports a listener throw to the virtual console
    // rather than to the caller. That is precisely what made the bug easy to
    // miss: it surfaced as an *unhandled error* that failed the run while
    // every assertion in this file still passed.
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const startRevision = session.project.metadata.revision;

    const escaped: string[] = [];
    const onError = (event: ErrorEvent) => escaped.push(event.message);
    window.addEventListener("error", onError);
    try {
      const el = noteEl(container, note.id);
      stubNoteRect(el);
      firePointer(el, "pointerdown", {
        button: 0,
        clientX: tickX(note.startTicks) + 2,
        clientY: pitchY(60),
      });
      firePointer(el, "pointermove", {
        clientX: tickX(note.startTicks) + 2 + TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
        clientY: pitchY(60),
      });
      firePointer(el, "pointerup");
    } finally {
      window.removeEventListener("error", onError);
    }

    expect(escaped).toEqual([]);
    // And the gesture landed exactly once, not once per handler.
    expect(session.project.metadata.revision).toBe(startRevision + 1);
  });

  it("moves a note as ONE undo transaction across many drag frames", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const startRevision = session.project.metadata.revision;
    const startUndoDepth = session.history.entries.length;

    const el = noteEl(container, note.id);
    stubNoteRect(el);
    // Grab the body (left half, not the resize edge) and drag right two 16ths.
    firePointer(el, "pointerdown", {
      button: 0,
      clientX: tickX(note.startTicks) + 2,
      clientY: pitchY(60),
    });
    for (const step of [1, 2]) {
      firePointer(el, "pointermove", {
        clientX:
          tickX(note.startTicks) + 2 + step * TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
        clientY: pitchY(60),
      });
    }
    firePointer(el, "pointerup");

    const moved = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(moved?.startTicks).toBe(note.startTicks + 2 * TICKS_PER_SIXTEENTH);
    // One revision, one history entry — not one per frame.
    expect(session.project.metadata.revision).toBe(startRevision + 1);
    expect(session.history.entries.length).toBe(startUndoDepth + 1);
  });

  it("resizes a note from its right edge, snapped and never past the clip end", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];

    const el = noteEl(container, note.id);
    stubNoteRect(el);
    const rect = el.getBoundingClientRect();
    // Press within the resize handle (right edge) and drag far right.
    firePointer(el, "pointerdown", {
      button: 0,
      clientX: rect.right - 1,
      clientY: pitchY(60),
    });
    firePointer(el, "pointermove", {
      clientX: rect.right - 1 + 4 * TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
      clientY: pitchY(60),
    });
    firePointer(el, "pointerup");

    const resized = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(resized).toBeDefined();
    // Grew, is 16th-aligned, and did not exceed the clip.
    expect(resized?.durationTicks).toBeGreaterThan(note.durationTicks);
    expect((resized?.durationTicks ?? 0) % TICKS_PER_SIXTEENTH).toBe(0);
    expect(
      (resized?.startTicks ?? 0) + (resized?.durationTicks ?? 0),
    ).toBeLessThanOrEqual(session.project.clips[0].lengthTicks);
  });

  it("keeps a moved note inside the clip's left boundary", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    stubNoteRect(el);
    // Drag far to the left, past tick 0.
    firePointer(el, "pointerdown", {
      button: 0,
      clientX: tickX(note.startTicks) + 2,
      clientY: pitchY(60),
    });
    firePointer(el, "pointermove", {
      clientX: tickX(note.startTicks) + 2 - 100,
      clientY: pitchY(60),
    });
    firePointer(el, "pointerup");

    const moved = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(moved?.startTicks).toBeGreaterThanOrEqual(0);
  });

  it("group-selects with a shift+drag marquee, then deletes the whole group through the registered delete action", async () => {
    const { session, renderRoll, getActions } = await setUp();
    const { container } = renderRoll();
    for (const note of noteEvents(session.project.clips[0])) {
      stubNoteRect(noteEl(container, note.id));
    }
    const content = contentEl(container);

    // A marquee that sweeps the whole bar, all pitches shown.
    firePointer(content, "pointerdown", {
      button: 0,
      shiftKey: true,
      clientX: tickX(0),
      clientY: CONTENT_TOP,
    });
    firePointer(content, "pointermove", {
      clientX: tickX(TICKS_PER_BAR),
      clientY: CONTENT_TOP + ROW_HEIGHT * 80,
    });
    firePointer(content, "pointerup");

    // All four fixture notes are now selected.
    expect(container.querySelectorAll(".pr-note.selected").length).toBe(
      noteEvents(session.project.clips[0]).length,
    );
    expect(getActions()?.hasSelection()).toBe(true);

    // The registry-owned `edit.delete` calls the roll's exposed operation —
    // the roll never listens for the key itself (PRD KEY-01).
    getActions()?.deleteSelection();
    flush();
    expect(noteEvents(session.project.clips[0])).toHaveLength(0);
    expect(getActions()?.hasSelection()).toBe(false);
  });

  it("duplicates the selection by one bar through the registered duplicate action", async () => {
    const { session, renderRoll, getActions } = await setUp();
    const { container } = renderRoll();
    const original = noteEvents(session.project.clips[0]);
    const first = original[0];

    // Select one note by clicking it (a move press+release with no drag keeps
    // the single-note selection).
    const el = noteEl(container, first.id);
    stubNoteRect(el);
    firePointer(el, "pointerdown", {
      button: 0,
      clientX: tickX(first.startTicks) + 2,
      clientY: pitchY(60),
    });
    firePointer(el, "pointerup");

    getActions()?.duplicateSelection();

    const after = noteEvents(session.project.clips[0]);
    expect(after.length).toBe(original.length + 1);
    // The copy is the same pitch, one bar later.
    const copy = after.find((n) => n.startTicks === first.startTicks + TICKS_PER_BAR);
    expect(copy).toBeDefined();
    expect(copy?.trigger).toEqual(first.trigger);
  });

  it("deletes the selection from the toolbar Delete button", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    stubNoteRect(el);
    firePointer(el, "pointerdown", {
      button: 0,
      clientX: tickX(note.startTicks) + 2,
      clientY: pitchY(60),
    });
    firePointer(el, "pointerup");

    const before = noteEvents(session.project.clips[0]).length;
    const deleteButton = container.querySelector(
      'button[aria-label="Delete selected notes"]',
    ) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(false);
    fireEvent.click(deleteButton);

    expect(noteEvents(session.project.clips[0])).toHaveLength(before - 1);
  });

  it("sets a note's velocity through a single note.update", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    const slider = el.querySelector(".pr-note-velocity input") as HTMLInputElement;

    fireEvent.input(slider, { target: { value: "0.3" } });
    // `change` fires when the slider settles, committing the gesture.
    fireEvent.change(slider, { target: { value: "0.3" } });

    const updated = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(updated?.velocity).toBeCloseTo(0.3);
  });

  // #255: the note's velocity was a raw `<input type="range">` — a native
  // thumb where every other continuous control in the editor is a thumbless
  // fill. It has to be the same control, in a compact shape that fits inside a
  // note block, and it has to keep its per-note accessible name.
  it("paints the note velocity as a compact thumbless fill slider (#255)", async () => {
    const { session, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    // Found structurally, so this reads the raw input of the broken note block
    // as well as the fill slider of the fixed one.
    const slider = el.querySelector('input[type="range"]') as HTMLInputElement;

    expect(slider.closest(".fill-slider-track")).not.toBeNull();
    const wrapper = slider.closest(".fill-slider");
    expect(wrapper?.querySelector(".fill-slider-fill")).not.toBeNull();
    // Compact: the label row and value readout are suppressed, so the control
    // still fits a note rectangle a few pixels tall…
    expect(wrapper?.classList.contains("compact")).toBe(true);
    expect(wrapper?.querySelector("output")).toBeNull();
    // …and the accessible name survives without a visible label.
    expect(slider.getAttribute("aria-label")).toMatch(/^Velocity of /);
  });

  it("sets velocity across a slider drag as ONE undo transaction and ONE clip_edited", async () => {
    const { session, renderRoll, transport } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    const slider = el.querySelector(".pr-note-velocity input") as HTMLInputElement;
    const startRevision = session.project.metadata.revision;
    const startUndoDepth = session.history.entries.length;
    const startEdited = clipEditedEvents(transport).length;

    // A range slider fires `input` continuously while its thumb is dragged;
    // the whole drag is one gesture and must land as one entry / revision.
    for (const value of [0.2, 0.35, 0.5, 0.62, 0.7, 0.78, 0.8]) {
      fireEvent.input(slider, { target: { value: String(value) } });
    }
    fireEvent.change(slider, { target: { value: "0.8" } });

    const updated = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(updated?.velocity).toBeCloseTo(0.8);
    // One revision, one history entry, one analytics event — not seven.
    expect(session.project.metadata.revision).toBe(startRevision + 1);
    expect(session.history.entries.length).toBe(startUndoDepth + 1);
    expect(clipEditedEvents(transport).length).toBe(startEdited + 1);

    // Undoing the whole gesture takes exactly one step back to the original.
    session.undo();
    const reverted = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(reverted?.velocity).toBeCloseTo(note.velocity);
    expect(session.project.metadata.revision).toBe(startRevision + 2);
  });

  it("survives a re-entrant commit triggered synchronously from within gesture.apply()", async () => {
    // Regression test for a real-browser crash jsdom's synthetic fireEvent
    // sequencing cannot reproduce: `applyVelocity` used to call
    // `velocityDrag.gesture.apply(...)` (which synchronously notifies history
    // listeners and can re-render the reactive tree) and THEN read
    // `velocityDrag.moved = true` -- but that re-render can synchronously
    // re-enter `commitVelocity()` (the range input's own `change`/blur firing
    // mid-render), which nulls the module-level `velocityDrag`. Control then
    // returns to `applyVelocity` and dereferences a null `velocityDrag`,
    // throwing `TypeError: Cannot set properties of null (setting 'moved')`.
    //
    // This test forces that exact re-entrancy directly: `beginGesture` hands
    // the roll a `Gesture` whose `apply()` calls straight through to the real
    // one, then -- standing in for the synchronous reactive re-render a real
    // browser performs -- synchronously fires the slider's native `change`
    // event, which re-enters `commitVelocity()` from inside `apply()`, before
    // `apply()` returns to `applyVelocity`.
    const { session, renderRoll, transport } = await setUp();
    const note = noteEvents(session.project.clips[0])[0];
    const startRevision = session.project.metadata.revision;
    const startUndoDepth = session.history.entries.length;
    const startEdited = clipEditedEvents(transport).length;

    // The slider element the wrapped gesture will fire a re-entrant `change`
    // on. Assigned once the component below is rendered, so the closure below
    // can reference it despite being constructed first.
    let reenterSlider: HTMLInputElement | null = null;
    let reenter = false;
    const realBeginGesture = session.beginGesture.bind(session);
    const wrappedBeginGesture: PianoRollProps["beginGesture"] = (options) => {
      const real = realBeginGesture(options);
      return {
        get active() {
          return real.active;
        },
        apply(commands) {
          const result = real.apply(commands);
          if (reenter && reenterSlider) {
            reenter = false;
            // Simulate the synchronous reactive re-render re-entering the
            // slider's own change handler mid-`apply()`.
            fireEvent.change(reenterSlider, {
              target: { value: reenterSlider.value },
            });
          }
          return result;
        },
        commit: real.commit.bind(real),
        cancel: real.cancel.bind(real),
      };
    };

    const { container: reenterContainer } = renderRoll({
      beginGesture: wrappedBeginGesture,
    });
    const reenterEl = noteEl(reenterContainer, note.id);
    reenterSlider = reenterEl.querySelector(
      ".pr-note-velocity input",
    ) as HTMLInputElement;

    reenter = true;
    expect(() => {
      fireEvent.input(reenterSlider as HTMLInputElement, {
        target: { value: "0.42" },
      });
    }).not.toThrow();

    // The re-entrant `change` committed the gesture from inside `apply()`:
    // exactly one revision, one undo entry, one `clip_edited` -- not a crash,
    // not a double-commit.
    const updated = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(updated?.velocity).toBeCloseTo(0.42);
    expect(session.project.metadata.revision).toBe(startRevision + 1);
    expect(session.history.entries.length).toBe(startUndoDepth + 1);
    expect(clipEditedEvents(transport).length).toBe(startEdited + 1);

    // No lingering open gesture: an unrelated subsequent edit must not throw
    // "A gesture is already in progress".
    expect(() => {
      fireEvent.input(reenterSlider, { target: { value: "0.55" } });
      fireEvent.change(reenterSlider, { target: { value: "0.55" } });
    }).not.toThrow();
    const final = noteEvents(session.project.clips[0]).find((n) => n.id === note.id);
    expect(final?.velocity).toBeCloseTo(0.55);
  });

  it("survives a save and reload: an edit made through the roll persists", async () => {
    const { session, repository, project, renderRoll } = await setUp();
    const { container } = renderRoll();
    const note = noteEvents(session.project.clips[0])[0];
    const el = noteEl(container, note.id);
    stubNoteRect(el);

    firePointer(el, "pointerdown", {
      button: 0,
      clientX: tickX(note.startTicks) + 2,
      clientY: pitchY(60),
    });
    firePointer(el, "pointermove", {
      clientX: tickX(note.startTicks) + 2 + 2 * TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
      clientY: pitchY(60),
    });
    firePointer(el, "pointerup");

    await session.autosave.flush();
    const reloaded = await repository.loadProject(project.metadata.id);
    if (!reloaded.ok) throw new Error("expected reload");
    const clip = reloaded.value.clips.find((c) => c.id === session.project.clips[0].id);
    if (clip?.content.kind !== "notes") throw new Error("expected note clip");
    const persisted = clip.content.events.find((n) => n.id === note.id);
    expect(persisted?.startTicks).toBe(note.startTicks + 2 * TICKS_PER_SIXTEENTH);
  });

  it("draws a playhead that follows the given playback position", async () => {
    const { session } = await setUp();
    const clip = session.project.clips[0];
    const { container } = render(() => (
      <PianoRoll
        clip={clip}
        project={session.project}
        dispatch={() => undefined}
        beginGesture={() => session.beginGesture()}
        playheadTicks={TICKS_PER_SIXTEENTH * 4}
        contentLeftForTest={CONTENT_LEFT}
        contentTopForTest={CONTENT_TOP}
      />
    ));
    const playhead = container.querySelector(".pr-playhead") as HTMLElement;
    expect(playhead).not.toBeNull();
    expect(playhead.style.left).toBe(`${TICKS_PER_SIXTEENTH * 4 * PIXELS_PER_TICK}px`);
  });

  it("shades out-of-key rows only when the in-key guide is enabled", async () => {
    const { renderRoll } = await setUp();
    const { container } = renderRoll();
    // Off by default: no row is marked out of key.
    expect(container.querySelectorAll(".pr-row.out-of-key")).toHaveLength(0);

    const checkbox = container.querySelector(".pr-key-guide input") as HTMLInputElement;
    clickAndFlush(checkbox);

    // C major (default root C): the black keys become out-of-key rows.
    expect(container.querySelectorAll(".pr-row.out-of-key").length).toBeGreaterThan(0);
  });

  describe("analytics (PRD OPS-02)", () => {
    it("emits clip_edited once per completed gesture, with editor piano_roll and an event_count_bucket", async () => {
      const { session, renderRoll, transport } = await setUp();
      const { container } = renderRoll();
      const note = noteEvents(session.project.clips[0])[0];
      const el = noteEl(container, note.id);
      stubNoteRect(el);

      firePointer(el, "pointerdown", {
        button: 0,
        clientX: tickX(note.startTicks) + 2,
        clientY: pitchY(60),
      });
      firePointer(el, "pointermove", {
        clientX: tickX(note.startTicks) + 2 + TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
        clientY: pitchY(60),
      });
      firePointer(el, "pointermove", {
        clientX: tickX(note.startTicks) + 2 + 2 * TICKS_PER_SIXTEENTH * PIXELS_PER_TICK,
        clientY: pitchY(60),
      });
      firePointer(el, "pointerup");

      const edited = clipEditedEvents(transport);
      expect(edited).toHaveLength(1);
      expect(edited[0]?.params.editor).toBe("piano_roll");
      expect(edited[0]?.params.event_count_bucket).toBe("1_4");
    });

    it("emits the piano_roll feature_first_use exactly once across many actions", async () => {
      const { session, renderRoll, transport } = await setUp();
      const { container } = renderRoll();

      // A create, then a velocity edit — two distinct actions.
      firePointer(contentEl(container), "pointerdown", {
        button: 0,
        clientX: tickX(4 * TICKS_PER_SIXTEENTH),
        clientY: pitchY(64),
      });
      const note = noteEvents(session.project.clips[0])[0];
      const slider = noteEl(container, note.id).querySelector(
        ".pr-note-velocity input",
      ) as HTMLInputElement;
      fireEvent.input(slider, { target: { value: "0.2" } });

      const firstUse = featureFirstUseEvents(transport).filter(
        (event) => event.params.feature === "piano_roll",
      );
      expect(firstUse).toHaveLength(1);
    });

    it("logs nothing when analytics consent is withdrawn", async () => {
      const repository = createInMemoryProjectRepository();
      const project = createPianoRollFixtureProject();
      await repository.createProject(project);
      const transport = createRecordingTransport();
      const consent = new ConsentStore(memoryStorage());
      consent.set({ productAnalytics: false });
      const analytics = new Analytics({
        transport,
        consent,
        storage: memoryStorage(),
      });
      const session = new EditorSession({
        repository,
        project,
        clock: createManualClock(1_000),
        analytics,
        deviceStorage: memoryStorage(),
      });
      const { container } = render(() => (
        <PianoRoll
          clip={session.project.clips[0]}
          project={session.project}
          dispatch={session.dispatch.bind(session)}
          beginGesture={session.beginGesture.bind(session)}
          analytics={analytics}
          contentLeftForTest={CONTENT_LEFT}
          contentTopForTest={CONTENT_TOP}
        />
      ));

      firePointer(contentEl(container), "pointerdown", {
        button: 0,
        clientX: tickX(4 * TICKS_PER_SIXTEENTH),
        clientY: pitchY(64),
      });

      expect(transport.events).toHaveLength(0);
    });
  });
});
