import type { User } from "firebase/auth";

export interface AuthService {
	signInWithGoogle(): Promise<void>;
	signOut(): Promise<void>;
	onAuthStateChanged(callback: (user: User | null) => void): () => void;
	getCurrentUser(): User | null;
}

// Firebase implementation
class FirebaseAuthService implements AuthService {
	private auth;

	constructor() {
		// Dynamic import to avoid importing Firebase in mock mode
		import("../firebaseConfig").then((config) => {
			this.auth = config.auth;
		});
	}

	async signInWithGoogle(): Promise<void> {
		const { GoogleAuthProvider, signInWithPopup } = await import(
			"firebase/auth"
		);
		const provider = new GoogleAuthProvider();
		if (!this.auth) throw new Error("Auth not initialized");
		await signInWithPopup(this.auth, provider);
	}

	async signOut(): Promise<void> {
		const { signOut } = await import("firebase/auth");
		if (!this.auth) throw new Error("Auth not initialized");
		await signOut(this.auth);
	}

	onAuthStateChanged(callback: (user: User | null) => void): () => void {
		let unsubscribe: (() => void) | null = null;

		import("firebase/auth").then(({ onAuthStateChanged }) => {
			if (!this.auth) throw new Error("Auth not initialized");
			unsubscribe = onAuthStateChanged(this.auth, callback);
		});

		return () => {
			if (unsubscribe) unsubscribe();
		};
	}

	getCurrentUser(): User | null {
		return this.auth?.currentUser ?? null;
	}
}

// Mock implementation for development/testing
class MockAuthService implements AuthService {
	private mockUser: User = {
		uid: "mock-user-123",
		email: "test@example.com",
		displayName: "Test User",
		photoURL: null,
	} as User;

	async signInWithGoogle(): Promise<void> {
		// No-op for mock
	}

	async signOut(): Promise<void> {
		// No-op for mock
	}

	onAuthStateChanged(callback: (user: User | null) => void): () => void {
		// Immediately call with mock user
		setTimeout(() => callback(this.mockUser), 0);
		// Return no-op unsubscribe function
		return () => {};
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
