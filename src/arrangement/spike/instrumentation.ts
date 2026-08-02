/**
 * Measurement instrumentation for the FND-008 renderer spike (PRD 9.3
 * "Alpha Milestone 0 ... is required to produce ... a harness that emits frame time,
 * long-task, redraw-count and memory numbers on whatever hardware runs it").
 *
 * This module only counts and records; it never decides *whether* a redraw
 * is needed (`ArrangementSpike.tsx` does that) or what a "good" number looks
 * like (nothing here is gated on a budget — see docs/arrangement-renderer-spike.md).
 */

export type DirtyLayer = "background" | "content" | "interaction";

export interface FrameSample {
	readonly timestampMs: number;
	readonly durationMs: number;
	readonly layers: readonly DirtyLayer[];
}

export interface LongTaskSample {
	readonly startMs: number;
	readonly durationMs: number;
}

export interface InstrumentationSnapshot {
	readonly redrawCounts: Readonly<Record<DirtyLayer, number>>;
	readonly frames: readonly FrameSample[];
	readonly longTasks: readonly LongTaskSample[];
	readonly heapUsedMB: number | null;
}

export interface Instrumentation {
	recordRedraw(layers: readonly DirtyLayer[], durationMs: number): void;
	reset(): void;
	snapshot(): InstrumentationSnapshot;
	dispose(): void;
}

/** Chrome-only, non-standard; every other engine leaves this undefined. */
interface PerformanceMemory {
	usedJSHeapSize: number;
}

function readHeapUsedMB(): number | null {
	const memory = (performance as Performance & { memory?: PerformanceMemory })
		.memory;
	if (!memory) return null;
	return memory.usedJSHeapSize / (1024 * 1024);
}

export function createInstrumentation(): Instrumentation {
	let redrawCounts: Record<DirtyLayer, number> = {
		background: 0,
		content: 0,
		interaction: 0,
	};
	let frames: FrameSample[] = [];
	let longTasks: LongTaskSample[] = [];

	let observer: PerformanceObserver | undefined;
	if (typeof PerformanceObserver !== "undefined") {
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks.push({
						startMs: entry.startTime,
						durationMs: entry.duration,
					});
				}
			});
			// "longtask" is Chromium-only (the PRD's gating browsers include
			// Chrome/Edge); Firefox/Safari simply never call the callback.
			observer.observe({ entryTypes: ["longtask"] });
		} catch {
			observer = undefined;
		}
	}

	return {
		recordRedraw(layers, durationMs) {
			for (const layer of layers) {
				redrawCounts[layer] += 1;
			}
			frames.push({
				timestampMs: performance.now(),
				durationMs,
				layers: [...layers],
			});
		},
		reset() {
			redrawCounts = { background: 0, content: 0, interaction: 0 };
			frames = [];
			longTasks = [];
		},
		snapshot() {
			return {
				redrawCounts: { ...redrawCounts },
				frames: [...frames],
				longTasks: [...longTasks],
				heapUsedMB: readHeapUsedMB(),
			};
		},
		dispose() {
			observer?.disconnect();
		},
	};
}

/** `p` in `[0, 100]`. Assumes `values` is non-empty. */
export function percentile(values: readonly number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	const rank = (p / 100) * (sorted.length - 1);
	const low = Math.floor(rank);
	const high = Math.ceil(rank);
	if (low === high) return sorted[low];
	const weight = rank - low;
	return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function median(values: readonly number[]): number {
	return percentile(values, 50);
}
