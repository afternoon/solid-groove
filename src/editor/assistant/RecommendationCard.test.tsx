import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import type { AssistantToolCall } from "../../assistant/protocol";
import { RECOMMEND_SOUNDS_TOOL } from "../../assistant/recommendation";
import { ASSISTANT_TOOLSET_VERSION } from "../../assistant/tools";
import { setPadAsset } from "../../commands";
import { type ControlAddress, controlKey } from "../../commands/controlAddress";
import { createControlRegistry } from "../../controls/registry";
import type { Project } from "../../domain/entities";
import { createFactoryContext } from "../../domain/factories";
import { fakePreviewEngine } from "../../library/__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "../../library/__fixtures__/fixtures";
import { loadPadSampleCommands, toLibrarySample } from "../../library/insertion";
import { LibraryClient } from "../../library/libraryClient";
import type { LibraryAsset } from "../../library/manifest";
import { createInMemoryProjectRepository } from "../../persistence/inMemoryProjectRepository";
import { createManualClock } from "../../shared/clock";
import { clickAndFlush, fireAndFlush } from "../../testing/events";
import {
  createFakeAssistantClient,
  type FakeAssistantClient,
} from "../../testing/fakeAssistantClient";
import { memoryStorage } from "../../testing/storage";
import { assistantProposalTarget } from "../assistantProposalTarget";
import { EditorSession } from "../EditorSession";
import type { EditorLocation } from "../editorControls";
import type { EditorViewName } from "../editorViews";
import { emptyPadSelection } from "../padSelection";
import { createStarterProject } from "../starterProject";
import AssistantPanel, { TRYING_STATUS } from "./AssistantPanel";
import { createAssistantLibrary } from "./assistantLibrary";
import {
  PACK_IN_PROJECT,
  PACK_JOINS,
  REFUSED_RECOMMENDATION,
} from "./RecommendationCard";
import { recommendationSlot } from "./recommendationCardModel";
import { useAssistantChat } from "./useAssistantChat";
import { useAssistantPanel } from "./useAssistantPanel";
import type { RecommendationEditorPort } from "./useAssistantRecommendations";

/**
 * A recommended pack's card (GRV-23) against a real editor session and the
 * fixture library: it renders from the library's IDs, refuses one the library
 * lacks, tries a sound through the slot with nothing saved, puts it back,
 * keeps it as one undo step, goes out of date under an edit to the slot, and
 * hears, demos and opens the pack.
 */

afterEach(cleanup);

const ARRANGEMENT = { view: "arrangement" } as unknown as EditorLocation;
const DRUMS = "pak_SdlN_OazweXrwury0j27Y";
const BASS = "pak_FH8gyASzYiWGCrtpKZ-Ho";
const SOFT_KICK = "sg-one-shot-drums-kick-0004";
const TIGHT_KICK = "sg-one-shot-drums-kick-0002";
const SUB = "sg-one-shot-bass-sub-0001";

async function setUp() {
  const repository = createInMemoryProjectRepository();
  const project = createStarterProject("uid-1");
  const created = await repository.createProject(project);
  if (!created.ok) throw new Error("the starter project failed to create");
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("registered");
  const session = new EditorSession({
    repository,
    project,
    clock: createManualClock(1_000),
    analytics,
    deviceStorage: memoryStorage(),
  });
  const client: FakeAssistantClient = createFakeAssistantClient();
  const registry = createControlRegistry();
  const revealControl = vi.fn(
    (_address: ControlAddress, _options?: { focus?: boolean }) => ARRANGEMENT,
  );
  const restoreView = vi.fn((_location: EditorLocation) => {});
  const track = project.song.tracks[0];
  if (!track || track.instrument?.kind !== "drumMachine") {
    throw new Error("the starter has no drum machine");
  }
  const pad = track.instrument.pads[0];
  if (!pad) throw new Error("the starter has no pad");
  const library = createAssistantLibrary(new LibraryClient(fixtureFetcher()));
  const engine = fakePreviewEngine();

  const [shown, setShown] = createSignal<Project>(session.project);
  const [previewing, setPreviewing] = createSignal(false);
  session.subscribe((snapshot) => {
    setShown(snapshot.project);
    setPreviewing(snapshot.previewing);
  });

  const port = {
    slotFor: (trackId: string | null) =>
      recommendationSlot(session.committedProject, trackId, track, emptyPadSelection),
    previewInSlot: vi.fn((_slot, _sound: LibraryAsset) => true),
    clearPreview: vi.fn(() => {}),
    // As the library's Insert does: one transaction onto the pad.
    keep: vi.fn(async (target, sound: LibraryAsset) => {
      const sample = toLibrarySample(sound);
      if (!sample || target.kind !== "pad") return { ok: false, reason: "No." } as const;
      const result = session.dispatch(
        loadPadSampleCommands(
          session.committedProject,
          target.trackId,
          target.padId,
          sample,
          createFactoryContext(),
        ),
      );
      return result?.ok
        ? ({ ok: true } as const)
        : ({ ok: false, reason: "No." } as const);
    }),
    openLibrary: vi.fn((_slug: string, _slot) => {}),
    createAuditionEngine: () => engine,
  } satisfies RecommendationEditorPort;

  const Harness = () => {
    const panel = useAssistantPanel({
      storage: memoryStorage(),
      analytics: () => analytics,
    });
    const chat = useAssistantChat({
      project: shown,
      view: () => "arrangement" as EditorViewName,
      sources: () => ({ selection: null, track }),
      account: () => ({ registered: true }),
      expanded: () => panel.layout().mode === "floating",
      client: async () => client,
      analytics: () => analytics,
      editor: {
        session: {
          proposalTarget: () => assistantProposalTarget(session),
          beginPreview: (commands) => session.beginPreview(commands),
          onEdit: (listener) => session.subscribeEdits(listener),
          onRemoteChange: (listener) => session.subscribeRemoteChanges(listener),
          previewing,
        },
        controls: { registry, revealControl, restoreView },
        recommendations: { library, port },
      },
    });
    return (
      <>
        <button type="button" onClick={(event) => panel.toggle(event.currentTarget)}>
          Open it
        </button>
        <AssistantPanel panel={panel} chat={chat} />
      </>
    );
  };
  render(() => <Harness />);
  clickAndFlush(screen.getByRole("button", { name: "Open it" }));

  /** Asks, and answers with a recommendation of `input`. */
  async function recommend(
    input: Record<string, unknown> = {
      packId: DRUMS,
      soundIds: [SOFT_KICK, TIGHT_KICK],
      reason: "Softer kicks that sit back in the beat.",
      trackId: track?.id,
    },
  ) {
    const before = client.turns.length;
    fireAndFlush(() =>
      fireEvent.input(composer(), { target: { value: "Anything dustier?" } }),
    );
    clickAndFlush(button("Send"));
    await vi.waitFor(() => expect(client.turns).toHaveLength(before + 1));
    const call: AssistantToolCall = { id: "toolu_1", name: RECOMMEND_SOUNDS_TOOL, input };
    fireAndFlush(() => client.last().text("Try these."));
    fireAndFlush(() =>
      client.last().emit({
        type: "proposal",
        proposal: {
          baseRevision: session.committedProject.metadata.revision,
          toolsetVersion: ASSISTANT_TOOLSET_VERSION,
          calls: [call],
        },
      }),
    );
    fireAndFlush(() => client.last().done());
  }

  const events = (name: string) =>
    transport.events.filter((event) => event.name === name);
  const slot = { entity: pad.id, param: "sample" } as ControlAddress;

  return {
    project,
    session,
    client,
    registry,
    revealControl,
    restoreView,
    track,
    pad,
    slot,
    port,
    engine,
    recommend,
    events,
  };
}

const panel = () => screen.getByRole("region", { name: "Assistant" });
const composer = () =>
  within(panel()).getByRole("textbox", { name: "Message the assistant" });
const button = (name: string | RegExp) => within(panel()).getByRole("button", { name });
const card = () => within(panel()).getByRole("region", { name: /^Recommended pack\b/ });
const cardButton = (name: string | RegExp) =>
  within(card()).getByRole("button", { name });
const cardStatus = () => within(card()).getByRole("status");
const panelStatus = () =>
  panel().querySelector(".assistant-panel-status")?.textContent ?? "";
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Clicks with focus on the button first, as a keyboard or a pointer leaves it. */
async function press(element: HTMLElement): Promise<void> {
  element.focus();
  clickAndFlush(element);
  await settle();
  flush();
  await settle();
  flush();
}

const padAsset = (session: EditorSession, padId: string) => {
  const kit = session.committedProject.song.tracks[0]?.instrument;
  return kit?.kind === "drumMachine"
    ? kit.pads.find((entry) => entry.id === padId)?.assetId
    : undefined;
};

describe("the recommended pack card (GRV-23)", () => {
  it("sends the library with the turn", async () => {
    const { recommend, client } = await setUp();
    await recommend();
    const sent = client.turns[0]?.request.library;
    expect(sent?.packs.map((pack) => pack.name)).toContain("Core Electronic Drums");
    expect(JSON.stringify(sent)).not.toMatch(/https?:|\.wav/);
  });

  it("shows the pack, why it fits, its sounds and Try, and changes nothing", async () => {
    const { recommend, session, project, events } = await setUp();
    await recommend();
    expect(card()).toHaveAccessibleName("Recommended pack: Core Electronic Drums");
    expect(card()).toHaveTextContent("Softer kicks that sit back in the beat.");
    expect(card()).toHaveTextContent(PACK_IN_PROJECT);
    expect(card()).toHaveTextContent(/Groove · 1\.1\.0 · \d+ sounds/);
    const sounds = within(
      within(card()).getByRole("list", { name: "Sounds" }),
    ).getAllByRole("listitem");
    expect(sounds).toHaveLength(2);
    expect(within(sounds[0] as HTMLElement).getByRole("button")).toHaveAccessibleName(
      "Hear Soft Rounded Kick",
    );
    expect(sounds[0]).toHaveTextContent("Core Electronic Drums · kick");
    expect(cardButton("Try on BD")).toBeEnabled();
    expect(cardButton("Pack demo")).toHaveAttribute("aria-pressed", "false");
    expect(cardButton("Open in library")).toBeEnabled();
    expect(cardStatus()).toHaveTextContent(
      "Nothing has changed yet. Try Soft Rounded Kick on BD",
    );
    expect(session.committedProject).toBe(project);
    expect(session.history.canUndo).toBe(false);
    expect(events("assistant_recommendation_shown")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ pack_in_project: true, sound_count: 2 }),
      }),
    ]);
  });

  it("says a pack the project does not use joins it when a sound is kept", async () => {
    const { recommend } = await setUp();
    await recommend({ packId: BASS, soundIds: [SUB], reason: "A sub under it." });
    expect(card()).toHaveTextContent(PACK_JOINS);
  });

  it("refuses an ID the library does not hold as a failed reply, never a card", async () => {
    const { recommend, events } = await setUp();
    await recommend({ packId: DRUMS, soundIds: ["sg-invented-kick"], reason: "Dusty." });
    expect(
      within(panel()).queryByRole("region", { name: /^Recommended pack/ }),
    ).toBeNull();
    expect(within(panel()).getByRole("alert")).toHaveTextContent(REFUSED_RECOMMENDATION);
    expect(events("assistant_recommendation_refused")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ reason: "unknown_sound" }),
      }),
    ]);
    expect(events("assistant_recommendation_shown")).toHaveLength(0);
  });

  it("tries the first sound through the slot: the slot's view, dashed, nothing saved", async () => {
    const {
      recommend,
      session,
      port,
      revealControl,
      registry,
      slot,
      pad,
      events,
      track,
    } = await setUp();
    await recommend();
    await press(cardButton("Try on BD"));

    expect(port.previewInSlot).toHaveBeenCalledWith(
      { trackId: track.id, padId: pad.id },
      expect.objectContaining({ id: SOFT_KICK }),
    );
    expect(revealControl).toHaveBeenCalledWith(slot, { focus: false });
    expect(registry.markOf(slot)).toBe("previewed");
    expect(session.history.canUndo).toBe(false);
    expect(padAsset(session, pad.id)).toBe(pad.assetId);
    expect(cardStatus()).toHaveTextContent(
      "BD is trying Soft Rounded Kick. Play to hear it in the beat. Nothing is saved until you keep it. Put back takes you back to Arrangement.",
    );
    expect(panelStatus()).toBe(TRYING_STATUS);
    expect(cardButton("Keep")).toHaveFocus();
    expect(events("assistant_recommendation_tried")).toHaveLength(1);
  });

  it("puts it back where the editor was, with nothing to undo", async () => {
    const { recommend, session, port, restoreView, registry, slot, events } =
      await setUp();
    await recommend();
    await press(cardButton("Try on BD"));
    await press(cardButton("Put back"));

    expect(port.clearPreview).toHaveBeenCalled();
    expect(restoreView).toHaveBeenCalledWith(ARRANGEMENT);
    expect(registry.markOf(slot)).toBe("none");
    expect(session.history.canUndo).toBe(false);
    expect(cardStatus()).toHaveTextContent("Put back. BD has its own sound back");
    expect(panelStatus()).toBe("");
    expect(cardButton("Try on BD")).toHaveFocus();
    expect(events("assistant_recommendation_put_back")).toHaveLength(1);
  });

  it("keeps it as one undo step, outlined, and undoes it from the card", async () => {
    const { recommend, session, port, registry, slot, pad, events } = await setUp();
    await recommend();
    await press(cardButton("Try on BD"));
    await press(cardButton("Keep"));

    expect(port.keep).toHaveBeenCalledTimes(1);
    expect(session.history.entries).toHaveLength(1);
    const kept = padAsset(session, pad.id);
    expect(kept).not.toBe(pad.assetId);
    expect(
      session.committedProject.song.assets.find((asset) => asset.id === kept)?.name,
    ).toBe("Soft Rounded Kick");
    expect(registry.markOf(slot)).toBe("changed");
    expect(cardStatus()).toHaveTextContent("Kept. BD plays Soft Rounded Kick now");
    expect(cardButton("Undo")).toHaveFocus();
    expect(events("assistant_recommendation_kept")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ pack_in_project: true }),
      }),
    ]);

    await press(cardButton("Undo"));
    expect(padAsset(session, pad.id)).toBe(pad.assetId);
    expect(registry.markOf(slot)).toBe("none");
    expect(cardStatus()).toHaveTextContent("Undone. BD has its own sound back.");
    fireAndFlush(() => session.redo());
    expect(cardStatus()).toHaveTextContent("Kept.");
  });

  it("makes a pack the project did not use one of its packs when a sound is kept", async () => {
    const { recommend } = await setUp();
    await recommend({ packId: BASS, soundIds: [SUB], reason: "A sub." });
    await press(cardButton("Try on BD"));
    await press(cardButton("Keep"));
    expect(card()).toHaveTextContent(PACK_IN_PROJECT);
  });

  it("goes out of date when the slot is edited while a sound is tried", async () => {
    const { recommend, session, port, registry, slot, track, pad, client } =
      await setUp();
    await recommend();
    await press(cardButton("Try on BD"));
    fireAndFlush(() => session.dispatch(setPadAsset(track.id, pad.id, null)));

    expect(port.clearPreview).toHaveBeenCalled();
    expect(registry.markOf(slot)).toBe("none");
    expect(cardStatus()).toHaveTextContent("Out of date.");
    expect(within(card()).queryByRole("button", { name: "Keep" })).toBeNull();
    await press(cardButton("Refresh"));
    await vi.waitFor(() => expect(client.turns).toHaveLength(2));
    expect(cardStatus()).toHaveTextContent("A new recommendation was asked for below.");
  });

  it("hears one sound on its own, and plays and stops the pack demo", async () => {
    const { recommend, engine } = await setUp();
    await recommend();
    await press(cardButton("Hear Tight House Kick"));
    expect(engine.starts.at(-1)?.asset.id).toBe(TIGHT_KICK);
    await press(cardButton(/Pack demo/));
    expect(cardButton(/Pack demo/)).toHaveAttribute("aria-pressed", "true");
    expect(engine.starts.length).toBeGreaterThan(1);
    await press(cardButton(/Pack demo/));
    expect(cardButton(/Pack demo/)).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the pack in the library, aimed at the slot, ending a try first", async () => {
    const { recommend, port, track, pad } = await setUp();
    await recommend();
    await press(cardButton("Try on BD"));
    await press(cardButton("Open in library"));
    expect(port.clearPreview).toHaveBeenCalled();
    expect(port.openLibrary).toHaveBeenCalledWith(
      "core-electronic-drums",
      expect.objectContaining({
        target: { kind: "pad", trackId: track.id, padId: pad.id },
      }),
    );
    expect(cardStatus()).toHaveTextContent("Put back.");
  });

  it("registers no project change, history or save for anything but Keep", async () => {
    const { recommend, session, project, slot } = await setUp();
    await recommend();
    await press(cardButton("Try on BD"));
    await press(cardButton("Put back"));
    await press(cardButton(/Pack demo/));
    expect(session.committedProject).toBe(project);
    expect(controlKey(slot)).toContain(":sample");
  });
});
