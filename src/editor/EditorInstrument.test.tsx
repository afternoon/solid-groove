import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { CommandHistory } from "../commands";
import type { Project } from "../domain/entities";
import { createReferenceProject } from "../domain/fixtures";
import type { TrackId } from "../domain/ids";
import { clickAndFlush } from "../testing/events";
import EditorInstrument from "./EditorInstrument";

afterEach(() => cleanup());

type Scope = () => ReturnType<typeof within>;

function addFromPanel(panel: Scope, label: string) {
  clickAndFlush(panel().getByRole("button", { name: "Add device" }));
  clickAndFlush(panel().getByRole("button", { name: label }));
}

describe("the Instrument view's device chain", () => {
  it("follows the selected track, with no selection of its own", () => {
    const history = new CommandHistory(createReferenceProject());
    const tracks = history.project.song.tracks;
    expect(tracks.length).toBeGreaterThan(1);
    const [project, setProject] = createSignal<Project>(history.project);
    history.subscribe(() => setProject(history.project));
    const [selected, setSelected] = createSignal<TrackId>(tracks[0].id);
    const track = () =>
      project().song.tracks.find((candidate) => candidate.id === selected()) ?? null;
    render(() => (
      <EditorInstrument
        project={project()}
        track={track()}
        drumTrack={null}
        sampleAssets={[]}
        instrument={track()?.instrument ?? null}
        instrumentTrackId={track()?.id ?? null}
        sampleName={null}
        loadSample={() => {}}
        audition={() => {}}
        auditionPad={() => {}}
        onBrowse={() => {}}
        onSelectTrack={(id) => setSelected(id)}
        dispatch={(commands) => history.execute(commands)}
        beginGesture={(gesture) => history.beginGesture(gesture)}
      />
    ));
    const panel = () => within(screen.getByRole("region", { name: "Device chain" }));
    const count = () =>
      within(panel().getByRole("list", { name: "Device chain" })).queryAllByRole(
        "listitem",
      ).length;
    const initial = tracks.map((candidate) => candidate.devices.length);

    addFromPanel(panel, "Reverb");
    expect(project().song.tracks[0].devices).toHaveLength(initial[0] + 1);
    expect(count()).toBe(initial[0] + 1);

    const rail = within(screen.getByRole("list", { name: "Tracks" })).getAllByRole(
      "button",
    );
    clickAndFlush(rail[1]);
    expect(count()).toBe(initial[1]);
    expect(project().song.tracks[1].devices).toHaveLength(initial[1]);
    clickAndFlush(rail[0]);
    expect(count()).toBe(initial[0] + 1);
  });
});
