/** How long a downloaded file's object URL outlives the click that used it. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Hands `bytes` to the browser as a download named `fileName`: an object URL
 * behind a transient `download` link, revoked once the browser has had time to
 * start reading it.
 */
export function downloadBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
