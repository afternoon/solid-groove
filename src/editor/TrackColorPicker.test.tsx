import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { CommandHistory, type RawCommandInput } from "../commands";
import type { Track } from "../domain/entities";
import { createSliceFixtureProject } from "../domain/fixtures";
import { TRACK_PALETTE as PALETTE } from "../domain/trackPalette";
import { clickAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import TrackColorPicker from "./TrackColorPicker";

afterEach(cleanup);

/** The palette, read as colours rather than as its literal tuple. */
const TRACK_COLORS: readonly string[] = PALETTE;

function renderPicker(analyticsOn = true) {
  const history = new CommandHistory(createSliceFixtureProject());
  const [project, setProject] = createSignal(history.project);
  const trackId = history.project.song.tracks[0]?.id;
  const track = () => project().song.tracks.find((t) => t.id === trackId) as Track;
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (!analyticsOn) consent.set({ productAnalytics: false });
  const analytics = new Analytics({ transport, consent, storage: memoryStorage() });
  analytics.setAccountType("anonymous");
  render(() => (
    <TrackColorPicker
      track={track()}
      analytics={analytics}
      dispatch={(commands: RawCommandInput | readonly RawCommandInput[]) => {
        const result = history.execute(commands);
        setProject(history.project);
        return result;
      }}
    />
  ));
  const swatch = () => screen.getByRole("button", { name: `Colour for ${track().name}` });
  return { history, track, transport, swatch };
}

/** A real pointer click (`detail: 1`), which is what closes the menu. */
async function pick(name: string) {
  await userEvent.click(screen.getByRole("radio", { name }));
  flush();
}

/** A palette colour the track does not already have. */
const otherColor = (track: Track) =>
  TRACK_COLORS.find((c) => c !== track.color) as string;

describe("TrackColorPicker (#447)", () => {
  it("is the swatch, and opens the palette with the current colour checked", () => {
    const { track, swatch } = renderPicker();
    expect(swatch()).toHaveStyle({ background: track().color });
    expect(swatch()).toHaveAttribute("aria-expanded", "false");

    clickAndFlush(swatch());

    expect(swatch()).toHaveAttribute("aria-expanded", "true");
    const palette = screen.getByRole("group", { name: `Colour for ${track().name}` });
    const items = within(palette).getAllByRole("radio");
    expect(items).toHaveLength(50);
    const checked = items.filter((item) => (item as HTMLInputElement).checked);
    expect(checked).toHaveLength(TRACK_COLORS.includes(track().color) ? 1 : 0);
  });

  it("recolours the track as one undoable edit, and marks first use once", async () => {
    const { history, track, transport, swatch } = renderPicker();
    const before = track().color;
    const next = otherColor(track());

    clickAndFlush(swatch());
    const index = TRACK_COLORS.indexOf(next);
    await pick(`Colour ${index + 1} of 50`);

    expect(track().color).toBe(next);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    clickAndFlush(swatch());
    await pick("Colour 1 of 50");
    expect(transport.named("feature_first_use")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ feature: "track_color" }),
      }),
    ]);

    history.undo();
    history.undo();
    expect(history.project.song.tracks.find((t) => t.id === track().id)?.color).toBe(
      before,
    );
  });

  it("offers 50 swatches, and marks the chosen one checked on reopen", async () => {
    const { track, swatch } = renderPicker();
    clickAndFlush(swatch());
    const palette = screen.getByRole("group", { name: `Colour for ${track().name}` });
    expect(within(palette).getAllByRole("radio")).toHaveLength(50);
    await pick("Colour 23 of 50");

    clickAndFlush(swatch());
    const checked = screen
      .getAllByRole("radio", { checked: true })
      .map((b) => b.getAttribute("aria-label"));
    expect(checked).toEqual(["Colour 23 of 50"]);
  });

  it("recolours the same with analytics off", async () => {
    const { track, transport, swatch } = renderPicker(false);
    const next = otherColor(track());
    clickAndFlush(swatch());
    await pick(`Colour ${TRACK_COLORS.indexOf(next) + 1} of 50`);
    expect(track().color).toBe(next);
    expect(transport.named("feature_first_use")).toEqual([]);
  });

  it("closes on a press outside, and changes nothing", () => {
    const { history, swatch } = renderPicker();
    clickAndFlush(swatch());
    fireEvent.pointerDown(document.body);
    flush();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(history.canUndo).toBe(false);
  });

  it("closes on Escape, back on the swatch, and changes nothing", () => {
    const { history, swatch } = renderPicker();
    clickAndFlush(swatch());
    fireEvent.keyDown(window, { key: "Escape" });
    flush();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(swatch()).toHaveFocus();
    expect(history.canUndo).toBe(false);
  });

  it("is one Tab stop, and arrow keys move and choose between swatches", async () => {
    const user = userEvent.setup();
    const { history, track, swatch } = renderPicker();
    await user.click(swatch());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    // The menu opens with focus inside the group, on the current colour.
    expect(radios).toContain(document.activeElement);
    const at = radios.indexOf(document.activeElement as HTMLInputElement);

    // One Tab stop: Tab leaves the group rather than walking 50 swatches.
    await user.tab();
    expect(radios).not.toContain(document.activeElement);
    radios[at]?.focus();

    const before = track().color;
    await user.keyboard("{ArrowRight}");
    flush();
    expect(radios[at + 1]).toHaveFocus();
    expect(radios[at + 1]?.checked).toBe(true);
    expect(track().color).toBe(TRACK_COLORS[at + 1]);
    // An arrow chooses and keeps the menu open; the choice is one undo entry.
    expect(screen.getByRole("group")).toBeInTheDocument();
    history.undo();
    expect(history.project.song.tracks.find((t) => t.id === track().id)?.color).toBe(
      before,
    );
    expect(history.canUndo).toBe(false);
  });
});
