// Firebase Emulator suite: exercises firestore.rules against a real (local)
// Firestore instance, per PRD 9.9 ("Security rules enforce ownership/
// collaborator access and must be tested against an emulator before sharing
// ships"). This is FND-001's isolated example for the suite; later tasks
// extend it as the rules grow beyond single-owner `projects/{id}` access.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, createTestEnvironment } from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
	testEnv = await createTestEnvironment();
});

afterEach(async () => {
	await testEnv.clearFirestore();
});

afterAll(async () => {
	await testEnv.cleanup();
});

async function seedProject(id: string, data: Record<string, unknown>) {
	await testEnv.withSecurityRulesDisabled(async (context) => {
		await setDoc(doc(context.firestore(), "projects", id), data);
	});
}

describe("firestore.rules: projects/{document}", () => {
	it("allows the owner to read their own project", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertSucceeds(getDoc(doc(asOwnerA, "projects", "prj-a")));
	});

	it("denies reading a project owned by someone else", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const asOwnerB = testEnv.authenticatedContext("owner-b").firestore();
		await assertFails(getDoc(doc(asOwnerB, "projects", "prj-a")));
	});

	it("denies reading without authentication", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const anon = testEnv.unauthenticatedContext().firestore();
		await assertFails(getDoc(doc(anon, "projects", "prj-a")));
	});

	it("allows creating a project whose ownerId matches the caller", async () => {
		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertSucceeds(
			setDoc(doc(asOwnerA, "projects", "prj-new"), { ownerId: "owner-a" }),
		);
	});

	it("denies creating a project owned by someone else", async () => {
		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertFails(
			setDoc(doc(asOwnerA, "projects", "prj-new"), { ownerId: "owner-b" }),
		);
	});

	it("denies creating a project with no ownerId", async () => {
		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertFails(setDoc(doc(asOwnerA, "projects", "prj-new"), {}));
	});

	it("allows the owner to update their own project", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertSucceeds(
			updateDoc(doc(asOwnerA, "projects", "prj-a"), { name: "A2" }),
		);
	});

	it("denies an update that reassigns ownership", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const asOwnerA = testEnv.authenticatedContext("owner-a").firestore();
		await assertFails(
			updateDoc(doc(asOwnerA, "projects", "prj-a"), { ownerId: "owner-b" }),
		);
	});

	it("denies another user updating the project", async () => {
		await seedProject("prj-a", { ownerId: "owner-a", name: "A" });

		const asOwnerB = testEnv.authenticatedContext("owner-b").firestore();
		await assertFails(
			updateDoc(doc(asOwnerB, "projects", "prj-a"), { name: "hijacked" }),
		);
	});
});
