import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";

afterEach(() => cleanup());

describe("toolbar", () => {
  function renderToolbar(overrides: Partial<Parameters<typeof Toolbar>[0]> = {}) {
    const props = {
      selectionCount: 0,
      onSelectAll: vi.fn(),
      onDelete: vi.fn(),
      preview: true,
      onTogglePreview: vi.fn(),
      soloed: false,
      onToggleSolo: vi.fn(),
      zoom: 1,
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      playing: false,
      onTogglePlay: vi.fn(),
      ...overrides,
    };
    render(() => <Toolbar {...props} />);
    return props;
  }

  it("counts the selection and only deletes when there is one", () => {
    renderToolbar();
    expect(screen.getByText("None selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    cleanup();
    const props = renderToolbar({ selectionCount: 2 });
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledOnce();
  });

  it("shows the zoom as a percentage and stops at either end", () => {
    const props = renderToolbar({ zoom: 2 });
    expect(screen.getByText("200%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(props.onZoomOut).toHaveBeenCalledOnce();
  });

  it("toggles preview and plays or stops", () => {
    const props = renderToolbar({ playing: true });
    expect(screen.getByRole("button", { name: "Preview sound" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(props.onTogglePlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(props.onSelectAll).toHaveBeenCalledOnce();
  });

  it("shows and toggles the track's solo (#657)", () => {
    const props = renderToolbar({ soloed: true });
    const solo = screen.getByRole("button", { name: "Solo" });
    expect(solo).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(solo);
    expect(props.onToggleSolo).toHaveBeenCalledOnce();
  });
});
