// Firebase Emulator suite for the alpha allowlist (#854): who can read and
// write `allowlist/{email}` and `signInAttempts/{email}`.
//
// Only an account with the `admin: true` custom claim reaches either
// collection from a client. Everyone else — a listed producer, an unlisted
// one, a guest — can neither read the list nor put themselves on it. The
// blocking function and the scripts write with the admin credential, which
// `withSecurityRulesDisabled` stands in for here.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { allowlistDocPath, signInAttemptDocPath } from "../../src/access/allowlist";
import {
  anonymousContext,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  emulatorProjectId,
  registeredContext,
} from "./setup";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await createTestEnvironment(emulatorProjectId("allowlist"));
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

const LISTED = "listed@example.com";
const UNLISTED = "unlisted@example.com";

function adminContext() {
  return testEnv.authenticatedContext("admin-uid", {
    admin: true,
    firebase: { sign_in_provider: "google.com" },
  });
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, allowlistDocPath(LISTED)), { email: LISTED, addedAt: 1 });
    await setDoc(doc(db, signInAttemptDocPath(UNLISTED)), {
      email: UNLISTED,
      firstAttemptAt: 1,
      lastAttemptAt: 2,
      count: 2,
    });
  });
}

describe("allowlist rules", () => {
  it("lets an admin read, add and remove addresses", async () => {
    await seed();
    const db = adminContext().firestore();
    await assertSucceeds(getDocs(collection(db, "allowlist")));
    await assertSucceeds(getDoc(doc(db, allowlistDocPath(LISTED))));
    await assertSucceeds(
      setDoc(doc(db, allowlistDocPath(UNLISTED)), { email: UNLISTED, addedAt: 3 }),
    );
    await assertSucceeds(deleteDoc(doc(db, allowlistDocPath(LISTED))));
  });

  it("refuses an admin write that is not a normalised address or a well-formed entry", async () => {
    const db = adminContext().firestore();
    await assertFails(
      setDoc(doc(db, "allowlist/Shout@Example.com"), {
        email: "Shout@Example.com",
        addedAt: 1,
      }),
    );
    await assertFails(
      setDoc(doc(db, "allowlist/not-an-address"), {
        email: "not-an-address",
        addedAt: 1,
      }),
    );
    await assertFails(
      setDoc(doc(db, allowlistDocPath(UNLISTED)), { email: LISTED, addedAt: 1 }),
    );
    await assertFails(
      setDoc(doc(db, allowlistDocPath(UNLISTED)), {
        email: UNLISTED,
        addedAt: 1,
        note: "extra",
      }),
    );
  });

  it("refuses a listed producer: they cannot read the list or change it", async () => {
    await seed();
    const db = registeredContext(testEnv, "listed-uid").firestore();
    await assertFails(getDoc(doc(db, allowlistDocPath(LISTED))));
    await assertFails(getDocs(collection(db, "allowlist")));
    await assertFails(
      setDoc(doc(db, allowlistDocPath(UNLISTED)), { email: UNLISTED, addedAt: 1 }),
    );
    await assertFails(deleteDoc(doc(db, allowlistDocPath(LISTED))));
  });

  it("refuses an unlisted account and a guest putting themselves on the list", async () => {
    for (const context of [
      registeredContext(testEnv, "unlisted-uid"),
      anonymousContext(testEnv, "guest-uid"),
      testEnv.unauthenticatedContext(),
    ]) {
      const db = context.firestore();
      await assertFails(
        setDoc(doc(db, allowlistDocPath(UNLISTED)), { email: UNLISTED, addedAt: 1 }),
      );
      await assertFails(getDoc(doc(db, allowlistDocPath(UNLISTED))));
    }
  });

  it("does not take an admin claim that is anything but true", async () => {
    const db = testEnv
      .authenticatedContext("not-quite-admin", { admin: "true" })
      .firestore();
    await assertFails(getDocs(collection(db, "allowlist")));
  });
});

describe("sign-in attempt rules", () => {
  it("lets an admin read attempts and clear one, never write one", async () => {
    await seed();
    const db = adminContext().firestore();
    await assertSucceeds(getDocs(collection(db, "signInAttempts")));
    await assertFails(
      setDoc(doc(db, signInAttemptDocPath(LISTED)), {
        email: LISTED,
        firstAttemptAt: 1,
        lastAttemptAt: 1,
        count: 1,
      }),
    );
    await assertSucceeds(deleteDoc(doc(db, signInAttemptDocPath(UNLISTED))));
  });

  it("refuses everyone else, the person who was refused included", async () => {
    await seed();
    for (const context of [
      registeredContext(testEnv, "unlisted-uid"),
      anonymousContext(testEnv, "guest-uid"),
    ]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, signInAttemptDocPath(UNLISTED))));
      await assertFails(deleteDoc(doc(db, signInAttemptDocPath(UNLISTED))));
      await assertFails(
        setDoc(doc(db, signInAttemptDocPath(UNLISTED)), {
          email: UNLISTED,
          firstAttemptAt: 1,
          lastAttemptAt: 1,
          count: 1,
        }),
      );
    }
  });
});
