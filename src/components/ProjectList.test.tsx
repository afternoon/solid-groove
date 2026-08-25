import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectMetadata } from "../domain/entities";
import { createFactoryContext, createProjectMetadata } from "../domain/factories";
import ProjectList, { type ProjectActionResult } from "./ProjectList";

afterEach(() => cleanup());

function makeProjectMetadata(overrides: Partial<ProjectMetadata> = {}): ProjectMetadata {
  const context = createFactoryContext();
  return {
    ...createProjectMetadata(context, { ownerId: "user-1" }),
    ...overrides,
  };
}

// ProjectList links to project routes with <A>, which needs a matched Route
// context to resolve against — a bare MemoryRouter isn't enough.
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
  return render(() => (
    <MemoryRouter>
      <Route
        path="/"
        component={() => (
          <ProjectList
            projects={projects}
            onRename={handlers.onRename}
            onDuplicate={handlers.onDuplicate}
            onDelete={handlers.onDelete}
          />
        )}
      />
    </MemoryRouter>
  ));
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

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /rename old name/i });
    fireEvent.input(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith(project.id, "New Name"));
  });

  it("cancels the rename form without calling onRename", () => {
    const project = makeProjectMetadata({ name: "Old Name" });
    const onRename = vi.fn();
    renderWithRouter([project], { onRename });

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

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

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    fireEvent.input(screen.getByRole("textbox", { name: /rename old name/i }), {
      target: { value: "New Name" },
    });
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

      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

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

      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
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

      fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
