import mockProjectData from "./mockProjectData";
import type { Project } from "./types";

/**
 * Result passed to a project subscription callback.
 * - `project` is the loaded project, or `null` when the project does not exist
 *   or the current user is not allowed to read it (Firestore returns a
 *   permission-denied error). Both cases are surfaced as "not found" so we
 *   never leak the existence of another user's project.
 */
export type ProjectSubscriptionResult = {
	project: Project | null;
	notFound: boolean;
};

export interface DataService {
	subscribeToProject(
		id: string,
		callback: (result: ProjectSubscriptionResult) => void,
	): () => void;
	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
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
		import("firebase/firestore").then(
			async ({ doc, onSnapshot, getFirestore }) => {
				const { app } = await import("../firebaseConfig");
				const db = getFirestore(app);
				const docRef = doc(db, "projects", id);

				unsubscribe = onSnapshot(
					docRef,
					(docSnap) => {
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
			},
		);

		return () => {
			if (unsubscribe) unsubscribe();
		};
	}

	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
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

				unsubscribe = onSnapshot(q, (querySnapshot) => {
					const projects = querySnapshot.docs.map((doc) => ({
						id: doc.id,
						...doc.data(),
					})) as Project[];
					callback(projects);
				});
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
	): () => void {
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
