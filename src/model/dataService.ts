import mockProjectData from "./mockProjectData";
import type { Project } from "./types";

/**
 * Result passed to a project subscription callback.
 * - `project` is the loaded project, or `null` when the project does not exist,
 *   the current user is not allowed to read it (Firestore returns a
 *   permission-denied error), or the subscription failed to even set up.
 * - `notFound` covers the first two cases: they are indistinguishable on
 *   purpose, so we never leak the existence of another user's project.
 * - `error` covers the third case: a genuine infrastructure failure (e.g. the
 *   Firestore module or app config failed to load) rather than an access or
 *   existence question. Distinct from `notFound` so the UI can offer a retry
 *   instead of a 404.
 */
export type ProjectSubscriptionResult = {
	project: Project | null;
	notFound: boolean;
	error?: boolean;
};

export interface DataService {
	subscribeToProject(
		id: string,
		callback: (result: ProjectSubscriptionResult) => void,
	): () => void;
	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
		onError?: (error: unknown) => void,
	): () => void;
	updateProject(project: Project): Promise<void>;
	createProject(project: Omit<Project, "id" | "createdAt">): Promise<string>;
	deleteProject(id: string): Promise<void>;
}

// Firebase implementation
class FirebaseDataService implements DataService {
	subscribeToProject(
		id: string,
		callback: (result: ProjectSubscriptionResult) => void,
	): () => void {
		let unsubscribe: (() => void) | null = null;

		// Use dynamic import to avoid Firebase in mock mode
		import("firebase/firestore")
			.then(async ({ doc, onSnapshot, getFirestore }) => {
				const { app } = await import("../firebaseConfig");
				const db = getFirestore(app);
				const docRef = doc(db, "projects", id);

				unsubscribe = onSnapshot(
					docRef,
					(docSnap) => {
						// Ignore snapshots that merely echo our own in-flight local
						// writes. During a slider drag we fire many optimistic updates
						// per second; the store already holds the newest value, so
						// re-applying the local echo would fight the drag and reset it.
						if (docSnap.metadata.hasPendingWrites) return;
						if (docSnap.exists()) {
							callback({
								project: { id: docSnap.id, ...docSnap.data() } as Project,
								notFound: false,
							});
						} else {
							// Document genuinely does not exist.
							callback({ project: null, notFound: true });
						}
					},
					() => {
						// An error here is almost always permission-denied: the security
						// rules block reading a project the user does not own. Treat it as
						// "not found" so unauthorized access shows the 404 page.
						callback({ project: null, notFound: true });
					},
				);
			})
			.catch(() => {
				// The dynamic import(s) themselves failed (offline, chunk load
				// failure, bad config) before a Firestore listener could even be
				// set up. This is a genuine infrastructure failure, not a
				// not-found/permission question, so surface it distinctly.
				callback({ project: null, notFound: false, error: true });
			});

		return () => {
			if (unsubscribe) unsubscribe();
		};
	}

	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
		onError?: (error: unknown) => void,
	): () => void {
		let unsubscribe: (() => void) | null = null;

		// Use dynamic import to avoid Firebase in mock mode
		import("firebase/firestore").then(
			async ({ collection, query, where, onSnapshot, getFirestore }) => {
				const { app } = await import("../firebaseConfig");
				const db = getFirestore(app);
				const q = query(
					collection(db, "projects"),
					where("ownerId", "==", userId),
				);

				unsubscribe = onSnapshot(
					q,
					(querySnapshot) => {
						const projects = querySnapshot.docs.map((doc) => ({
							id: doc.id,
							...doc.data(),
						})) as Project[];
						callback(projects);
					},
					(error) => {
						// Unlike subscribeToProject, there is no "not found" state to fall
						// back to here — a failed dashboard listing has no sensible default
						// other than surfacing the error to the caller.
						onError?.(error);
					},
				);
			},
		);

		return () => {
			if (unsubscribe) unsubscribe();
		};
	}

	async updateProject(project: Project): Promise<void> {
		const { doc, updateDoc, getFirestore } = await import("firebase/firestore");
		const { app } = await import("../firebaseConfig");

		const db = getFirestore(app);
		const docRef = doc(db, "projects", project.id);
		const { id: _id, ...projectData } = project;
		await updateDoc(docRef, projectData);
	}

	async createProject(
		project: Omit<Project, "id" | "createdAt">,
	): Promise<string> {
		const { collection, addDoc, getFirestore, serverTimestamp } = await import(
			"firebase/firestore"
		);
		const { app } = await import("../firebaseConfig");

		const db = getFirestore(app);
		const docRef = await addDoc(collection(db, "projects"), {
			...project,
			createdAt: serverTimestamp(),
		});
		return docRef.id;
	}

	async deleteProject(id: string): Promise<void> {
		const { doc, deleteDoc, getFirestore } = await import("firebase/firestore");
		const { app } = await import("../firebaseConfig");

		const db = getFirestore(app);
		const docRef = doc(db, "projects", id);
		await deleteDoc(docRef);
	}
}

// Mock implementation for development/testing
class MockDataService implements DataService {
	subscribeToProject(
		id: string,
		callback: (result: ProjectSubscriptionResult) => void,
	): () => void {
		// A special id lets us exercise the 404 path in mock mode.
		if (id === "not-found") {
			setTimeout(() => callback({ project: null, notFound: true }), 0);
			return () => {};
		}
		// A special id lets us exercise the genuine-error path in mock mode
		// (distinct from "not-found" above), for testing the editor's error UI.
		if (id === "error") {
			setTimeout(
				() => callback({ project: null, notFound: false, error: true }),
				0,
			);
			return () => {};
		}
		// Immediately call with mock data
		setTimeout(
			() => callback({ project: { ...mockProjectData, id }, notFound: false }),
			0,
		);
		// Return no-op unsubscribe function
		return () => {};
	}

	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
		onError?: (error: unknown) => void,
	): () => void {
		// A special userId lets us exercise the error path in mock mode, mirroring
		// the "not-found" id convention in subscribeToProject above.
		if (userId === "error") {
			setTimeout(
				() => onError?.(new Error("mock subscribeToUserProjects failure")),
				0,
			);
			return () => {};
		}
		// Immediately call with mock data
		setTimeout(() => callback([{ ...mockProjectData, ownerId: userId }]), 0);
		// Return no-op unsubscribe function
		return () => {};
	}

	async updateProject(_project: Project): Promise<void> {
		// No-op for mock
	}

	async createProject(
		_project: Omit<Project, "id" | "createdAt">,
	): Promise<string> {
		// Return mock id
		return "mock-project-id";
	}

	async deleteProject(_id: string): Promise<void> {
		// No-op for mock
	}
}

// Factory function to create the appropriate data service
export function createDataService(): DataService {
	if (import.meta.env.VITE_MOCK_BACKEND === "true") {
		return new MockDataService();
	} else {
		return new FirebaseDataService();
	}
}

// Export singleton instance
export const dataService = createDataService();
