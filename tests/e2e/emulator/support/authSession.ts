import type { Page } from "@playwright/test";

/**
 * Puts a **registered** (non-anonymous) Firebase session into a page, without
 * going anywhere near the product's own login control.
 *
 * ## Why
 *
 * A flow whose precondition is "signed in to an account" needs an account, and
 * there are two ways to get one: drive the identity provider's UI, or install
 * the session the way a returning visitor's browser already has it installed.
 * Driving the provider makes every such flow depend on our login control's
 * markup *and* on the Auth emulator's account chooser, so a change to either
 * reddens flows that are not about logging in at all. This takes the second
 * route: logging in is a journey of its own and belongs to a flow of its own.
 *
 * ## Why it is not a pile of guesses
 *
 * The SDK persists the signed-in user in IndexedDB under a key built from the
 * app's API key, in a record shape that is the SDK's private business. Writing
 * either by hand would be a guess against an internal contract, and a wrong
 * guess fails as a session that silently does not restore.
 *
 * So nothing here is hand-written. The page is loaded once as a guest first —
 * `AuthProvider` creates an anonymous session on arrival, which makes the SDK
 * write *its own* record — and that record becomes the template: same key, same
 * shape, with only the identity fields replaced by those of a real account
 * minted through the Auth emulator's REST API. The SDK restores it because it is
 * the SDK's own format, whatever version is installed. The throwaway anonymous
 * account stays in the emulator, which is wiped with the run.
 */

/**
 * Where `firebase emulators:exec` bound the Auth emulator, exported into this
 * process the same way `tests/e2e/emulator/playwright.config.ts` reads it. The
 * documented default keeps this module loadable outside that wrapper.
 */
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

/**
 * The emulator does not validate the API key in a REST call, so this is
 * deliberately a literal rather than the app's own key. The key that *does* have
 * to be right is the one in the IndexedDB record, and that one is read from the
 * page rather than written here.
 */
const REST_API_KEY = "emulator-ignores-this";

const DB_NAME = "firebaseLocalStorageDb";
const STORE_NAME = "firebaseLocalStorage";

/** What the SDK stores per persisted user, as far as this module cares. */
interface PersistedUser {
  stsTokenManager: { refreshToken: string; accessToken: string; expirationTime: number };
  [key: string]: unknown;
}

interface EmulatorAccount {
  localId: string;
  idToken: string;
  refreshToken: string;
  expiresIn?: string;
}

export interface RegisteredSession {
  uid: string;
  email: string;
  displayName: string;
}

export interface SeedRegisteredSessionOptions {
  /**
   * Distinguishes this run's account from every other. A flow whose
   * precondition is an *empty* library cannot reuse an account across runs, so
   * callers pass something unique (the spec id and browser name, say).
   */
  label: string;
  displayName?: string;
}

/**
 * Signs `page` in as a fresh registered account and leaves it on a blank page,
 * ready for the caller's own first navigation.
 *
 * The session lives in the browser context, so it also covers any further page
 * that context opens, and it survives `page.reload()` as a real one does.
 */
export async function seedRegisteredSession(
  page: Page,
  options: SeedRegisteredSessionOptions,
): Promise<RegisteredSession> {
  const email = `${options.label}-${Date.now()}@example.test`;
  const displayName = options.displayName ?? "Flow Producer";

  // A guest visit, purely so the SDK writes a record of its own to copy.
  // `/dashboard` is where `AuthProvider` runs the anonymous start.
  await page.goto("/dashboard");
  const template = await readPersistedUser(page);

  // A real account, through the emulator's Google-provider endpoint, so the
  // session carries `google.com` the way a genuine login would.
  const account = await signInWithGoogleThroughEmulator(email, displayName);

  // The SDK's own record with this account's identity in place of the guest's.
  // Anything not named here is left exactly as the SDK wrote it.
  //
  // Written once, deliberately, rather than re-applied on every later document.
  // It does not need to be — a restored *registered* session means
  // `AuthProvider` never reaches its no-user branch, so nothing overwrites this
  // key — and re-applying it would do real damage: it would put these tokens
  // back over any the SDK had since refreshed, and it would make a later
  // `page.reload()` a replay of seeded state rather than a genuine read of what
  // persisted, which is the one thing every flow's last step exists to prove.
  await page.evaluate(putRow, [
    DB_NAME,
    STORE_NAME,
    template.key,
    {
      ...template.value,
      uid: account.localId,
      email,
      displayName,
      isAnonymous: false,
      emailVerified: true,
      providerData: [
        {
          providerId: "google.com",
          uid: email,
          displayName,
          email,
          phoneNumber: null,
          photoURL: null,
        },
      ],
      stsTokenManager: {
        ...template.value.stsTokenManager,
        refreshToken: account.refreshToken,
        accessToken: account.idToken,
        expirationTime: Date.now() + Number(account.expiresIn ?? 3600) * 1000,
      },
    },
  ] as const);

  // The guest session is still live in this page's memory; only what is stored
  // has changed. Leave the caller a page that has not loaded the app, so their
  // first `goto` boots from the record just written.
  await page.goto("about:blank");

  return { uid: account.localId, email, displayName };
}

/** Mints a Google-provider account and returns its fresh tokens. */
async function signInWithGoogleThroughEmulator(
  email: string,
  displayName: string,
): Promise<EmulatorAccount> {
  const endpoint =
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp` +
    `?key=${REST_API_KEY}`;
  // The emulator accepts an unsigned JSON "id token" in place of a signed one —
  // that substitution is the whole point of an auth emulator.
  const idToken = JSON.stringify({
    sub: `google-${email}`,
    email,
    email_verified: true,
    name: displayName,
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
      requestUri: "http://localhost",
      returnIdpCredential: true,
      returnSecureToken: true,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `The Auth emulator refused to mint an account (${response.status}): ` +
        `${await response.text()}`,
    );
  }
  return (await response.json()) as EmulatorAccount;
}

/**
 * Reads back the one persisted user the SDK just wrote, with the key it chose.
 *
 * Polls, because the record is written asynchronously after the anonymous
 * sign-in resolves, and fails with what it did find — "no record" almost always
 * means the app never reached a signed-in state at all.
 */
async function readPersistedUser(
  page: Page,
): Promise<{ key: string; value: PersistedUser }> {
  const deadline = Date.now() + 15_000;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    const rows = await page.evaluate(readRows, [DB_NAME, STORE_NAME] as const);
    seen = rows.map((row) => row.fbase_key);
    const user = rows.find((row) => row.fbase_key.startsWith("firebase:authUser:"));
    if (user) return { key: user.fbase_key, value: user.value as PersistedUser };
    await page.waitForTimeout(250);
  }
  throw new Error(
    "The Firebase SDK never persisted a signed-in user, so there is no record " +
      `to model a registered session on. Keys present: ${seen.join(", ") || "none"}. ` +
      "This usually means the app did not reach a signed-in state — check that " +
      "the Auth emulator is running and that the dashboard loaded.",
  );
}

/** Runs in the page: every row in the SDK's persistence store. */
function readRows([dbName, storeName]: readonly [string, string]) {
  return new Promise<{ fbase_key: string; value: unknown }[]>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve([]);
        return;
      }
      const all = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        db.close();
        resolve(all.result as { fbase_key: string; value: unknown }[]);
      };
    };
  });
}

/** Runs in the page: overwrite one row in the SDK's persistence store. */
function putRow([dbName, storeName, fbaseKey, record]: readonly [
  string,
  string,
  string,
  unknown,
]) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put({ fbase_key: fbaseKey, value: record });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
