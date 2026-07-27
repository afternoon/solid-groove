import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

// Dashboard reaches out to useAuth() and the project repository client. Both
// are mocked here so we can drive the error/retry/create-failure UI directly
// without a real Firebase/auth setup.
vi.mock("../auth/AuthProvider", () => ({
	useAuth: () => ({
		user: { uid: "user-1" },
		loading: false,
		isAnonymous: false,
	}),
}));

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	A: (props: { href: string; children?: unknown }) => (
		<a href={props.href}>{props.children as never}</a>
	),
}));

const { listProjects, createProject } = vi.hoisted(() => ({
	listProjects: vi.fn(),
	createProject: vi.fn(),
}));

vi.mock("../projectRepositoryClient", () => ({
	getProjectRepository: () =>
		Promise.resolve({
			listProjects: (...args: unknown[]) => listProjects(...args),
			createProject: (...args: unknown[]) => createProject(...args),
		}),
}));

function renderDashboard() {
	return render(() => <Dashboard />);
}

describe("Dashboard", () => {
	it("shows a retry affordance when the project listing errors", async () => {
		listProjects.mockRejectedValue(new Error("boom"));

		renderDashboard();

		expect(
			await screen.findByText(
				"Something went wrong while loading your projects.",
			),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /try again/i }),
		).toBeInTheDocument();
	});

	it("retries the listing when 'Try again' is clicked", async () => {
		let calls = 0;
		listProjects.mockImplementation(() => {
			calls += 1;
			return calls === 1
				? Promise.reject(new Error("boom"))
				: Promise.resolve([]);
		});

		renderDashboard();

		const retryButton = await screen.findByRole("button", {
			name: /try again/i,
		});
		fireEvent.click(retryButton);

		expect(await screen.findByText("No projects yet")).toBeInTheDocument();
		expect(calls).toBe(2);
	});

	it("renders the listed projects", async () => {
		listProjects.mockResolvedValue([
			{
				id: "prj_abc",
				name: "My Groove",
				schemaVersion: 1,
				revision: 0,
				ownerId: "user-1",
				collaboratorIds: [],
				createdAt: Date.now(),
				modifiedAt: Date.now(),
				template: null,
				genre: null,
				packDependencies: [],
			},
		]);

		renderDashboard();

		expect(await screen.findByText("My Groove")).toBeInTheDocument();
	});

	it("surfaces a message near New Project when project creation fails", async () => {
		listProjects.mockResolvedValue([]);
		createProject.mockResolvedValue({
			ok: false,
			reason: "unavailable",
			message: "nope",
			retryable: true,
		});

		renderDashboard();

		const newProjectButton = await screen.findByRole("button", {
			name: /new project/i,
		});
		fireEvent.click(newProjectButton);

		expect(
			await screen.findByText(
				"Couldn't create a new project. Please try again.",
			),
		).toBeInTheDocument();
		// The button re-enables so the user can try again.
		expect(newProjectButton).not.toBeDisabled();
	});
});
