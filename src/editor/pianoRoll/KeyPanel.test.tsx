import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import { executeCommand } from "../../commands";
import { createPianoRollFixtureProject } from "../../domain/fixtures";
import { clickAndFlush } from "../../testing/events";
import { memoryStorage } from "../../testing/storage";
import KeyPanel, { keyName } from "./KeyPanel";

afterEach(() => cleanup());

/** A Key panel over a project signal, applying its commands as the editor would. */
function renderPanel(options: { analyticsEnabled?: boolean } = {}) {
  const [project, setProject] = createSignal(createPianoRollFixtureProject());
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (options.analyticsEnabled === false) consent.optOut();
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  analytics.setAccountType("anonymous");
  render(() => (
    <KeyPanel
      musicalKey={project().song.key}
      analytics={analytics}
      dispatch={(command) => {
        const result = executeCommand(project(), command as never);
        if (result.ok) setProject(result.project);
        return result;
      }}
    />
  ));
  const keyEvents = () =>
    transport.events.filter((event) => event.name === "key_changed");
  return { project, keyEvents };
}

const panel = () => screen.getByRole("region", { name: "Key" });
const roots = () => within(panel()).getByRole("group", { name: "Root" });
const scaleButton = (name: string) =>
  within(within(panel()).getByRole("group", { name: "Scale" })).getByRole("button", {
    name,
  });

describe("key panel", () => {
  it("names a key the way the readout shows it", () => {
    expect(keyName({ root: 0, scale: "chromatic" })).toBe("Chromatic");
    expect(keyName({ root: 0, scale: "minor" })).toBe("C minor");
    expect(keyName({ root: 6, scale: "harmonic_minor" })).toBe("F♯ harmonic minor");
  });

  it("starts chromatic, with the root pad off", () => {
    renderPanel();
    expect(within(panel()).getByRole("status")).toHaveTextContent("Chromatic");
    const buttons = within(roots()).getAllByRole("button");
    expect(buttons).toHaveLength(12);
    for (const button of buttons) expect(button).toBeDisabled();
    expect(scaleButton("Chromatic")).toHaveAttribute("aria-pressed", "true");
    expect(within(panel()).getByRole("group", { name: "Scale" }).children).toHaveLength(
      9,
    );
  });

  it("chooses a scale on C, then a root, saving each on the song", () => {
    const { project, keyEvents } = renderPanel();

    clickAndFlush(scaleButton("Minor"));
    expect(project().song.key).toEqual({ root: 0, scale: "minor" });
    expect(within(panel()).getByRole("status")).toHaveTextContent("C minor");
    expect(within(roots()).getByRole("button", { name: "C" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    clickAndFlush(within(roots()).getByRole("button", { name: "A" }));
    expect(project().song.key).toEqual({ root: 9, scale: "minor" });
    clickAndFlush(scaleButton("Dorian"));
    expect(project().song.key).toEqual({ root: 9, scale: "dorian" });
    expect(keyEvents().map((event) => event.params.scale)).toEqual([
      "minor",
      "minor",
      "dorian",
    ]);
  });

  it("puts the root back on C when chromatic is chosen again", () => {
    const { project, keyEvents } = renderPanel();
    clickAndFlush(scaleButton("Major"));
    clickAndFlush(within(roots()).getByRole("button", { name: "D" }));
    clickAndFlush(scaleButton("Chromatic"));
    expect(project().song.key).toEqual({ root: 0, scale: "chromatic" });
    // Choosing the key it already has is not a change.
    clickAndFlush(scaleButton("Chromatic"));
    expect(keyEvents()).toHaveLength(3);
  });

  it("changes the key the same way with analytics off", () => {
    const { project, keyEvents } = renderPanel({ analyticsEnabled: false });
    clickAndFlush(scaleButton("Blues"));
    flush();
    expect(project().song.key.scale).toBe("blues");
    expect(keyEvents()).toHaveLength(0);
  });
});
