import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, analytics } from "./analytics/analytics";
import type { Surface } from "./analytics/catalog";
import { ConsentStore } from "./analytics/consent";
import {
	createFailingTransport,
	createRecordingTransport,
	noopTransport,
	type RecordingTransport,
} from "./analytics/transport";
import { updateTrack } from "./commands";
import { createCommandHistory } from "./commands/history";
import { createCommandTestProject } from "./commands/testProjects";
import { ErrorReporter, type ErrorSink } from "./monitoring/errorReporting";
import { ProjectAutosave } from "./persistence/autosave";
import { InMemoryProjectRepository } from "./persistence/inMemoryProjectRepository";
import { createManualScheduler } from "./shared/scheduler";
import {
	afterFirstPaint,
	initTelemetry,
	type StartErrorSink,
	surfaceForPath,
} from "./telemetry";
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

/** Drains the microtask chain a deferred sink start resolves through. */
function tick() {
	return new Promise((resolve) => setTimeout(resolve, 0));
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
			setVendorAnalyticsCollection: () => {},
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
		// No paint flush: `app_opened` fires during init, before the deferred
		// monitoring load runs, and must already have a real transport to land on.
		const { transport } = setup("editor");
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
			setVendorAnalyticsCollection: () => {},
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
			setVendorAnalyticsCollection: () => {},
		});

		expect(createAnalyticsTransport).not.toHaveBeenCalled();
	});

	it("does not start it when consent is withdrawn before the deferred start runs", () => {
		// The window between `initTelemetry` and first paint is two animation
		// frames plus an idle callback, and the disclosure is on screen for all of
		// it. Starting anyway would run `sentry.init()` — and transmit a Release
		// Health session — for a user who has just declined.
		const consent = new ConsentStore(memoryStorage());
		const paint = deferredPaint();
		const startErrorSink = vi.fn(async () => {});

		initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink,
			createAnalyticsTransport: createRecordingTransport,
			setVendorAnalyticsCollection: () => {},
		});
		consent.optOut();
		paint.flush();

		expect(startErrorSink).not.toHaveBeenCalled();
	});

	it("stops the sink when consent is withdrawn while it is still loading", async () => {
		// Opt-out landing after the deferred start but before the sink resolves:
		// `stopSink` is still null, so the consent subscription cannot see it and
		// the resolution path has to stop it itself. Otherwise the sink stays
		// attached for the rest of the session.
		const consent = new ConsentStore(memoryStorage());
		const paint = deferredPaint();
		const stop = vi.fn(async () => {});
		let finishLoading: () => void = () => {};
		const loaded = new Promise<void>((resolve) => {
			finishLoading = resolve;
		});
		const startErrorSink = vi.fn(async () => {
			await loaded;
			return stop;
		});

		initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink,
			createAnalyticsTransport: createRecordingTransport,
			setVendorAnalyticsCollection: () => {},
		});
		paint.flush();
		expect(startErrorSink).toHaveBeenCalledTimes(1);

		consent.optOut();
		finishLoading();
		await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
	});

	it("keeps a sink that started while consent was still granted", async () => {
		// The counterpart: the re-checks must not tear down a legitimate sink.
		const consent = new ConsentStore(memoryStorage());
		const paint = deferredPaint();
		const stop = vi.fn(async () => {});
		const telemetry = initTelemetry({
			surface: "editor",
			consent,
			target: fakeTarget(),
			afterPaint: paint.schedule,
			startErrorSink: async () => stop,
			createAnalyticsTransport: createRecordingTransport,
			setVendorAnalyticsCollection: () => {},
		});
		paint.flush();
		// A macrotask tick drains the start promise's microtask chain.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(stop).not.toHaveBeenCalled();

		// It is still the disposer's to stop.
		await telemetry.dispose();
		expect(stop).toHaveBeenCalledTimes(1);
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
			setVendorAnalyticsCollection: () => {},
		});

		// Init logged `app_opened` on reaching the editor surface.
		expect(transport.named("app_opened")).toHaveLength(1);

		consent.optOut();
		analytics.log("app_opened");

		expect(transport.named("app_opened")).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Consent governs collection on every path, not just at the initial URL
// ---------------------------------------------------------------------------

/** One telemetry wiring with every vendor seam replaced by a spy. */
function wire(
	surface: Surface,
	overrides: {
		consent?: ConsentStore;
		startErrorSink?: StartErrorSink;
		createAnalyticsTransport?: () => RecordingTransport;
	} = {},
) {
	const consent = overrides.consent ?? new ConsentStore(memoryStorage());
	const paint = deferredPaint();
	const startErrorSink = vi.fn<StartErrorSink>(
		overrides.startErrorSink ?? (async () => {}),
	);
	const transports: RecordingTransport[] = [];
	const createAnalyticsTransport = vi.fn(() => {
		const transport = (
			overrides.createAnalyticsTransport ?? createRecordingTransport
		)();
		transports.push(transport);
		return transport;
	});
	const setVendorAnalyticsCollection = vi.fn();
	const telemetry = initTelemetry({
		surface,
		consent,
		target: fakeTarget(),
		afterPaint: paint.schedule,
		startErrorSink,
		createAnalyticsTransport,
		setVendorAnalyticsCollection,
	});
	return {
		consent,
		paint,
		startErrorSink,
		createAnalyticsTransport,
		setVendorAnalyticsCollection,
		telemetry,
		transports,
		/** The transport currently attached to the boundary. */
		get transport() {
			return transports[transports.length - 1];
		},
	};
}

describe("monitoring follows the surface reached, not the entry URL", () => {
	// A landing session that clicks "Start in your browser" is client-navigated to the
	// dashboard with no page load, so a decision taken once from
	// `window.location.pathname` never gets revisited. Leaving monitoring off for
	// that whole session drops it out of both halves of the PRD section 11
	// crash-free session rate and out of the `app_opened` denominator.

	it("starts the sink when a landing session navigates to the dashboard", () => {
		const { paint, startErrorSink, telemetry } = wire("landing");
		paint.flush();
		expect(startErrorSink).not.toHaveBeenCalled();

		telemetry.setSurface("dashboard");
		paint.flush();

		expect(startErrorSink).toHaveBeenCalledTimes(1);
	});

	it("logs app_opened on that first non-landing transition", () => {
		const { telemetry, transport } = wire("landing");
		expect(transport.named("app_opened")).toHaveLength(0);

		telemetry.setSurface("dashboard");

		expect(transport.named("app_opened")).toHaveLength(1);
	});

	it("starts the sink and logs app_opened exactly once across later navigations", async () => {
		const { paint, startErrorSink, telemetry, transport } = wire("landing");

		telemetry.setSurface("dashboard");
		paint.flush();
		await tick();
		telemetry.setSurface("editor");
		telemetry.setSurface("dashboard");
		paint.flush();

		expect(startErrorSink).toHaveBeenCalledTimes(1);
		expect(transport.named("app_opened")).toHaveLength(1);
	});

	it("starts nothing while the session stays on the landing page", () => {
		const { paint, startErrorSink, telemetry, transport } = wire("landing");

		telemetry.setSurface("landing");
		paint.flush();

		expect(paint.pending).toBe(0);
		expect(startErrorSink).not.toHaveBeenCalled();
		expect(transport.named("app_opened")).toHaveLength(0);
	});

	it("still logs app_opened once for a session that deep-links into the editor", () => {
		const { telemetry, transport } = wire("editor");
		telemetry.setSurface("editor");
		expect(transport.named("app_opened")).toHaveLength(1);
	});
});

describe("re-granting consent resumes collection (PRD OPS-02)", () => {
	// Withdrawal tears the transport and the sink down. A toggle that only works
	// in one direction leaves a user who changes their mind uncollected for the
	// rest of the page's life, with the checkbox showing "on".

	it("re-creates the analytics transport when the user opts back in", () => {
		const wiring = wire("editor");

		wiring.consent.optOut();
		wiring.consent.optIn();
		analytics.log("app_opened");

		expect(wiring.transports).toHaveLength(2);
		expect(wiring.transports[1]?.named("app_opened")).toHaveLength(1);
	});

	it("restarts the error sink when the user opts back in", async () => {
		const stop = vi.fn(async () => {});
		const wiring = wire("editor", { startErrorSink: async () => stop });

		wiring.paint.flush();
		await tick();
		expect(wiring.startErrorSink).toHaveBeenCalledTimes(1);

		wiring.consent.optOut();
		await tick();
		expect(stop).toHaveBeenCalledTimes(1);

		wiring.consent.optIn();
		wiring.paint.flush();

		expect(wiring.startErrorSink).toHaveBeenCalledTimes(2);
	});
});

describe("the vendor analytics SDK follows consent (PRD OPS-02)", () => {
	// Dropping the custom-event transport leaves GA4 automatic collection —
	// page_view, session_start, first_visit, user_engagement and the _ga
	// cookies — running. Consent has to reach the SDK itself, or the disclosure's
	// "turning this off stops collection" is untrue.

	it("never enables collection for a user who has already opted out", () => {
		const consent = new ConsentStore(memoryStorage());
		consent.optOut();
		const { setVendorAnalyticsCollection } = wire("editor", { consent });

		expect(setVendorAnalyticsCollection).toHaveBeenCalledWith(false);
		expect(setVendorAnalyticsCollection).not.toHaveBeenCalledWith(true);
	});

	it("disables collection when consent is withdrawn mid-session", () => {
		const { consent, setVendorAnalyticsCollection } = wire("editor");
		expect(setVendorAnalyticsCollection).toHaveBeenLastCalledWith(true);

		consent.optOut();

		expect(setVendorAnalyticsCollection).toHaveBeenLastCalledWith(false);
	});

	it("re-enables collection when the user opts back in", () => {
		const { consent, setVendorAnalyticsCollection } = wire("editor");

		consent.optOut();
		consent.optIn();

		expect(setVendorAnalyticsCollection).toHaveBeenLastCalledWith(true);
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
				setVendorAnalyticsCollection: () => {},
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
			setVendorAnalyticsCollection: () => {},
		});

		expect(() => paint.flush()).not.toThrow();
	});
});

describe("dispose", () => {
	it("stops a sink that resolves after dispose", async () => {
		// Same shape as the consent-withdrawal race: `stopSink` is still null
		// while the sink is loading, so the disposer has nothing to await and a
		// sink resolving afterwards would stay attached for the rest of the page.
		const stop = vi.fn(async () => {});
		let finishLoading: () => void = () => {};
		const loaded = new Promise<void>((resolve) => {
			finishLoading = resolve;
		});
		const wiring = wire("editor", {
			startErrorSink: async () => {
				await loaded;
				return stop;
			},
		});
		wiring.paint.flush();
		expect(wiring.startErrorSink).toHaveBeenCalledTimes(1);

		await wiring.telemetry.dispose();
		finishLoading();

		await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
	});

	it("ignores a surface change that arrives after dispose", async () => {
		const wiring = wire("landing");

		await wiring.telemetry.dispose();
		wiring.telemetry.setSurface("dashboard");
		wiring.paint.flush();

		expect(wiring.startErrorSink).not.toHaveBeenCalled();
		expect(wiring.transport.named("app_opened")).toHaveLength(0);
	});

	it("removes the global handlers it installed", async () => {
		const target = fakeTarget();
		const telemetry = initTelemetry({
			surface: "editor",
			consent: new ConsentStore(memoryStorage()),
			target,
			afterPaint: () => {},
			createAnalyticsTransport: createRecordingTransport,
			setVendorAnalyticsCollection: () => {},
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

	// `FND-001c` (#174): a background tab never paints, so
	// `requestAnimationFrame` is not called until it is foregrounded -- which
	// may be never. Gating monitoring on a frame meant a session opened in a
	// background tab (a restored window, a middle-click, a deep link opened
	// behind the current page) loaded no SDK at all and reported no crash.
	// The idle callback is what must still get there.
	it("runs the task in a tab that never paints", async () => {
		const rafSpy = vi
			.spyOn(globalThis, "requestAnimationFrame")
			.mockImplementation(() => 0);
		try {
			const task = vi.fn();
			afterFirstPaint(task);
			await vi.waitFor(() => expect(task).toHaveBeenCalled());
		} finally {
			rafSpy.mockRestore();
		}
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
