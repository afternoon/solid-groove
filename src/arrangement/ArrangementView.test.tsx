import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import {
  createLargeArrangementProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import type { TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { EditorSession } from "../editor/EditorSession";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { createManualClock } from "../shared/clock";
import { clickAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import ArrangementView, { type PlacementEditingActions } from "./ArrangementView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PIXELS_PER_TICK = 0.08;
const RULER_HEIGHT_PX = 22;
const ROW_HEIGHT_PX = 28;

/** jsdom's `PointerEvent` drops `clientX`/`button`; a `MouseEvent` bubbles to
 * the same `onPointer*` handlers and carries them, exactly like `PianoRoll`'s
 * own test helper does for the same reason. */
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { clientX?: number; clientY?: number; pointerId?: number } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  fireEvent(el, event);
  flush();
}

/** A one-placement fixture wired to a real `EditorSession`, so a test asserts
 * against the project a gesture actually produced (mirrors `PianoRoll.test.tsx`
 * and the `placementEditingHarness`'s own approach). */
async function setUpEditing() {
  const repository = createInMemoryProjectRepository();
  const project = createSliceFixtureProject();
  const created = await repository.createProject(project);
  if (!created.ok) throw new Error("fixture failed to create");

  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  consent.optIn();
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

  function renderView() {
    return render(() => (
      <ArrangementView
        project={session.project}
        analytics={analytics}
        dispatch={session.dispatch.bind(session)}
        beginGesture={session.beginGesture.bind(session)}
      />
    ));
  }

  return {
    session,
    transport,
    renderView,
    placementId: project.song.placements[0].id,
  };
}

function interactionCanvasOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".arrangement-layer-interactive");
  if (!el) throw new Error("no interaction canvas rendered");
  return el as HTMLElement;
}

function selectedPlacementIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-selected-placement]")).map(
    (el) => el.getAttribute("data-selected-placement") as string,
  );
}

/** An `Analytics` that actually sends (consent granted, memory storage), with a
 * recording transport so tests can assert exactly what was logged. */
function analyticsAllowing() {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  consent.optIn();
  const analytics = new Analytics({
    transport,
    consent,
    releaseSha: "test0000test0000",
    surface: "editor",
    storage: memoryStorage(),
  });
  return { analytics, transport };
}

function renderView(analytics: Analytics) {
  const project = createLargeArrangementProject(20);
  return render(() => <ArrangementView project={project} analytics={analytics} />);
}

describe("ArrangementView shell", () => {
  it("renders the four named DOM actions for keyboard/accessibility workflows", () => {
    const { analytics } = analyticsAllowing();
    renderView(analytics);
    expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom to selection")).toBeInTheDocument();
    expect(screen.getByLabelText("Scroll to playhead")).toBeInTheDocument();
  });

  it("windows the DOM track headers rather than rendering one per track", () => {
    const { analytics } = analyticsAllowing();
    // 50 tracks at 28px is 1,400px of content; the default 480px viewport
    // windows to roughly 21 rows (+ overscan), well under all 50.
    const project = createLargeArrangementProject(50);
    render(() => <ArrangementView project={project} analytics={analytics} />);
    const headerList = screen.getByLabelText("Tracks");
    const rows = headerList.querySelectorAll(".arrangement-header-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });

  it("exposes an accessible per-track select control (canvas is not the sole representation)", () => {
    const { analytics } = analyticsAllowing();
    renderView(analytics);
    const list = screen.getByLabelText("Arrangement tracks");
    const buttons = list.querySelectorAll("button[data-track-select]");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("selecting a track from the accessible list updates the live selection region", async () => {
    const { analytics } = analyticsAllowing();
    renderView(analytics);
    const list = screen.getByLabelText("Arrangement tracks");
    const firstSelect = list.querySelector<HTMLButtonElement>(
      "button[data-track-select]",
    );
    if (!firstSelect) throw new Error("no track-select control rendered");
    clickAndFlush(firstSelect);
    const live = screen.getByTestId("arrangement-selection-live");
    expect(live.textContent).toMatch(/^Selected /);
    expect(live.textContent).toMatch(/bars 1 to/);
  });
});

describe("arrangement feature_first_use analytics (PRD OPS-02)", () => {
  it("fires arrangement feature_first_use exactly once, on the first interaction", () => {
    const { analytics, transport } = analyticsAllowing();
    renderView(analytics);
    // No interaction yet: nothing logged.
    expect(featureUses(transport)).toEqual([]);

    clickAndFlush(screen.getByLabelText("Zoom in"));
    expect(featureUses(transport)).toEqual(["arrangement"]);

    // Further interactions do not re-fire it.
    clickAndFlush(screen.getByLabelText("Zoom out"));
    clickAndFlush(screen.getByLabelText("Zoom in"));
    expect(featureUses(transport)).toEqual(["arrangement"]);
  });

  it("logs nothing when analytics consent is denied", () => {
    const transport = createRecordingTransport();
    const consent = new ConsentStore(memoryStorage());
    consent.optOut();
    const analytics = new Analytics({
      transport,
      consent,
      releaseSha: "test0000test0000",
      surface: "editor",
      storage: memoryStorage(),
    });
    renderView(analytics);
    clickAndFlush(screen.getByLabelText("Zoom in"));
    clickAndFlush(screen.getByLabelText("Zoom out"));
    expect(transport.events).toEqual([]);
  });
});

function featureUses(transport: ReturnType<typeof createRecordingTransport>): string[] {
  return transport.events
    .filter((event) => event.name === "feature_first_use")
    .map((event) => event.params.feature as string);
}

describe("placement editing wiring (ARR-002)", () => {
  it("pointer-down on a placement selects it, not the shell's bar range", async () => {
    const { renderView, placementId } = await setUpEditing();
    const { container } = renderView();
    const canvas = interactionCanvasOf(container);
    // The fixture's one placement spans tick 0..TICKS_PER_BAR at row 0; a
    // point mid-body, well clear of the resize handles, hits its body.
    firePointer(canvas, "pointerdown", {
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    });
    firePointer(canvas, "pointerup", { clientX: 0, clientY: 0 });
    expect(selectedPlacementIds(container)).toEqual([placementId]);
  });

  /**
   * The preview showed two cyan boxes on one track at once: the shell's ARR-01
   * bar range and the ARR-002 placement selection, each left standing by the
   * click that made the other. "There should only be a single selection."
   */
  it("keeps exactly one arrangement selection live at a time", async () => {
    const { renderView, placementId } = await setUpEditing();
    const { container } = renderView();
    const canvas = interactionCanvasOf(container);
    const rowY = RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2;
    const barRangeText = () =>
      screen.getByTestId("arrangement-selection-live").textContent;
    const clickAt = (ticks: number) => {
      firePointer(canvas, "pointerdown", {
        clientX: ticks * PIXELS_PER_TICK,
        clientY: rowY,
      });
      firePointer(canvas, "pointerup", { clientX: 0, clientY: 0 });
    };

    // Empty space, three bars along: the shell takes a bar range.
    clickAt(TICKS_PER_BAR * 3);
    expect(barRangeText()).toMatch(/^Selected /);

    // The placement now becomes the only selection.
    clickAt(TICKS_PER_BAR / 2);
    expect(selectedPlacementIds(container)).toEqual([placementId]);
    expect(barRangeText()).toBe("No selection");

    // And back out to empty space: the bar range is the only one again.
    clickAt(TICKS_PER_BAR * 3);
    expect(barRangeText()).toMatch(/^Selected /);
    expect(selectedPlacementIds(container)).toEqual([]);
  });

  it("dragging a placement's body moves it, bar-snapped, through the command layer", async () => {
    const { session, renderView, placementId } = await setUpEditing();
    const { container } = renderView();
    const canvas = interactionCanvasOf(container);
    const bodyY = RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2;

    firePointer(canvas, "pointerdown", {
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: bodyY,
    });
    // Drag three bars to the right.
    const targetTicks = TICKS_PER_BAR / 2 + TICKS_PER_BAR * 3;
    firePointer(canvas, "pointermove", {
      clientX: targetTicks * PIXELS_PER_TICK,
      clientY: bodyY,
    });
    firePointer(canvas, "pointerup", {
      clientX: targetTicks * PIXELS_PER_TICK,
      clientY: bodyY,
    });

    const placement = session.project.song.placements.find((p) => p.id === placementId);
    expect(placement?.startTicks).toBe(TICKS_PER_BAR * 3);
    // The whole drag is one history entry, not one per pointermove.
    expect(session.history.entries.length).toBe(1);
  });

  it("exposes the controller's operations through onEditingActionsReady, like registerPianoRollActions", async () => {
    const { session, placementId } = await setUpEditing();
    const holder: { current: PlacementEditingActions | null } = {
      current: null,
    };
    render(() => (
      <ArrangementView
        project={session.project}
        dispatch={session.dispatch.bind(session)}
        beginGesture={session.beginGesture.bind(session)}
        onEditingActionsReady={(actions) => {
          holder.current = actions;
        }}
      />
    ));
    expect(holder.current).not.toBeNull();
    holder.current?.select(placementId);
    expect(holder.current?.hasSelection()).toBe(true);
  });

  it("shows the CLP-01 duplicate-mode choice only once a placement is selected, and disables it otherwise", async () => {
    const { renderView } = await setUpEditing();
    renderView();
    const linked = screen
      .getByTestId("placement-toolbar")
      .querySelector('[data-action="duplicate-linked"]') as HTMLButtonElement;
    const independent = screen
      .getByTestId("placement-toolbar")
      .querySelector('[data-action="duplicate-independent"]') as HTMLButtonElement;
    expect(linked.disabled).toBe(true);
    expect(independent.disabled).toBe(true);
    expect(linked.textContent).toMatch(/linked copy/);
    expect(independent.textContent).toMatch(/independent copy/);
  });

  it("linked duplicate reuses the source clip; independent duplicate forks a new one", async () => {
    const { session, renderView, placementId } = await setUpEditing();
    const { container } = renderView();
    const canvas = interactionCanvasOf(container);
    firePointer(canvas, "pointerdown", {
      clientX: (TICKS_PER_BAR / 2) * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    });
    firePointer(canvas, "pointerup", { clientX: 0, clientY: 0 });

    const originalClipCount = session.project.clips.length;
    const sourcePlacement = session.project.song.placements.find(
      (p) => p.id === placementId,
    );

    clickAndFlush(screen.getByText(/Duplicate as a linked copy/));
    expect(session.project.clips.length).toBe(originalClipCount);
    expect(session.project.song.placements.length).toBe(2);
    const linkedCopy = session.project.song.placements.find((p) => p.id !== placementId);
    expect(linkedCopy?.clipId).toBe(sourcePlacement?.clipId);

    clickAndFlush(screen.getByText(/Duplicate as an independent copy/));
    expect(session.project.clips.length).toBe(originalClipCount + 1);
    expect(session.project.song.placements.length).toBe(3);
  });
});

describe("arrangement track selection (#228)", () => {
  /** The view with a host holding the selected track, as `EditorView` does. */
  function renderSelectable() {
    const { analytics, transport } = analyticsAllowing();
    const project = createLargeArrangementProject(20);
    const selected: string[] = [];
    const [selectedTrackId, setSelectedTrackId] = createSignal<TrackId | null>(null);
    const result = render(() => (
      <ArrangementView
        project={project}
        analytics={analytics}
        selectedTrackId={selectedTrackId()}
        onSelectTrack={(trackId) => {
          selected.push(trackId);
          setSelectedTrackId(trackId);
        }}
      />
    ));
    return { ...result, project, selected, transport };
  }

  function headerButton(trackName: string): HTMLElement {
    return within(screen.getByLabelText("Tracks")).getByRole("button", {
      name: `Edit ${trackName}`,
    });
  }

  it("selects a track from its header row, and marks the selected one", () => {
    const { project, selected } = renderSelectable();
    const second = project.song.tracks[1];

    expect(headerButton(second.name)).toHaveAttribute("aria-pressed", "false");
    clickAndFlush(headerButton(second.name));

    expect(selected).toEqual([second.id]);
    expect(headerButton(second.name)).toHaveAttribute("aria-pressed", "true");
    expect(headerButton(project.song.tracks[0].name)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("selects the track of the row a pointer lands on in the timeline", () => {
    const { container, project, selected } = renderSelectable();

    // Row 1 (the second track), a bar in and clear of the ruler.
    firePointer(interactionCanvasOf(container), "pointerdown", {
      clientX: TICKS_PER_BAR * PIXELS_PER_TICK,
      clientY: RULER_HEIGHT_PX + ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2,
    });

    expect(selected).toEqual([project.song.tracks[1].id]);
  });

  it("selects the track from the accessible list too, alongside its bar range", () => {
    const { project, selected } = renderSelectable();
    const list = screen.getByLabelText("Arrangement tracks");
    const buttons = list.querySelectorAll<HTMLButtonElement>("button[data-track-select]");

    clickAndFlush(buttons[1]);

    expect(selected).toEqual([project.song.tracks[1].id]);
    // The bar-range selection it already made is unchanged.
    expect(screen.getByTestId("arrangement-selection-live").textContent).toMatch(
      /bars 1 to/,
    );
  });

  it("counts selecting a track as arrangement use, with no event of its own", () => {
    const { project, transport } = renderSelectable();

    clickAndFlush(headerButton(project.song.tracks[1].name));

    expect(featureUses(transport)).toEqual(["arrangement"]);
    expect(transport.events).toHaveLength(1);
  });
});
