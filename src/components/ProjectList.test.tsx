import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectMetadata } from "../domain/entities";
import {
	createFactoryContext,
	createProjectMetadata,
} from "../domain/factories";
import ProjectList from "./ProjectList";

afterEach(() => cleanup());

function makeProjectMetadata(
	overrides: Partial<ProjectMetadata> = {},
): ProjectMetadata {
	const context = createFactoryContext();
	return {
		...createProjectMetadata(context, { ownerId: "user-1" }),
		...overrides,
	};
}

// ProjectList links to project routes with <A>, which needs a matched Route
// context to resolve against — a bare MemoryRouter isn't enough.
function renderWithRouter(projects: ProjectMetadata[]) {
	return render(() => (
		<MemoryRouter>
			<Route path="/" component={() => <ProjectList projects={projects} />} />
		</MemoryRouter>
	));
}

describe("ProjectList", () => {
	it("shows a friendly empty state when there are no projects", () => {
		renderWithRouter([]);

		expect(screen.getByText("No projects yet")).toBeInTheDocument();
		expect(
			screen.getByText("Create your first one to get started."),
		).toBeInTheDocument();
	});

	it("renders a card per project when projects are present", () => {
		renderWithRouter([makeProjectMetadata({ name: "My Groove" })]);

		expect(screen.getByText("My Groove")).toBeInTheDocument();
		expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
	});
});
