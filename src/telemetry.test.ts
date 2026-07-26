import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, analytics } from "./analytics/analytics";
import { ConsentStore } from "./analytics/consent";
import {
	createFailingTransport,
	createRecordingTransport,
	noopTransport,
} from "./analytics/transport";
import { updateTrack } from "./commands";
import { createCommandHistory } from "./commands/history";
import { createCommandTestProject } from "./commands/testProjects";
import { ErrorReporter, type ErrorSink } from "./monitoring/errorReporting";
import { ProjectAutosave } from "./persistence/autosave";
import { InMemoryProjectRepository } from "./persistence/inMemoryProjectRepository";
import { createManualScheduler } from "./shared/scheduler";
import { afterFirstPaint, initTelemetry, surfaceForPath } from "./telemetry";
import { memoryStorage } from "./testing/storage";

/** A target with no real `window` behind it. */
function fakeTarget() {
	const listeners = new Map<string, Set<EventListener>>();
	return {
		addEventListener(type: string, listener: EventListener) {
			const set = listeners.get(type) ?? new Set();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: EventListener) {
			listeners.get(type)?.delete(listener);
		},
		total() {
			return [...listeners.values()].reduce((n, set) => n + set.size, 0);
		},
	};
}

/** Collects the tasks `initTelemetry` defers, so a test can decide when to run. */
function deferredPaint() {
	const tasks: (() => void)[] = [];
	return {
		schedule: (task: () => void) => void tasks.push(task),
		get pending() {
			return tasks.length;
		},
		flush() {
			for (const task of tasks.splice(0, tasks.length)) task();
		},
	};
}

beforeEach(() => {
	// The analytics boundary is an app-wide singleton; reset the transport so
	// one test's events cannot be observed by the next.
	analytics.setTransport(noopTransport);
});

describe("surfaceForPath", () => {
	it("maps each route onto its surface", () => {
		expect(surfaceForPath("/")).toBe("landing");
		expect(surfaceForPath("")).toBe("landing");
		expect(surfaceForPath("/dashboard")).toBe("dashboard");
		expect(surfaceForPath("/projects/prj_abc")).toBe("editor");
	});
});

describe("lazy initialization (PRD OPS-03, section 10 budgets)", () => {
	function setup(surface: "landing" | "dashboard" | "editor") {
		const consent = new ConsentStore(memoryStorage());
		const paint = deferredPaint();
		const startErrorSink = vi.fn(async () => {});
		const transport = createRecordingTransport();
		const telemetry = initTelemetry({
			surface,
			consent,
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink,
			createAnalyticsTransport: () => transport,
		});
		return { consent, paint, startErrorSink, transport, telemetry };
	}

	it("does not load the monitoring SDK during init, only after first paint", () => {
		const { paint, startErrorSink } = setup("editor");

		expect(startErrorSink).not.toHaveBeenCalled();
		expect(paint.pending).toBe(1);

		paint.flush();
		expect(startErrorSink).toHaveBeenCalledTimes(1);
	});

	it("never loads it on the marketing landing page (ADR 0001)", () => {
		const { paint, startErrorSink } = setup("landing");

		paint.flush();

		expect(paint.pending).toBe(0);
		expect(startErrorSink).not.toHaveBeenCalled();
	});

	it("still wires analytics on the landing page, where landing_cta_click lives", () => {
		const { transport } = setup("landing");
		analytics.log("app_opened");
		expect(transport.events).toHaveLength(1);
	});

	it("attaches the analytics transport synchronously, so early events are not lost", () => {
		const { transport } = setup("editor");
		// No paint flush: `app_opened` fires during onMount, before the deferred
		// monitoring load runs.
		analytics.log("app_opened");
		expect(transport.named("app_opened")).toHaveLength(1);
	});
});

describe("consent (PRD OPS-02 opt-out)", () => {
	it("does not start the monitoring SDK for a user who has opted out", () => {
		const consent = new ConsentStore(memoryStorage());
		consent.optOut();
		const paint = deferredPaint();
		const startErrorSink = vi.fn(async () => {});

		initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink,
			createAnalyticsTransport: createRecordingTransport,
		});
		paint.flush();

		expect(startErrorSink).not.toHaveBeenCalled();
	});

	it("does not attach a vendor analytics transport for a user who has opted out", () => {
		const consent = new ConsentStore(memoryStorage());
		consent.optOut();
		const createAnalyticsTransport = vi.fn(createRecordingTransport);

		initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: () => {},
			createAnalyticsTransport,
		});

		expect(createAnalyticsTransport).not.toHaveBeenCalled();
	});

	it("stops sending when consent is withdrawn mid-session", () => {
		const consent = new ConsentStore(memoryStorage());
		const transport = createRecordingTransport();
		initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: () => {},
			startErrorSink: async () => {},
			createAnalyticsTransport: () => transport,
		});

		analytics.log("app_opened");
		consent.optOut();
		analytics.log("app_opened");

		expect(transport.named("app_opened")).toHaveLength(1);
	});
});

describe("fail-open wiring (PRD OPS-02/OPS-03)", () => {
	it("starts the app when the analytics transport cannot even be created", () => {
		expect(() =>
			initTelemetry({
				surface: "editor",
				consent: new ConsentStore(memoryStorage()),
				target: fakeTarget(),
				afterPaint: () => {},
				createAnalyticsTransport: () => {
					throw new Error("firebase/analytics blocked");
				},
			}),
		).not.toThrow();
	});

	it("survives a monitoring SDK that fails to load", () => {
		const paint = deferredPaint();
		initTelemetry({
			surface: "editor",
			consent: new ConsentStore(memoryStorage()),
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink: async () => {
				throw new Error("blocked by an ad blocker");
			},
			createAnalyticsTransport: createRecordingTransport,
		});

		expect(() => paint.flush()).not.toThrow();
	});
});

describe("dispose", () => {
	it("removes the global handlers it installed", async () => {
		const target = fakeTarget();
		const telemetry = initTelemetry({
			surface: "editor",
			consent: new ConsentStore(memoryStorage()),
			target,
			afterPaint: () => {},
			createAnalyticsTransport: createRecordingTransport,
		});
		expect(target.total()).toBe(2);

		await telemetry.dispose();

		expect(target.total()).toBe(0);
	});
});

describe("afterFirstPaint", () => {
	it("runs the task", async () => {
		const task = vi.fn();
		afterFirstPaint(task);
		await vi.waitFor(() => expect(task).toHaveBeenCalled());
	});

	it("swallows a throwing task rather than breaking the app that just painted", async () => {
		const after = vi.fn();
		afterFirstPaint(() => {
			throw new Error("telemetry startup exploded");
		});
		afterFirstPaint(after);
		await vi.waitFor(() => expect(after).toHaveBeenCalled());
	});
});

// ---------------------------------------------------------------------------
// The PRD OPS-02/OPS-03 acceptance criterion, end to end
// ---------------------------------------------------------------------------

describe("the core journey is identical with both transports failing", () => {
	/**
	 * Edit → save → undo, the loop every later task builds on, run twice: once
	 * with working telemetry and once with the analytics transport throwing,
	 * the error sink throwing, and the user opted out. The two runs must be
	 * indistinguishable in everything the *user* can observe.
	 */
	async function journey(mode: "working" | "broken") {
		const consent = new ConsentStore(memoryStorage());
		if (mode === "broken") consent.optOut();

		const analyticsBoundary = new Analytics({
			transport:
				mode === "broken"
					? createFailingTransport()
					: createRecordingTransport(),
			consent,
			storage: memoryStorage(),
		});

		const explodingSink: ErrorSink = {
			capture() {
				throw new Error("sentry.io blocked");
			},
		};
		const reporter = new ErrorReporter({
			analytics: analyticsBoundary,
			consent,
			sinks: mode === "broken" ? [explodingSink] : [],
		});

		const fixture = createCommandTestProject();
		const history = createCommandHistory(fixture.project);
		const repository = new InMemoryProjectRepository();
		await repository.createProject(fixture.project);
		const scheduler = createManualScheduler();
		const autosave = new ProjectAutosave({
			repository,
			projectId: fixture.project.metadata.id,
			revision: fixture.project.metadata.revision,
			scheduler,
			analytics: analyticsBoundary,
		});

		// Edit.
		history.execute(updateTrack(fixture.trackAId, { name: "Sub" }));
		const named = history.project.song.tracks.find(
			(track) => track.id === fixture.trackAId,
		)?.name;

		// Save.
		autosave.queueSong(history.project.song);
		scheduler.runAll();
		const status = await autosave.flush();

		// Undo.
		history.undo();
		const afterUndo = history.project.song.tracks.find(
			(track) => track.id === fixture.trackAId,
		)?.name;

		// A reported failure along the way must also change nothing.
		reporter.report(new Error("mid-journey"), { area: "editor", fatal: false });

		autosave.dispose();
		return {
			named,
			afterUndo,
			saveState: status.state,
			canUndo: history.canUndo,
			canRedo: history.canRedo,
			revision: history.project.metadata.revision,
		};
	}

	it("produces the same result whether telemetry works or is entirely broken", async () => {
		const working = await journey("working");
		const broken = await journey("broken");

		expect(broken).toEqual(working);
		// And the journey actually did something, so an all-failing run cannot
		// pass by both sides being empty.
		expect(working.named).toBe("Sub");
		expect(working.afterUndo).not.toBe("Sub");
		expect(working.saveState).toBe("saved");
	});

	it("never throws out of the journey when every transport is failing", async () => {
		await expect(journey("broken")).resolves.toBeDefined();
	});
});
