import type { Page } from "@playwright/test";

/**
 * The signed-in user's ID as Firebase has persisted it in this page's
 * IndexedDB, or `null` while it has not written one yet.
 *
 * Read from storage rather than the app, because storage is what a saved
 * session carries to the next browser context: a user the app holds only in
 * memory is a user the sweep cannot get back to, to clean up after.
 */
export function guestUid(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open("firebaseLocalStorageDb");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
            db.close();
            resolve(null);
            return;
          }
          const all = db
            .transaction("firebaseLocalStorage")
            .objectStore("firebaseLocalStorage")
            .getAll();
          all.onerror = () => resolve(null);
          all.onsuccess = () => {
            const user = all.result.find((entry) => entry?.value?.uid);
            db.close();
            resolve(user?.value.uid ?? null);
          };
        };
      }),
  );
}
