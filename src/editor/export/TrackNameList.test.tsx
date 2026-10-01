import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireAndFlush } from "../../testing/events";
import TrackNameList, { type TrackNameListProps } from "./TrackNameList";
import type { TrackLaneView } from "./trackLanes";

afterEach(cleanup);

const row = (over: Partial<TrackLaneView> & { id: string }): TrackLaneView => ({
  name: over.id.toUpperCase(),
  color: "#ff8800",
  muted: false,
  fixed: false,
  included: true,
  picked: false,
  lanes: [],
  ...over,
});

const rows = [
  row({ id: "a", name: "Kick" }),
  row({ id: "b", name: "Bass", included: false, muted: true }),
  row({ id: "c", name: "Lead", picked: true }),
];

function renderList(props: Partial<TrackNameListProps> = {}) {
  const onRowClick = vi.fn();
  render(() => <TrackNameList rows={rows} onRowClick={onRowClick} {...props} />);
  return { onRowClick };
}

describe("TrackNameList", () => {
  it("is a multi-select listbox of options that say whether each is included", () => {
    renderList();
    const list = screen.getByRole("listbox", { name: "Tracks to export" });
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("option", { name: "Kick, included" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bass, left out" })).toBeInTheDocument();
    expect(screen.getByText("OFF")).toBeInTheDocument();
    expect(screen.getAllByText("ON")).toHaveLength(2);
  });

  it("marks picked rows aria-selected and colours each bar from the track", () => {
    renderList();
    expect(screen.getByRole("option", { name: "Lead, included" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const kick = screen.getByRole("option", { name: "Kick, included" });
    expect(kick).toHaveAttribute("aria-selected", "false");
    expect(kick.style.getPropertyValue("--track-ink")).toBe("#ff8800");
  });

  it("reports the clicked row and its modifiers", () => {
    const { onRowClick } = renderList();
    const bass = screen.getByRole("option", { name: "Bass, left out" });
    fireAndFlush(() => fireEvent.click(bass));
    fireAndFlush(() => fireEvent.click(bass, { shiftKey: true }));
    fireAndFlush(() => fireEvent.click(bass, { ctrlKey: true }));
    fireAndFlush(() => fireEvent.click(bass, { metaKey: true, shiftKey: true }));
    expect(onRowClick.mock.calls).toEqual([
      [1, { shift: false, meta: false }],
      [1, { shift: true, meta: false }],
      [1, { shift: false, meta: true }],
      [1, { shift: true, meta: true }],
    ]);
  });

  it("names the focused row as the active descendant and reports list focus", () => {
    const onFocusChange = vi.fn();
    renderList({ focusId: "b", onFocusChange });
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Bass, left out" }).id,
    );
    list.focus();
    list.blur();
    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
  });

  it("is read-only in stereo mode: MIX, M for a muted track, no clicks", () => {
    const { onRowClick } = renderList({ readOnly: true });
    expect(screen.getByRole("option", { name: "Kick, in the mix" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const bass = screen.getByRole("option", { name: "Bass, muted, not in the mix" });
    expect(screen.getAllByText("MIX")).toHaveLength(2);
    expect(screen.getByText("M")).toBeInTheDocument();
    fireAndFlush(() => fireEvent.click(bass));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("ignores clicks while an export is running", () => {
    const { onRowClick } = renderList({ disabled: true });
    fireAndFlush(() =>
      fireEvent.click(screen.getByRole("option", { name: "Kick, included" })),
    );
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
