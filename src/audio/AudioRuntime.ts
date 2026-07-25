import * as Tone from "tone";
import {
	type ResourceHandle,
	ResourceRegistry,
	type ResourceType,
} from "./resourceRegistry";

export type AudioRuntimeState =
	| "uninitialized"
	| "suspended"
	| "running"
	| "closing"
	| "closed";

/** Owner id used for the runtime's own bookkeeping (the context itself). */
const RUNTIME_OWNER = "runtime";

/**
 * A disposal scope for one project graph. Every resource a project registers
 * through it is torn down by `dispose()` without touching the shared context
 * or any other project's resources — this is what lets a route/component
 * teardown dispose a project graph without recreating the real-time context
 * (PRD AUD-07).
 */
export interface AudioProjectScope {
	readonly ownerId: string;
	register(
		type: ResourceType,
		dispose: () => void | Promise<void>,
	): ResourceHandle;
	/** Dispose and untrack a single resource ahead of the full scope teardown. */
	release(handle: ResourceHandle): Promise<void>;
	/** Dispose and untrack every resource this scope has registered. Idempotent. */
	dispose(): Promise<void>;
}

export interface AudioDiagnostics {
	state: AudioRuntimeState;
	/** How many real-time `AudioContext`s this runtime has ever constructed. */
	contextsCreated: number;
	/** How many of those it has fully closed. */
	contextsClosed: number;
	resources: ReturnType<ResourceRegistry["counts"]>;
}

/**
 * The subset of `AudioRuntime` that project graphs depend on. Consumers
 * (SongPlayer today, `ProjectAudioGraph` once FND-007 lands) depend on this
 * interface rather than the concrete class so tests can supply a fake
 * without touching Tone or Web Audio at all.
 */
export interface AudioHost {
	getDestination(): Tone.ToneAudioNode;
	resume(): Promise<void>;
	openProjectScope(ownerId: string): AudioProjectScope;
}

/**
 * The application-scoped owner of the single real-time Tone/Web Audio
 * context (PRD AUD-07, section 9.7). This is the only place production code
 * may create, install, resume, suspend, replace, or close that context —
 * obtain the shared instance through `getAudioRuntime()` below rather than
 * constructing one directly.
 */
export class AudioRuntime implements AudioHost {
	private context: Tone.Context | null = null;
	private state: AudioRuntimeState = "uninitialized";
	private closePromise: Promise<void> | null = null;
	private contextsCreated = 0;
	private contextsClosed = 0;

	/** Owners for contexts, graphs, nodes, schedules, buffers, subscriptions, timers, workers, and pending loads. */
	readonly registry = new ResourceRegistry();

	getState(): AudioRuntimeState {
		return this.state;
	}

	/**
	 * Return the live context, lazily creating and installing one the first
	 * time it's needed. Reused across projects, navigation, and compatible
	 * HMR — this never recreates the context just because a project graph
	 * was replaced.
	 */
	ensureContext(): Tone.Context {
		if (this.context && this.state !== "closed" && this.state !== "closing") {
			return this.context;
		}

		const context = new Tone.Context();
		this.contextsCreated++;
		Tone.setContext(context);
		this.context = context;
		this.state = "suspended";
		// A stale, already-settled promise from a previous close() would
		// otherwise short-circuit the *next* close() below without ever
		// touching this new context.
		this.closePromise = null;
		// Registered so diagnostics can report the context itself as a tracked
		// resource; disposal is a no-op here because `close()` owns the actual
		// `context.close()` call.
		this.registry.register(RUNTIME_OWNER, "context", () => {});
		return context;
	}

	/** The shared destination node. Ensures the context exists first. */
	getDestination(): Tone.ToneAudioNode {
		this.ensureContext();
		return Tone.getDestination();
	}

	/**
	 * Resume the context from a suspended state. Callers must only invoke
	 * this from an allowed user gesture — browsers otherwise refuse to start
	 * audio output.
	 */
	async resume(): Promise<void> {
		if (this.closePromise) await this.closePromise;
		const context = this.ensureContext();
		if (context.state !== "running") {
			await Tone.start();
		}
		this.state = "running";
	}

	/** Suspend the context without closing it. A no-op if there is no live context. */
	async suspend(): Promise<void> {
		if (!this.context) return;
		if (this.state === "closed" || this.state === "closing") return;
		// `rawContext` is typed as `AudioContext | OfflineAudioContext`, and
		// only the online variant's `suspend()` takes no argument. This
		// runtime never installs an offline context as the real-time context
		// (see AUD-07), so the cast reflects that invariant rather than
		// papering over a real possibility.
		await (this.context.rawContext as AudioContext).suspend();
		this.state = "suspended";
	}

	/**
	 * Fully close the context and release every resource this runtime still
	 * owns, including project graphs that were never explicitly torn down.
	 * Idempotent: a second call — even one racing the first — returns the
	 * same in-flight/settled promise instead of closing twice, and closing a
	 * runtime that never created a context (partial initialization, or the
	 * context construction itself failed) resolves without throwing.
	 */
	async close(): Promise<void> {
		if (this.state === "closed") return;
		if (this.closePromise) return this.closePromise;

		this.state = "closing";
		this.closePromise = (async () => {
			await this.registry.disposeAll();
			const context = this.context;
			this.context = null;
			if (context) {
				try {
					if (context.state !== "closed") await context.close();
				} finally {
					this.contextsClosed++;
				}
			}
			this.state = "closed";
		})();

		return this.closePromise;
	}

	/**
	 * Open a disposal scope for one project graph. `dispose()` on the
	 * returned scope tears down only resources registered under `ownerId` —
	 * it never touches the shared context or another project's resources, so
	 * normal project/route teardown never recreates the real-time context.
	 */
	openProjectScope(ownerId: string): AudioProjectScope {
		return {
			ownerId,
			register: (type, dispose) =>
				this.registry.register(ownerId, type, dispose),
			release: (handle) => this.registry.disposeOne(handle),
			dispose: async () => {
				await this.registry.disposeOwner(ownerId);
			},
		};
	}

	diagnostics(): AudioDiagnostics {
		return {
			state: this.state,
			contextsCreated: this.contextsCreated,
			contextsClosed: this.contextsClosed,
			resources: this.registry.counts(),
		};
	}
}

/**
 * The one application-scoped runtime is stashed on `globalThis` — keyed by a
 * well-known symbol — rather than held in a plain module-level variable. A
 * compatible Vite HMR update re-evaluates this module's top-level scope but
 * leaves `globalThis` untouched, so every re-evaluation hands off the same
 * instance instead of quietly constructing a second real-time context.
 */
const RUNTIME_SLOT = Symbol.for("solid-groove.audio-runtime");

interface RuntimeSlot {
	runtime?: AudioRuntime;
}

function globalSlot(): RuntimeSlot {
	const g = globalThis as unknown as Record<symbol, RuntimeSlot | undefined>;
	if (!g[RUNTIME_SLOT]) {
		g[RUNTIME_SLOT] = {};
	}
	return g[RUNTIME_SLOT] as RuntimeSlot;
}

/**
 * The only supported way to obtain the application's `AudioRuntime`. Safe to
 * call from any module, any number of times, across navigation and
 * compatible HMR — it always returns the same instance until
 * `replaceAudioRuntime()` explicitly swaps it out.
 */
export function getAudioRuntime(): AudioRuntime {
	const slot = globalSlot();
	if (!slot.runtime) {
		slot.runtime = new AudioRuntime();
	}
	return slot.runtime;
}

/**
 * Force an incompatible-replacement handoff: fully close the current runtime
 * and await that `close()` before installing a fresh one, so the previous
 * context is guaranteed released before another can be created. This is not
 * part of routine navigation or project switching — those reuse the runtime
 * via `getAudioRuntime()` — it exists for the rare case a compatible HMR
 * handoff genuinely cannot be made (e.g. the runtime's own shape changed).
 */
export async function replaceAudioRuntime(): Promise<AudioRuntime> {
	const slot = globalSlot();
	if (slot.runtime) {
		await slot.runtime.close();
	}
	const runtime = new AudioRuntime();
	slot.runtime = runtime;
	return runtime;
}

/** Test-only: forget the global singleton so each test starts from a clean slate. */
export function __resetAudioRuntimeForTests(): void {
	const slot = globalSlot();
	slot.runtime = undefined;
}

/** Convenience accessor for development tooling/tests; see the `window` hook below. */
export function getAudioDiagnostics(): AudioDiagnostics {
	return getAudioRuntime().diagnostics();
}

// Development-only: expose diagnostics on `window` so a browser test or the
// devtools console can assert the document has no more than one live
// real-time context (PRD AUD-09). `import.meta.env.DEV` is a build-time
// constant, so this whole block is dead code — and its `AudioRuntime`
// reference along with it — in a production bundle.
if (import.meta.env.DEV && typeof window !== "undefined") {
	(
		window as unknown as {
			__solidGrooveAudio?: { diagnostics(): AudioDiagnostics };
		}
	).__solidGrooveAudio = { diagnostics: getAudioDiagnostics };
}

// Self-accept so editing this module during development hands the existing
// runtime off through the `globalThis` slot above instead of Vite
// propagating the update into a full page reload, which would otherwise
// tear down and recreate the shared context on every save.
if (import.meta.hot) {
	import.meta.hot.accept();
}
