import { createRouter, memoryHistory } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectMetadata } from "../domain/entities";
import { createFactoryContext, createProjectMetadata } from "../domain/factories";
import { clickAndFlush } from "../testing/events";
import ProjectList, { type ProjectActionResult } from "./ProjectList";

afterEach(() => cleanup());

// Solid 2 batches writes: a handler's `setState` is invisible to the DOM — and
// to the next handler's own reads — until the batch flushes on the microtask.
// The DOM testing library's `fireEvent` does no flushing of its own the way
// Solid 1's testing-library wrapper did, so each `fireEvent` below that a
// later line depends on is followed by an explicit `flush()`.

function makeProjectMetadata(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  const context = createFactoryContext();
  return {
    ...createProjectMetadata(context, { ownerId: "user-1" }),
    ...overrides,
  };
}

// ProjectList links to project routes with a plain <a>, which router 2 claims
// and resolves against the matched route — so the list still needs to render
// inside a router. Router 2 has no component API (`<MemoryRouter>`/`<Route>`
// are gone): `createRouter` is the only way to build one, and `memoryHistory`
// keeps the location out of jsdom's global.
function renderWithRouter(
  projects: ProjectMetadata[],
  handlers: {
    onRename?: (
      id: string,
      name: string,
    ) => Promise<ProjectActionResult> | ProjectActionResult;
    onDuplicate?: (id: string) => Promise<ProjectActionResult> | ProjectActionResult;
    onDelete?: (id: string) => Promise<ProjectActionResult> | ProjectActionResult;
  } = {},
) {
  const Router = createRouter({
    history: memoryHistory("/"),
    routes: [
      {
        path: "/",
        component: () => (
          <ProjectList
            projects={projects}
            onRename={handlers.onRename}
            onDuplicate={handlers.onDuplicate}
            onDelete={handlers.onDelete}
          />
        ),
      },
    ],
  });
  return render(() => <Router />);
}

describe("ProjectList", () => {
  it("shows a friendly empty state when there are no projects", () => {
    renderWithRouter([]);

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("Create your first one to get started.")).toBeInTheDocument();
  });

  it("renders a card per project when projects are present", () => {
    renderWithRouter([makeProjectMetadata({ name: "My Groove" })]);

    expect(screen.getByText("My Groove")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
  });

  it("shows last-modified time and the template/genre badges when present", () => {
    renderWithRouter([
      makeProjectMetadata({
        name: "House Jam",
        modifiedAt: Date.now(),
        template: "starter",
        genre: "house",
      }),
    ]);

    expect(screen.getByText(/Edited/)).toBeInTheDocument();
    expect(screen.getByText("starter")).toBeInTheDocument();
    expect(screen.getByText("house")).toBeInTheDocument();
  });

  it("renames a project via the inline form", async () => {
    const project = makeProjectMetadata({ name: "Old Name" });
    const onRename = vi.fn().mockResolvedValue({ ok: true });
    renderWithRouter([project], { onRename });

    clickAndFlush(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /rename old name/i });
    fireEvent.input(input, { target: { value: "New Name" } });
    flush();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith(project.id, "New Name"));
  });

  it("cancels the rename form without calling onRename", () => {
    const project = makeProjectMetadata({ name: "Old Name" });
    const onRename = vi.fn();
    renderWithRouter([project], { onRename });

    clickAndFlush(screen.getByRole("button", { name: /rename/i }));
    clickAndFlush(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Old Name")).toBeInTheDocument();
  });

  it("shows an inline error when rename fails", async () => {
    const project = makeProjectMetadata({ name: "Old Name" });
    const onRename = vi.fn().mockResolvedValue({
      ok: false,
      message: "Someone else changed this project first.",
    });
    renderWithRouter([project], { onRename });

    clickAndFlush(screen.getByRole("button", { name: /rename/i }));
    fireEvent.input(screen.getByRole("textbox", { name: /rename old name/i }), {
      target: { value: "New Name" },
    });
    flush();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText("Someone else changed this project first."),
    ).toBeInTheDocument();
  });

  it("calls onDuplicate when Duplicate is clicked", async () => {
    const project = makeProjectMetadata({ name: "My Groove" });
    const onDuplicate = vi.fn().mockResolvedValue({ ok: true });
    renderWithRouter([project], { onDuplicate });

    fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));

    await vi.waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(project.id));
  });

  describe("delete confirmation", () => {
    it("opens a confirmation dialog and does not call onDelete before it is confirmed", () => {
      const project = makeProjectMetadata({ name: "My Groove" });
      const onDelete = vi.fn();
      renderWithRouter([project], { onDelete });

      clickAndFlush(screen.getByRole("button", { name: /^delete$/i }));

      expect(
        screen.getByRole("alertdialog", { name: /delete this project/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/"My Groove" will be permanently deleted/),
      ).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });

    it("calls onDelete only after the dialog is confirmed", async () => {
      const project = makeProjectMetadata({ name: "My Groove" });
      const onDelete = vi.fn().mockResolvedValue({ ok: true });
      renderWithRouter([project], { onDelete });

      clickAndFlush(screen.getByRole("button", { name: /^delete$/i }));
      const dialog = screen.getByRole("alertdialog", {
        name: /delete this project/i,
      });
      fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

      await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(project.id));
    });

    it("dismisses the dialog and calls nothing when cancelled", () => {
      const project = makeProjectMetadata({ name: "My Groove" });
      const onDelete = vi.fn();
      renderWithRouter([project], { onDelete });

      clickAndFlush(screen.getByRole("button", { name: /^delete$/i }));
      clickAndFlush(screen.getByRole("button", { name: /^cancel$/i }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
