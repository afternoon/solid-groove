import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// In mock mode the app talks to the in-memory mock services rather than real
// Firebase, so we don't need real credentials. Fall back to harmless
// placeholder values so `initializeApp` succeeds and the UI can render without
// a configured .env.
const isMock = import.meta.env.VITE_MOCK_BACKEND === "true";

const firebaseConfig = {
	apiKey:
		import.meta.env.VITE_FIREBASE_API_KEY ??
		(isMock ? "mock-api-key" : undefined),
	authDomain:
		import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
		(isMock ? "mock.firebaseapp.com" : undefined),
	projectId:
		import.meta.env.VITE_FIREBASE_PROJECT_ID ??
		(isMock ? "mock-project" : undefined),
	databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId:
		import.meta.env.VITE_FIREBASE_APP_ID ??
		(isMock ? "mock-app-id" : undefined),
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Analytics is optional and only works in supported environments with a valid
// measurementId. Initialize it lazily so a missing/invalid config never breaks
// app startup (e.g. when running without Firebase env vars configured).
export const analytics = isSupported()
	.then((supported) =>
		supported && firebaseConfig.measurementId ? getAnalytics(app) : null,
	)
	.catch(() => null);
