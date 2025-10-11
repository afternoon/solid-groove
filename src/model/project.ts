import { doc, getFirestore } from "firebase/firestore";
import { useFirebaseApp, useFirestoreOnce } from "solid-firebase";
import { createMemo, type Signal } from "solid-js";
import mockProjectData from "./mockProjectData";
import type { Project } from "./types";

interface ProjectState {
	loading: boolean | null;
	error: string | null;
	data: Project | null;
}

export function useProject(id: string): Signal<ProjectState> {
	if (import.meta.env.DEV) {
		return createMemo(() => {
			return {
				loading: false,
				error: false,
				data: mockProjectData,
			};
		});
	}

	const app = useFirebaseApp(); // TODO this relies on context, does it work outside of a component?
	const db = getFirestore(app);
	return createMemo(() => useFirestoreOnce(doc(db, "projects", id)));
}
