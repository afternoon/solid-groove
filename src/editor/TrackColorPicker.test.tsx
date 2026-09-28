import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { CommandHistory, type RawCommandInput } from "../commands";
import type { Track } from "../domain/entities";
import { TRACK_COLORS as PALETTE } from "../domain/factories";
import { createSliceFixtureProject } from "../domain/fixtures";
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
    const items = within(palette).getAllByRole("button");
    expect(items).toHaveLength(TRACK_COLORS.length);
    const checked = items.filter((item) => item.getAttribute("aria-pressed") === "true");
    expect(checked).toHaveLength(TRACK_COLORS.includes(track().color) ? 1 : 0);
  });

  it("recolours the track as one undoable edit, and marks first use once", () => {
    const { history, track, transport, swatch } = renderPicker();
    const before = track().color;
    const next = otherColor(track());

    clickAndFlush(swatch());
    const index = TRACK_COLORS.indexOf(next);
    clickAndFlush(screen.getByRole("button", { name: `Colour ${index + 1}` }));

    expect(track().color).toBe(next);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    clickAndFlush(swatch());
    clickAndFlush(screen.getByRole("button", { name: "Colour 1" }));
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

  it("recolours the same with analytics off", () => {
    const { track, transport, swatch } = renderPicker(false);
    const next = otherColor(track());
    clickAndFlush(swatch());
    clickAndFlush(
      screen.getByRole("button", {
        name: `Colour ${TRACK_COLORS.indexOf(next) + 1}`,
      }),
    );
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
});
