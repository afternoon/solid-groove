import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { ProjectMetadata } from "../domain/entities";
import { memoryStorage } from "../testing/storage";
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

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({
	useNavigate: () => navigate,
	A: (props: { href: string; children?: unknown }) => (
		<a href={props.href}>{props.children as never}</a>
	),
}));

const {
	listProjects,
	createProject,
	saveMetadata,
	loadProject,
	deleteProject,
} = vi.hoisted(() => ({
	listProjects: vi.fn(),
	createProject: vi.fn(),
	saveMetadata: vi.fn(),
	loadProject: vi.fn(),
	deleteProject: vi.fn(),
}));

vi.mock("../projectRepositoryClient", () => ({
	getProjectRepository: () =>
		Promise.resolve({
			listProjects: (...args: unknown[]) => listProjects(...args),
			createProject: (...args: unknown[]) => createProject(...args),
			saveMetadata: (...args: unknown[]) => saveMetadata(...args),
			loadProject: (...args: unknown[]) => loadProject(...args),
			deleteProject: (...args: unknown[]) => deleteProject(...args),
		}),
}));

function makeMetadata(
	overrides: Partial<ProjectMetadata> = {},
): ProjectMetadata {
	return {
		id: "prj_abc" as ProjectMetadata["id"],
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
		...overrides,
	};
}

function renderDashboard() {
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	render(() => <Dashboard analytics={analytics} />);
	return { transport };
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
		listProjects.mockResolvedValue([makeMetadata()]);

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

	describe("creation", () => {
		it("creates an audible starter and logs project_created(source: template)", async () => {
			listProjects.mockResolvedValue([]);
			createProject.mockResolvedValue({
				ok: true,
				revision: 0,
				modifiedAt: Date.now(),
			});
			const { transport } = renderDashboard();

			fireEvent.click(
				await screen.findByRole("button", { name: /^new project$/i }),
			);

			await vi.waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
			const created = createProject.mock.calls[0][0];
			expect(created.song.tracks.length).toBeGreaterThan(0);
			expect(transport.named("project_created")).toHaveLength(1);
			expect(transport.named("project_created")[0]?.params).toMatchObject({
				source: "template",
			});
			expect(navigate).toHaveBeenCalledWith(`/projects/${created.metadata.id}`);
		});

		it("creates a genuinely empty project and logs project_created(source: blank)", async () => {
			listProjects.mockResolvedValue([]);
			createProject.mockResolvedValue({
				ok: true,
				revision: 0,
				modifiedAt: Date.now(),
			});
			const { transport } = renderDashboard();

			fireEvent.click(
				await screen.findByRole("button", { name: /blank project/i }),
			);

			await vi.waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
			const created = createProject.mock.calls[0][0];
			expect(created.song.tracks).toHaveLength(0);
			expect(transport.named("project_created")[0]?.params).toMatchObject({
				source: "blank",
			});
		});
	});

	describe("rename", () => {
		it("renames a project and reflects the new name", async () => {
			listProjects.mockResolvedValue([makeMetadata({ revision: 3 })]);
			saveMetadata.mockResolvedValue({
				ok: true,
				revision: 4,
				modifiedAt: Date.now(),
			});
			renderDashboard();

			fireEvent.click(await screen.findByRole("button", { name: /rename/i }));
			const input = screen.getByRole("textbox", { name: /rename my groove/i });
			fireEvent.input(input, { target: { value: "Renamed Groove" } });
			fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

			await screen.findByText("Renamed Groove");
			expect(saveMetadata).toHaveBeenCalledWith(
				"prj_abc",
				{ name: "Renamed Groove" },
				3,
			);
		});

		it("shows an inline error and keeps editing when rename fails", async () => {
			listProjects.mockResolvedValue([makeMetadata()]);
			saveMetadata.mockResolvedValue({
				ok: false,
				reason: "revision_conflict",
				message: "Someone else changed this project first.",
				retryable: false,
			});
			renderDashboard();

			fireEvent.click(await screen.findByRole("button", { name: /rename/i }));
			fireEvent.input(
				screen.getByRole("textbox", { name: /rename my groove/i }),
				{
					target: { value: "New name" },
				},
			);
			fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

			expect(
				await screen.findByText("Someone else changed this project first."),
			).toBeInTheDocument();
		});
	});

	describe("duplicate", () => {
		it("duplicates a project, adds it to the list, and logs project_created(source: duplicate)", async () => {
			const original = makeMetadata();
			listProjects.mockResolvedValue([original]);
			loadProject.mockResolvedValue({
				ok: true,
				value: {
					metadata: original,
					song: {
						tempo: 120,
						timeSignature: { numerator: 4, denominator: 4 },
						tracks: [],
						returns: [],
						master: { volume: 0, devices: [] },
						sections: [],
						placements: [],
						automation: [],
						assets: [],
					},
					clips: [],
				},
			});
			createProject.mockResolvedValue({
				ok: true,
				revision: 0,
				modifiedAt: Date.now(),
			});
			const { transport } = renderDashboard();

			fireEvent.click(
				await screen.findByRole("button", { name: /duplicate/i }),
			);

			await vi.waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
			expect(await screen.findByText("My Groove copy")).toBeInTheDocument();
			// The original stays, so the list now shows both.
			expect(screen.getAllByText(/My Groove/)).toHaveLength(2);
			expect(transport.named("project_created")[0]?.params).toMatchObject({
				source: "duplicate",
			});
		});
	});

	describe("delete", () => {
		it("requires confirmation before deleting", async () => {
			listProjects.mockResolvedValue([makeMetadata()]);
			renderDashboard();

			fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));

			expect(
				screen.getByRole("alertdialog", { name: /delete this project/i }),
			).toBeInTheDocument();
			expect(deleteProject).not.toHaveBeenCalled();
		});

		it("keeps the project when the confirmation is cancelled", async () => {
			listProjects.mockResolvedValue([makeMetadata()]);
			renderDashboard();

			fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
			fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

			expect(deleteProject).not.toHaveBeenCalled();
			expect(await screen.findByText("My Groove")).toBeInTheDocument();
		});

		it("deletes after confirmation and logs project_deleted", async () => {
			listProjects.mockResolvedValue([makeMetadata()]);
			deleteProject.mockResolvedValue(undefined);
			const { transport } = renderDashboard();

			fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
			const dialog = screen.getByRole("alertdialog", {
				name: /delete this project/i,
			});
			fireEvent.click(
				within(dialog).getByRole("button", { name: /^delete$/i }),
			);

			await vi.waitFor(() =>
				expect(deleteProject).toHaveBeenCalledWith("prj_abc"),
			);
			expect(await screen.findByText("No projects yet")).toBeInTheDocument();
			expect(transport.named("project_deleted")).toHaveLength(1);
		});
	});
});
