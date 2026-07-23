import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

// Dashboard reaches out to useAuth() and the dataService singleton. Both are
// mocked here so we can drive the error/retry/create-failure UI directly
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

const { subscribeToUserProjects, createProject } = vi.hoisted(() => ({
	subscribeToUserProjects: vi.fn(),
	createProject: vi.fn(),
}));

vi.mock("../model/dataService", () => ({
	dataService: {
		subscribeToUserProjects: (...args: unknown[]) =>
			subscribeToUserProjects(...args),
		createProject: (...args: unknown[]) => createProject(...args),
	},
}));

function renderDashboard() {
	return render(() => <Dashboard />);
}

describe("Dashboard", () => {
	it("shows a retry affordance when the project subscription errors", async () => {
		subscribeToUserProjects.mockImplementation(
			(
				_userId: string,
				_onProjects: (projects: unknown[]) => void,
				onError?: (error: unknown) => void,
			) => {
				onError?.(new Error("boom"));
				return () => {};
			},
		);

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

	it("retries the subscription when 'Try again' is clicked", async () => {
		let calls = 0;
		subscribeToUserProjects.mockImplementation(
			(
				_userId: string,
				onProjects: (projects: unknown[]) => void,
				onError?: (error: unknown) => void,
			) => {
				calls += 1;
				if (calls === 1) {
					onError?.(new Error("boom"));
				} else {
					onProjects([]);
				}
				return () => {};
			},
		);

		renderDashboard();

		const retryButton = await screen.findByRole("button", {
			name: /try again/i,
		});
		fireEvent.click(retryButton);

		expect(await screen.findByText("No projects yet")).toBeInTheDocument();
		expect(calls).toBe(2);
	});

	it("still renders a working subscription without an error callback", async () => {
		// Simulates dataService before the third onError argument existed.
		subscribeToUserProjects.mockImplementation(
			(_userId: string, onProjects: (projects: unknown[]) => void) => {
				onProjects([]);
				return () => {};
			},
		);

		renderDashboard();

		expect(await screen.findByText("No projects yet")).toBeInTheDocument();
	});

	it("surfaces a message near New Project when project creation fails", async () => {
		subscribeToUserProjects.mockImplementation(
			(_userId: string, onProjects: (projects: unknown[]) => void) => {
				onProjects([]);
				return () => {};
			},
		);
		createProject.mockRejectedValue(new Error("nope"));

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
