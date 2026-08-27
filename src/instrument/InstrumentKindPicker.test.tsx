import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import {
  createDrumMachineFixtureProject,
  createSliceFixtureProject,
} from "../domain/fixtures";
import { createSeededIdFactory } from "../domain/ids";
import { clickAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import InstrumentKindPicker from "./InstrumentKindPicker";

afterEach(() => cleanup());

type Dispatch = (
  commands: RawCommandInput | readonly RawCommandInput[],
) => TransactionResult | undefined;

function renderPicker(project: Project, ok = true) {
  const dispatch = vi.fn<Dispatch>(
    () => ({ ok, issues: [] }) as unknown as TransactionResult,
  );
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  const track = project.song.tracks[0];
  render(() => (
    <InstrumentKindPicker
      trackId={track.id}
      project={project}
      instrument={track.instrument}
      dispatch={dispatch}
      analytics={analytics}
      factoryContext={createFactoryContext({
        ids: createSeededIdFactory(224),
        now: 0,
      })}
    />
  ));
  return { dispatch, transport, track };
}

/** The commands of the single transaction the picker dispatched. */
function transaction(dispatch: ReturnType<typeof vi.fn>): RawCommandInput[] {
  expect(dispatch).toHaveBeenCalledTimes(1);
  const commands = dispatch.mock.calls[0][0];
  return Array.isArray(commands) ? commands : [commands];
}

describe("InstrumentKindPicker", () => {
  it("offers every instrument kind and marks the track's current one", () => {
    renderPicker(createSliceFixtureProject());
    expect(
      (screen.getByRole("radio", { name: "Sampler" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "Synth" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByRole("radio", { name: "Drum machine" })).toBeVisible();
  });

  it("changes the instrument in one transaction and reports the new type", () => {
    const { dispatch, transport, track } = renderPicker(createSliceFixtureProject());
    clickAndFlush(screen.getByRole("radio", { name: "Synth" }));

    const commands = transaction(dispatch);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "instrument.change",
      payload: { trackId: track.id, instrument: { kind: "synth" } },
    });

    const changed = transport.named("instrument_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].params.instrument_type).toBe("synth");
    expect(
      transport
        .named("feature_first_use")
        .filter((event) => event.params.feature === "synth"),
    ).toHaveLength(1);
  });

  it("gives a new drum machine pads to load sounds into", () => {
    const { dispatch } = renderPicker(createSliceFixtureProject());
    clickAndFlush(screen.getByRole("radio", { name: "Drum machine" }));

    const command = transaction(dispatch)[0] as {
      payload: { instrument: { kind: string; pads: readonly unknown[] } };
    };
    expect(command.payload.instrument.kind).toBe("drumMachine");
    expect(command.payload.instrument.pads.length).toBeGreaterThan(0);
  });

  it("does nothing when the track's current kind is picked again", () => {
    const { dispatch, transport } = renderPicker(createSliceFixtureProject());
    clickAndFlush(screen.getByRole("radio", { name: "Sampler" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(transport.events).toHaveLength(0);
  });

  it("confirms before leaving a drum machine whose clips hold pad hits", () => {
    const { dispatch, transport } = renderPicker(createDrumMachineFixtureProject());
    clickAndFlush(screen.getByRole("radio", { name: "Synth" }));

    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();

    clickAndFlush(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect(transport.events).toHaveLength(0);
  });

  it("deletes the stranded hits in the same transaction once confirmed", () => {
    const project = createDrumMachineFixtureProject();
    const { dispatch, transport } = renderPicker(project);
    clickAndFlush(screen.getByRole("radio", { name: "Synth" }));
    clickAndFlush(screen.getByRole("button", { name: "Change instrument" }));

    const commands = transaction(dispatch);
    expect(commands.length).toBeGreaterThan(1);
    expect(commands.slice(0, -1).map((command) => command.type)).toEqual(
      commands.slice(0, -1).map(() => "note.remove"),
    );
    expect(commands.at(-1)).toMatchObject({
      type: "instrument.change",
      payload: { instrument: { kind: "synth" } },
    });
    expect(transport.named("instrument_changed")).toHaveLength(1);
  });

  it("reports nothing when the transaction is rejected", () => {
    const { transport } = renderPicker(createSliceFixtureProject(), false);
    clickAndFlush(screen.getByRole("radio", { name: "Synth" }));
    expect(transport.events).toHaveLength(0);
  });
});
