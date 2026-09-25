import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Clip, Project, Track } from "../domain/entities";
import {
  createDrumMachineFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { clickAndFlush } from "../testing/events";
import { loopEntryFor } from "./editorViewModel";
import SequenceEditor from "./SequenceEditor";

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
) {
  const { clip, track } = pick(project);
  const rendered = render(() => (
    <SequenceEditor
      clip={clip}
      track={track}
      project={project}
      packDependencyLabel={null}
      showPianoRoll={() => track.instrument?.kind === "synth"}
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
    />
  ));
  return { ...rendered, clip, track };
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

  it("gives a step-grid clip the step editor, with the clip's own steps", () => {
    const project = createSliceFixtureProject();
    renderEditorFor(project, starterClip);

    const dialog = screen.getByRole("dialog", { name: "Sequence editor" });
    expect(within(dialog).getByRole("region", { name: "Step editor" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Notes, step 1, on" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Notes, step 2, off" }),
    ).toBeVisible();
    expect(within(dialog).queryByRole("region", { name: /Piano roll/ })).toBeNull();
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
