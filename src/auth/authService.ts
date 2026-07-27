import type { Auth, User } from "firebase/auth";

export interface AuthService {
	signInWithGoogle(): Promise<void>;
	signInAnonymously(): Promise<void>;
	linkWithGoogle(): Promise<void>;
	signOut(): Promise<void>;
	onAuthStateChanged(callback: (user: User | null) => void): () => void;
	getCurrentUser(): User | null;
}

// Firebase implementation
class FirebaseAuthService implements AuthService {
	private auth: Auth | undefined;
	// Firebase is imported dynamically (to keep it out of the mock build), so
	// `auth` isn't available synchronously. Every method awaits this promise
	// rather than reading `this.auth` directly, which avoids an "Auth not
	// initialized" race when a caller runs before the import resolves.
	private ready: Promise<Auth>;

	constructor() {
		this.ready = import("../firebaseConfig").then((config) => {
			this.auth = config.auth;
			return config.auth;
		});

		// `authService` is constructed at module scope (bottom of this file), so
		// merely *importing* this module starts that dynamic import — with no
		// caller yet to await it. `src/firebaseConfig.ts` calls `getAuth(app)` in
		// its module body, which throws `auth/invalid-api-key` when no Firebase
		// config is present, so in that situation `this.ready` is a rejected
		// promise nobody is holding: an unhandled rejection.
		//
		// That is a real, observed CI flake rather than a theoretical one. Any unit
		// or component test whose import graph reaches this module (Dashboard.test.tsx
		// does) would report `Test Files 85 passed / Tests 1114 passed / Errors 1
		// error` and exit 1 — every assertion green, the run red. Whether the
		// rejection settles before Vitest tears the process down is a race, so the
		// same commit passed one CI run and failed the next.
		//
		// Attaching a handler marks the promise handled without changing what
		// callers see: every method still `await`s `this.ready` and still gets this
		// exact rejection. Do not "simplify" this away — it fails intermittently and
		// at a distance, which is the expensive kind.
		this.ready.catch(() => {});
	}

	async signInWithGoogle(): Promise<void> {
		const auth = await this.ready;
		const { GoogleAuthProvider, signInWithPopup } = await import(
			"firebase/auth"
		);
		const provider = new GoogleAuthProvider();
		await signInWithPopup(auth, provider);
	}

	async signInAnonymously(): Promise<void> {
		const auth = await this.ready;
		const { signInAnonymously } = await import("firebase/auth");
		await signInAnonymously(auth);
	}

	async linkWithGoogle(): Promise<void> {
		const auth = await this.ready;
		const { GoogleAuthProvider, linkWithPopup } = await import("firebase/auth");
		const currentUser = auth.currentUser;
		if (!currentUser) throw new Error("No user to link");
		const provider = new GoogleAuthProvider();
		// Links the Google credential to the existing (anonymous) account,
		// preserving the same uid so all existing projects remain accessible.
		await linkWithPopup(currentUser, provider);
	}

	async signOut(): Promise<void> {
		const auth = await this.ready;
		const { signOut } = await import("firebase/auth");
		await signOut(auth);
	}

	onAuthStateChanged(callback: (user: User | null) => void): () => void {
		let unsubscribe: (() => void) | null = null;
		let cancelled = false;

		Promise.all([this.ready, import("firebase/auth")]).then(
			([auth, { onAuthStateChanged }]) => {
				if (cancelled) return;
				unsubscribe = onAuthStateChanged(auth, callback);
			},
		);

		return () => {
			cancelled = true;
			if (unsubscribe) unsubscribe();
		};
	}

	getCurrentUser(): User | null {
		return this.auth?.currentUser ?? null;
	}
}

// Mock implementation for development/testing
class MockAuthService implements AuthService {
	private mockUser: User | null = null;
	private callbacks = new Set<(user: User | null) => void>();
	// Tracks which callbacks have already been sent the current `mockUser`
	// value, so the deferred "report current state" delivery in
	// `onAuthStateChanged` (below) can skip itself if a sign-in already
	// notified the callback with that same state in the meantime.
	private notified = new WeakSet<(user: User | null) => void>();

	private notify() {
		for (const cb of this.callbacks) {
			this.notified.add(cb);
			cb(this.mockUser);
		}
	}

	async signInWithGoogle(): Promise<void> {
		this.mockUser = {
			uid: "mock-user-123",
			email: "test@example.com",
			displayName: "Test User",
			photoURL: null,
			isAnonymous: false,
		} as User;
		this.notify();
	}

	async signInAnonymously(): Promise<void> {
		this.mockUser = {
			uid: "mock-anon-123",
			email: null,
			displayName: null,
			photoURL: null,
			isAnonymous: true,
		} as User;
		this.notify();
	}

	async linkWithGoogle(): Promise<void> {
		if (!this.mockUser) throw new Error("No user to link");
		// Upgrade in place, keeping the same uid.
		this.mockUser = {
			...this.mockUser,
			email: "test@example.com",
			displayName: "Test User",
			isAnonymous: false,
		} as User;
		this.notify();
	}

	async signOut(): Promise<void> {
		this.mockUser = null;
		this.notify();
	}

	onAuthStateChanged(callback: (user: User | null) => void): () => void {
		this.callbacks.add(callback);
		// Report current state asynchronously, matching Firebase's real
		// contract: a newly-registered observer is invoked with the current
		// user, but only after the current synchronous task finishes, not
		// during registration itself.
		//
		// This must not use `setTimeout`, which schedules a macrotask that
		// can fire *after* an unrelated later event (e.g. a click handler
		// that runs synchronously right after subscribing, such as
		// `signInAnonymously`). If that happens, the pending timeout would
		// still fire later, re-invoking `callback` directly - bypassing
		// `callbacks.delete` from an unsubscribe in between - with whatever
		// `mockUser` happens to be by then, i.e. a stale, duplicate
		// notification through a dead subscription. A microtask fires
		// before any such later macrotask/event, so it can't be reordered
		// past a same-tick synchronous sign-in.
		//
		// The `notified` check below covers the remaining case: a sign-in
		// that runs (synchronously) before this microtask gets a turn will
		// have already delivered the current state via `notify()`, so this
		// skips re-delivering the same state as a redundant duplicate.
		queueMicrotask(() => {
			if (!this.callbacks.has(callback)) return;
			if (this.notified.has(callback)) return;
			this.notified.add(callback);
			callback(this.mockUser);
		});
		return () => {
			this.callbacks.delete(callback);
		};
	}

	getCurrentUser(): User | null {
		return this.mockUser;
	}
}

// Factory function to create the appropriate auth service
export function createAuthService(): AuthService {
	if (import.meta.env.VITE_MOCK_BACKEND === "true") {
		return new MockAuthService();
	} else {
		return new FirebaseAuthService();
	}
}

// Export singleton instance
export const authService = createAuthService();
