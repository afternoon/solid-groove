import mockProjectData from "./mockProjectData";
import type { Project } from "./types";

export interface DataService {
	subscribeToProject(
		id: string,
		callback: (project: Project | null) => void,
	): () => void;
	subscribeToUserProjects(
		userId: string,
		callback: (projects: Project[]) => void,
	): () => void;
	updateProject(project: Project): Promise<void>;
	createProject(project: Omit<Project, "id">): Promise<string>;
	deleteProject(id: string): Promise<void>;
}

// Firebase implementation
class FirebaseDataService implements DataService {
	subscribeToProject(
		id: string,
		callback: (project: Project | null) => void,
	): () => void {
		let unsubscribe: (() => void) | null = null;

		// Use dynamic import to avoid Firebase in mock mode
		import("firebase/firestore").then(
			async ({ doc, onSnapshot, getFirestore }) => {
				const { app } = await import("../firebaseConfig");
				const db = getFirestore(app);
				const docRef = doc(db, "projects", id);

				unsubscribe = onSnapshot(docRef, (docSnap) => {
					if (docSnap.exists()) {
						callback({ id: docSnap.id, ...docSnap.data() } as Project);
					} else {
						callback(null);
					}
				});
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

	async createProject(project: Omit<Project, "id">): Promise<string> {
		const { collection, addDoc, getFirestore } = await import(
			"firebase/firestore"
		);
		const { app } = await import("../firebaseConfig");

		const db = getFirestore(app);
		const docRef = await addDoc(collection(db, "projects"), project);
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
		callback: (project: Project | null) => void,
	): () => void {
		// Immediately call with mock data
		setTimeout(() => callback({ ...mockProjectData, id }), 0);
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

	async updateProject(project: Project): Promise<void> {
		// No-op for mock
	}

	async createProject(project: Omit<Project, "id">): Promise<string> {
		// Return mock id
		return "mock-project-id";
	}

	async deleteProject(id: string): Promise<void> {
		// No-op for mock
	}
}

// Factory function to create the appropriate data service
export function createDataService(): DataService {
	if (import.meta.env.DEV) {
		return new MockDataService();
	} else {
		return new FirebaseDataService();
	}
}

// Export singleton instance
export const dataService = createDataService();
