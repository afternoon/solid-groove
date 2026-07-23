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

	private notify() {
		for (const cb of this.callbacks) cb(this.mockUser);
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
		// Immediately report current state
		setTimeout(() => callback(this.mockUser), 0);
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
