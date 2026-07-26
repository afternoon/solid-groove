import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import {
	type ErrorReport,
	ErrorReporter,
	type ErrorSink,
} from "./errorReporting";
import { installGlobalErrorHandlers } from "./globalHandlers";

/** A minimal event target, so no test depends on a real `window`. */
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
		emit(type: string, event: unknown) {
			for (const listener of [...(listeners.get(type) ?? [])]) {
				listener(event as Event);
			}
		},
		count(type: string) {
			return listeners.get(type)?.size ?? 0;
		},
	};
}

function setup() {
	const reports: ErrorReport[] = [];
	const sink: ErrorSink = { capture: (report) => void reports.push(report) };
	const consent = new ConsentStore(memoryStorage());
	const reporter = new ErrorReporter({
		analytics: new Analytics({
			transport: createRecordingTransport(),
			consent,
			storage: memoryStorage(),
		}),
		consent,
		sinks: [sink],
	});
	const target = fakeTarget();
	const dispose = installGlobalErrorHandlers({ reporter, target });
	return { reports, reporter, target, dispose };
}

describe("installGlobalErrorHandlers (PRD OPS-03)", () => {
	it("reports an uncaught error once, as fatal", () => {
		const { reports, target } = setup();

		target.emit("error", { error: new Error("boom") });

		expect(reports).toHaveLength(1);
		expect(reports[0].fatal).toBe(true);
		expect(reports[0].area).toBe("shell");
	});

	it("reports an unhandled rejection once, as fatal", () => {
		// Unhandled rejections are what Release Health counts as crashed
		// sessions; a handled, recovered failure reports non-fatally elsewhere.
		const { reports, target } = setup();

		target.emit("unhandledrejection", { reason: new Error("nope") });

		expect(reports).toHaveLength(1);
		expect(reports[0].fatal).toBe(true);
	});

	it("falls back to the message for a cross-origin script error", () => {
		// `error` is null for "Script error."; the count must still be right even
		// though the stack will not be useful.
		const { reports, target } = setup();

		target.emit("error", { error: null, message: "Script error." });

		expect(reports).toHaveLength(1);
		expect(reports[0].message).toBe("Script error.");
	});

	it("collapses one error arriving through both handlers", () => {
		const { reports, target } = setup();
		const error = new Error("boom");

		target.emit("error", { error });
		target.emit("unhandledrejection", { reason: error });

		expect(reports).toHaveLength(1);
	});

	it("never lets an exception escape a listener", () => {
		// An exception escaping window.onerror is reported as another uncaught
		// error — the recursion PRD OPS-03 forbids.
		const target = fakeTarget();
		installGlobalErrorHandlers({
			target,
			reporter: {
				report() {
					throw new Error("reporter exploded");
				},
			} as unknown as ErrorReporter,
		});

		expect(() =>
			target.emit("error", { error: new Error("boom") }),
		).not.toThrow();
	});

	it("removes both listeners on dispose", () => {
		const { target, dispose } = setup();
		expect(target.count("error")).toBe(1);
		expect(target.count("unhandledrejection")).toBe(1);

		dispose();

		expect(target.count("error")).toBe(0);
		expect(target.count("unhandledrejection")).toBe(0);
	});

	it("stops reporting after dispose", () => {
		const { reports, target, dispose } = setup();
		dispose();

		target.emit("error", { error: new Error("boom") });

		expect(reports).toHaveLength(0);
	});

	it("attributes to a caller-supplied area", () => {
		const reports: ErrorReport[] = [];
		const consent = new ConsentStore(memoryStorage());
		const reporter = new ErrorReporter({
			analytics: new Analytics({ consent, storage: memoryStorage() }),
			consent,
			sinks: [{ capture: (report) => void reports.push(report) }],
		});
		const target = fakeTarget();
		installGlobalErrorHandlers({ reporter, target, area: "editor" });

		target.emit("error", { error: new Error("boom") });

		expect(reports[0].area).toBe("editor");
	});

	it("is a no-op with no target and no window", () => {
		const spy = vi
			.spyOn(globalThis, "window", "get")
			.mockReturnValue(undefined as unknown as Window & typeof globalThis);
		try {
			expect(() => installGlobalErrorHandlers()()).not.toThrow();
		} finally {
			spy.mockRestore();
		}
	});
});
