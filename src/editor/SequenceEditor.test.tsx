import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project, Track } from "../domain/entities";
import {
  createDrumMachineInstrument,
  createDrumPad,
  createFactoryContext,
} from "../domain/factories";
import {
  createDrumMachineFixtureProject,
  createPianoRollFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { clickAndFlush } from "../testing/events";
import { loopEntryFor, showPianoRoll } from "./editorViewModel";
import SequenceEditor, { type SequenceEditorProps } from "./SequenceEditor";

afterEach(cleanup);

/**
 * The sequence editor over one clip, with the session's operations stubbed:
 * what this file asserts is the *surface* — the window, its name, its close,
 * and which editor a clip gets. The command paths underneath are covered where
 * they live (`StepEditor`, `PianoRoll`, `TransformPanel`), and the gesture that
 * opens this is covered in `EditorView.test.tsx`.
 */
function renderEditorFor(
  project: Project,
  pick: (project: Project) => { clip: Clip; track: Track },
  onClose = () => {},
  extra: Partial<SequenceEditorProps> = {},
) {
  const { clip, track } = pick(project);
  const rendered = render(() => (
    <SequenceEditor
      clip={clip}
      track={track}
      project={project}
      showPianoRoll={() => showPianoRoll(track, clip)}
      loop={loopEntryFor(project, clip)}
      songTempo={project.song.tempo}
      editorPlaybackStep={() => null}
      selectedNoteIds={() => []}
      setSelectedNoteIds={() => {}}
      playheadTicks={0}
      registerPianoRollActions={() => {}}
      dispatch={() => undefined}
      beginGesture={() => undefined}
      onClose={onClose}
      {...extra}
    />
  ));
  return { ...rendered, clip, track };
}

/**
 * The slice fixture as a drum machine: one "BD" pad on the kick sample, the
 * four-on-the-floor clip re-pointed at that pad. A sampler note clip opens the
 * piano roll (#496), so the step grid is only reachable through a drum machine.
 */
function createStepGridProject(): Project {
  const project = createSliceFixtureProject();
  const [track] = project.song.tracks;
  const [asset] = project.song.assets;
  const pad = createDrumPad(createFactoryContext(), { name: "BD", assetId: asset.id });
  return {
    ...project,
    song: {
      ...project.song,
      tracks: [{ ...track, instrument: createDrumMachineInstrument([pad]) }],
    },
    clips: project.clips.map((clip) =>
      clip.content.kind === "notes"
        ? {
            ...clip,
            content: {
              ...clip.content,
              events: clip.content.events.map((event) => ({
                ...event,
                trigger: { kind: "pad" as const, padId: pad.id },
              })),
            },
          }
        : clip,
    ),
  };
}

/** The slice fixture's sampler track and its four-on-the-floor note clip. */
const starterClip = (project: Project) => {
  const track = project.song.tracks[0];
  const clip = project.clips.find((candidate) => candidate.trackId === track.id);
  if (!clip) throw new Error("fixture has no clip on its first track");
  return { clip, track };
};

describe("SequenceEditor", () => {
  it("is a named window over the page, with the track it is editing", () => {
    const project = createSliceFixtureProject();
    const { track } = renderEditorFor(project, starterClip);

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Both the editor's own title and the clip editor's track info name it.
    expect(
      within(dialog).getByText(track.name, { selector: ".sequence-editor-title" }),
    ).toBeInTheDocument();
  });

  it("gives a drum-machine clip the step editor, with the clip's own steps", () => {
    const project = createStepGridProject();
    renderEditorFor(project, starterClip);

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(within(dialog).getByRole("region", { name: "Step editor" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "BD, step 1, on" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "BD, step 2, off" })).toBeVisible();
    expect(within(dialog).queryByRole("region", { name: /Piano roll/ })).toBeNull();
  });

  it("gives a sampler note clip the piano roll, not the step editor (#496)", () => {
    renderEditorFor(createSliceFixtureProject(), starterClip);

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(within(dialog).getByRole("region", { name: /Piano roll/ })).toBeVisible();
    expect(within(dialog).queryByRole("region", { name: "Step editor" })).toBeNull();
  });

  it("gives a synth clip the piano roll, with the Key and Transform panels under it", () => {
    const project = createPianoRollFixtureProject();
    const onTogglePlay = vi.fn();
    const audition = vi.fn();
    renderEditorFor(project, starterClip, () => {}, {
      onTogglePlay,
      audition,
      playing: true,
    });

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(within(dialog).getByRole("region", { name: /^Piano roll\b/ })).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Key" })).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Transform" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Quantize to scale" }),
    ).toBeDisabled();
    expect(within(dialog).queryByRole("region", { name: "Step editor" })).toBeNull();

    // The roll's Play is the transport's, and its preview plays the track.
    clickAndFlush(within(dialog).getByRole("button", { name: "Stop" }));
    expect(onTogglePlay).toHaveBeenCalledOnce();
    const c3 = within(within(dialog).getByRole("group", { name: "Pitches" })).getByRole(
      "button",
      { name: "C3" },
    );
    c3.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(audition).toHaveBeenCalledWith(60, 0.8);
  });

  it("shows the loop panel instead for a tempo-labelled audio loop", () => {
    // LOOP-006's panel used to sit in the workspace beside everything else;
    // an audio loop has no notes to program, so this is what opening one shows.
    const project = createDrumMachineFixtureProject();
    renderEditorFor(project, (current) => {
      const clip = current.clips.find((c) => c.content.kind === "audioLoop");
      if (!clip) throw new Error("fixture has no audio loop");
      const track = current.song.tracks.find((t) => t.id === clip.trackId);
      if (!track) throw new Error("the loop clip has no track");
      return { clip, track };
    });

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(within(dialog).getByRole("region", { name: "Audio loop" })).toBeVisible();
    // Instead, not as well: a step grid and note transforms on an audio clip
    // would offer to edit notes it does not have (#281).
    expect(within(dialog).queryByRole("region", { name: "Step editor" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Transpose" })).toBeNull();
  });

  it("closes from its close control", () => {
    const onClose = vi.fn();
    renderEditorFor(createSliceFixtureProject(), starterClip, onClose);

    clickAndFlush(screen.getByRole("button", { name: "Close sequence editor" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus when it opens and gives it back when it closes", () => {
    // A double-click on the canvas leaves focus nowhere useful, so a keyboard
    // user would otherwise be stranded behind the editor.
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = renderEditorFor(createSliceFixtureProject(), starterClip);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close sequence editor" }),
    );

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
