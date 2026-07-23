import { MemoryRouter, Route } from "@solidjs/router";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { Timestamp } from "firebase/firestore";
import { afterEach, describe, expect, it } from "vitest";
import { newProject } from "../model/newProject";
import type { Project } from "../model/types";
import ProjectList from "./ProjectList";

afterEach(() => cleanup());

function makeProject(overrides: Partial<Project> = {}): Project {
	return {
		id: "project-1",
		createdAt: Timestamp.now(),
		...newProject("user-1"),
		...overrides,
	};
}

// ProjectList links to project routes with <A>, which needs a matched Route
// context to resolve against — a bare MemoryRouter isn't enough.
function renderWithRouter(projects: Project[]) {
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
		renderWithRouter([makeProject({ name: "My Groove" })]);

		expect(screen.getByText("My Groove")).toBeInTheDocument();
		expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
	});
});
