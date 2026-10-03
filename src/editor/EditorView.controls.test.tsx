import { createRouter, memoryHistory, useLocation, useNavigate } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ROW_METRICS } from "../arrangement/ArrangementView";
import { installWebAudioGlobals } from "../audio/testAudioContext";
import { type ControlAddress, controlKey } from "../commands/controlAddress";
import { createDevice } from "../domain/devices";
import type { Project } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { createSeededIdFactory, type DeviceId } from "../domain/ids";
import type { InMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import { editorViewFromPath, editorViewPath } from "./editorViews";

/**
 * The editor's controls carry their addresses (`UI-004`, #850): every control
 * the issue names — mixer volume and pan, tempo and swing, a device parameter,
 * an instrument parameter, a clip's notes — registers under the address
 * `controlsTouchedBy` gives the command that changes it.
 */

installWebAudioGlobals();

let AudioRuntimeModule: typeof import("../audio/AudioRuntime");
let inMemoryModule: typeof import("../persistence/inMemoryProjectRepository");
let EditorViewModule: typeof import("./EditorView");

beforeAll(async () => {
  AudioRuntimeModule = await import("../audio/AudioRuntime");
  inMemoryModule = await import("../persistence/inMemoryProjectRepository");
  EditorViewModule = await import("./EditorView");
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  try {
    await AudioRuntimeModule.getAudioRuntime().close();
  } catch {
    // already closed
  }
  AudioRuntimeModule.__resetAudioRuntimeForTests();
});

let repository: InMemoryProjectRepository;

vi.mock("../projectRepositoryClient", () => ({
  getProjectRepository: () => Promise.resolve(repository),
}));

/** The slice fixture with a filter on its one track, so a device is on screen. */
function projectWithDevice(): { project: Project; deviceId: DeviceId } {
  const project = createSliceFixtureProject();
  const deviceId = createSeededIdFactory("controls")("device");
  const [track] = project.song.tracks;
  return {
    deviceId,
    project: {
      ...project,
      song: {
        ...project.song,
        tracks: [{ ...track, devices: [createDevice(deviceId, "filter", 0)] }],
      },
    },
  };
}

async function openProject(project: Project) {
  repository = inMemoryModule.createInMemoryProjectRepository();
  const created = await repository.createProject(project);
  if (!created.ok) throw new Error("fixture project failed to create");
  const projectId = project.metadata.id;
  const EditorView = EditorViewModule.default;
  const Page = () => {
    const location = useLocation();
    const navigate = useNavigate();
    return (
      <EditorView
        projectId={projectId}
        view={editorViewFromPath(location.pathname)}
        viewHref={(view) => editorViewPath(projectId, view)}
        onSelectView={(view) => navigate(editorViewPath(projectId, view))}
      />
    );
  };
  const TestRouter = createRouter({
    history: memoryHistory(editorViewPath(projectId, "arrangement")),
    routes: [{ path: "/projects/:id/:view?", component: Page }],
  });
  render(() => <TestRouter />);
  await screen.findByRole("navigation", { name: "Views" });
}

async function goToView(label: "Arrangement" | "Instrument" | "Mixer"): Promise<void> {
  const dock = await screen.findByRole("navigation", { name: "Views" });
  clickAndFlush(within(dock).getByRole("link", { name: label }));
  await vi.waitFor(() =>
    expect(dock.querySelector("[aria-current='page']")).toHaveAccessibleName(label),
  );
}

/** Opens the clip at bar 1 of the first row by double-clicking the timeline. */
async function openSequenceEditor(): Promise<HTMLElement> {
  await screen.findByTestId("arrangement-view-ready");
  const canvas = document.querySelector(".arrangement-layer-interactive");
  if (!canvas) throw new Error("no arrangement interaction canvas rendered");
  fireAndFlush(() =>
    fireEvent.dblClick(canvas, {
      clientX: (768 / 2) * 0.08,
      clientY: 22 + ROW_METRICS.trackHeightPx * 0.5,
    }),
  );
  return screen.findByRole("region", { name: "Sequence editor" });
}

function controlsAt(address: ControlAddress): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`[data-control="${controlKey(address)}"]`),
  ];
}

describe("EditorView control addresses (UI-004)", () => {
  it("addresses tempo and swing on the song, in every view", async () => {
    const { project } = projectWithDevice();
    await openProject(project);
    for (const view of ["Arrangement", "Instrument", "Mixer"] as const) {
      await goToView(view);
      const tempo = controlsAt({ entity: "song", param: "tempo" });
      expect(tempo, view).toHaveLength(1);
      expect(within(tempo[0]).getByLabelText("Tempo (BPM)")).toBeInTheDocument();
      const swing = controlsAt({ entity: "song", param: "swing" });
      expect(
        swing.map((element) => element.getAttribute("aria-label")),
        view,
      ).toEqual(["Swing"]);
    }
  });

  it("addresses the swing slider too, while its panel is open", async () => {
    await openProject(projectWithDevice().project);
    clickAndFlush(screen.getByRole("button", { name: "Swing" }));
    await vi.waitFor(() =>
      expect(controlsAt({ entity: "song", param: "swing" })).toHaveLength(2),
    );
  });

  it("addresses a track's mixer volume and pan, and the master's volume", async () => {
    const { project } = projectWithDevice();
    const [track] = project.song.tracks;
    await openProject(project);
    await goToView("Mixer");
    const mixer = screen.getByRole("region", { name: "Mixer" });
    const [volume] = controlsAt({ entity: track.id, param: "volume" });
    expect(mixer).toContainElement(volume);
    expect(
      within(volume).getByRole("slider", { name: `Volume for ${track.name}` }),
    ).toBeInTheDocument();
    const [pan] = controlsAt({ entity: track.id, param: "pan" });
    expect(
      within(pan).getByRole("slider", { name: `Pan for ${track.name}` }),
    ).toBeInTheDocument();
    expect(controlsAt({ entity: "master", param: "volume" })).toHaveLength(1);
    expect(controlsAt({ entity: track.id, param: "header" })).toHaveLength(1);
  });

  it("addresses the same volume on the track's header, so both are marked together", async () => {
    const { project } = projectWithDevice();
    const [track] = project.song.tracks;
    await openProject(project);
    await screen.findByTestId("arrangement-view-ready");
    expect(controlsAt({ entity: track.id, param: "volume" })).toHaveLength(1);
    expect(controlsAt({ entity: track.id, param: "header" })).toHaveLength(1);
  });

  it("addresses an instrument parameter on its track and a device parameter on its device", async () => {
    const { project, deviceId } = projectWithDevice();
    const [track] = project.song.tracks;
    await openProject(project);
    await goToView("Instrument");
    const [pitch] = controlsAt({ entity: track.id, param: "pitch" });
    expect(within(pitch).getByText("Pitch")).toBeInTheDocument();
    const [cutoff] = controlsAt({ entity: deviceId, param: "cutoff" });
    expect(within(cutoff).getByText("Cutoff")).toBeInTheDocument();
    // A switch is addressed like a fader.
    const [mode] = controlsAt({ entity: deviceId, param: "mode" });
    expect(mode.tagName).toBe("FIELDSET");
    expect(controlsAt({ entity: deviceId, param: "faceplate" })).toHaveLength(1);
  });

  it("addresses a clip's notes on the open sequence editor", async () => {
    const { project } = projectWithDevice();
    const [clip] = project.clips;
    await openProject(project);
    const editor = await openSequenceEditor();
    const [notes] = controlsAt({ entity: clip.id, param: "notes" });
    expect(editor).toContainElement(notes);
  });
});
