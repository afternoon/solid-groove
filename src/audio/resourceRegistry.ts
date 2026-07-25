/**
 * Ownership tracking for everything the audio engine allocates.
 *
 * Web Audio does not expose complete graph introspection, so Solid Groove
 * instruments its own factories instead: anything the engine creates is
 * registered here under an owner id and a resource type, and is removed the
 * moment it is disposed. Development and test builds use the resulting
 * counts to prove a project graph or an HMR replacement returns every
 * counter to its pre-open baseline (PRD AUD-09).
 */

/** Every category of thing the audio engine is responsible for disposing. */
export type ResourceType =
	| "context"
	| "graph"
	| "node"
	| "schedule"
	| "buffer"
	| "subscription"
	| "timer"
	| "worker"
	| "pendingLoad";

export interface ResourceHandle {
	readonly id: number;
}

export interface RegisteredResourceInfo {
	readonly id: number;
	readonly owner: string;
	readonly type: ResourceType;
	/** Allocation stack, recorded only in development/test builds. */
	readonly allocatedAt?: string;
}

export interface ResourceCounts {
	total: number;
	byType: Partial<Record<ResourceType, number>>;
	byOwner: Record<string, number>;
}

interface ResourceEntry {
	id: number;
	owner: string;
	type: ResourceType;
	dispose: () => void | Promise<void>;
	allocatedAt?: string;
}

/**
 * Development/test builds record where a resource was allocated so a leak
 * report can point at the call site. Production builds skip the `new
 * Error().stack` cost entirely — this reads `import.meta.env.DEV`, which
 * Vite replaces with a literal at build time, so the branch below is dead
 * code in a production bundle rather than a runtime check.
 */
const RECORD_ALLOCATION_STACKS = import.meta.env.DEV === true;

function describe(owner: string, type: ResourceType): string {
	return `${type} owned by "${owner}"`;
}

async function safeDispose(entry: ResourceEntry): Promise<Error | undefined> {
	try {
		await entry.dispose();
		return undefined;
	} catch (cause) {
		const error = cause instanceof Error ? cause : new Error(String(cause));
		console.error(
			`AudioRuntime: disposal failed for ${describe(entry.owner, entry.type)}`,
			error,
		);
		return error;
	}
}

export class ResourceRegistry {
	private entries = new Map<number, ResourceEntry>();
	private nextId = 1;

	/**
	 * Track a resource under `owner`/`type`. `dispose` runs at most once, the
	 * first time the resource is released — by `disposeOne`, by
	 * `disposeOwner`/`disposeAll`, or indirectly once for both if a caller
	 * mistakenly disposes it twice.
	 */
	register(
		owner: string,
		type: ResourceType,
		dispose: () => void | Promise<void>,
	): ResourceHandle {
		const id = this.nextId++;
		const entry: ResourceEntry = { id, owner, type, dispose };
		if (RECORD_ALLOCATION_STACKS) {
			entry.allocatedAt = new Error(describe(owner, type)).stack;
		}
		this.entries.set(id, entry);
		return { id };
	}

	/** True while the handle's resource is still tracked (i.e. not yet disposed). */
	has(handle: ResourceHandle): boolean {
		return this.entries.has(handle.id);
	}

	/**
	 * Dispose and untrack a single resource. Removing it from the map before
	 * awaiting its disposer makes this safe to call more than once — a second
	 * call, or a concurrent one racing the first, finds nothing and is a
	 * no-op — which is what makes cancellation and repeated `dispose()` calls
	 * elsewhere in the engine safe.
	 */
	async disposeOne(handle: ResourceHandle): Promise<void> {
		const entry = this.entries.get(handle.id);
		if (!entry) return;
		this.entries.delete(handle.id);
		await safeDispose(entry);
	}

	/**
	 * Dispose and untrack every resource registered under `owner`. A resource
	 * whose disposer throws is still removed — a broken teardown cannot pin a
	 * resource in the registry forever — and its error is collected rather
	 * than aborting the rest of the batch.
	 */
	async disposeOwner(owner: string): Promise<Error[]> {
		const toDispose: ResourceEntry[] = [];
		for (const entry of this.entries.values()) {
			if (entry.owner === owner) toDispose.push(entry);
		}
		for (const entry of toDispose) this.entries.delete(entry.id);

		const errors: Error[] = [];
		for (const entry of toDispose) {
			const error = await safeDispose(entry);
			if (error) errors.push(error);
		}
		return errors;
	}

	/** Dispose every remaining resource, regardless of owner. */
	async disposeAll(): Promise<Error[]> {
		const owners = new Set<string>();
		for (const entry of this.entries.values()) owners.add(entry.owner);

		const errors: Error[] = [];
		for (const owner of owners) {
			errors.push(...(await this.disposeOwner(owner)));
		}
		return errors;
	}

	counts(): ResourceCounts {
		const byType: Partial<Record<ResourceType, number>> = {};
		const byOwner: Record<string, number> = {};
		for (const entry of this.entries.values()) {
			byType[entry.type] = (byType[entry.type] ?? 0) + 1;
			byOwner[entry.owner] = (byOwner[entry.owner] ?? 0) + 1;
		}
		return { total: this.entries.size, byType, byOwner };
	}

	countForOwner(owner: string): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.owner === owner) count++;
		}
		return count;
	}

	/** A snapshot for diagnostics/leak reporting. Never retains disposed entries. */
	snapshot(): RegisteredResourceInfo[] {
		return [...this.entries.values()].map((entry) => ({
			id: entry.id,
			owner: entry.owner,
			type: entry.type,
			allocatedAt: entry.allocatedAt,
		}));
	}

	isEmpty(): boolean {
		return this.entries.size === 0;
	}
}
