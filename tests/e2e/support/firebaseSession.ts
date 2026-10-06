import type { Page } from "@playwright/test";

/**
 * Installs a signed-in Firebase user into a page's browser context, the way a
 * returning producer's browser already holds one, without touching the
 * product's own sign-in control. Shared by the emulator suite
 * (`tests/e2e/emulator/support/authSession.ts`) and the hosted suites that
 * sign in as a QA account (`tests/e2e/hosted/qaSession.ts`, #1055).
 *
 * The SDK persists the signed-in user in IndexedDB under a key built from the
 * app's API key, and the record it stores is `user.toJSON()`. Callers sign the
 * account in with the same Firebase SDK the app runs, in Node, and hand over
 * *that user's own* `toJSON()`, so the record is never hand-written: the SDK
 * restores it because it is the SDK's own format, whatever version is
 * installed.
 */

const DB_NAME = "firebaseLocalStorageDb";
const STORE_NAME = "firebaseLocalStorage";
/** The app's Firebase app name: it initialises the default app. */
const APP_NAME = "[DEFAULT]";

/**
 * The key the SDK stores the signed-in user under. The API key is
 * load-bearing: it must be the one the page's build runs with, or the app
 * looks under a different key and finds nobody.
 */
export function authUserPersistenceKey(apiKey: string): string {
  return `firebase:authUser:${apiKey}:${APP_NAME}`;
}

/**
 * Writes `record` (a `user.toJSON()`) into the page's origin as the signed-in
 * user, and leaves the page on `about:blank`, ready for the caller's own first
 * navigation. The session lives in the browser context, so it covers any
 * further page that context opens and survives `page.reload()`.
 */
export async function installFirebaseUser(
  page: Page,
  apiKey: string,
  record: Record<string, unknown>,
): Promise<void> {
  // Any same-origin document that does not boot the app, so nothing reads or
  // writes the store while the record goes in. The landing page would load
  // the auth SDK only on a click, but a static file is plainly inert.
  await page.goto("/robots.txt");
  await page.evaluate(putRow, [
    DB_NAME,
    STORE_NAME,
    authUserPersistenceKey(apiKey),
    record,
  ] as const);
  await page.goto("about:blank");
}

/**
 * The signed-in user's ID as Firebase has persisted it in this page's
 * IndexedDB, or `null` while it has not written one yet.
 *
 * Read from storage rather than the app, because storage is what a saved
 * session carries to the next browser context.
 */
export function persistedUid(page: Page): Promise<string | null> {
  return page.evaluate(
    ([dbName, storeName]) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }
          const all = db.transaction(storeName).objectStore(storeName).getAll();
          all.onerror = () => resolve(null);
          all.onsuccess = () => {
            const user = all.result.find((entry) => entry?.value?.uid);
            db.close();
            resolve(user?.value.uid ?? null);
          };
        };
      }),
    [DB_NAME, STORE_NAME] as const,
  );
}

/** Runs in the page: write one row into the SDK's persistence store. */
function putRow([dbName, storeName, fbaseKey, record]: readonly [
  string,
  string,
  string,
  unknown,
]) {
  return new Promise<void>((resolve, reject) => {
    // Version 1 with a `fbase_key`-keyed store is what the SDK itself opens
    // and creates; on a fresh origin this creates it the same way.
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "fbase_key" });
    };
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
