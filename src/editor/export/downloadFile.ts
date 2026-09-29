/** How long a downloaded file's object URL outlives the click that used it. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Hands `file` to the browser as a download named `fileName`: an object URL
 * behind a transient `download` link, revoked once the browser has had time to
 * start reading it. The `Blob` is used as it is, never copied, so a long
 * export is not held in memory twice on its way out.
 */
export function downloadFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
