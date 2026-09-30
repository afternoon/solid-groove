/**
 * The name an export downloads under: `<project name> <YYYY-MM-DD>.<ext>`
 * (CF-021), with the date on the producer's own clock.
 *
 * A project name is free text and a file name is not, so the name is made safe
 * for every desktop file system rather than trusted: characters Windows,
 * macOS or Linux refuse (`\ / : * ? " < > |` and control characters) become a
 * space, runs of whitespace collapse, and leading or trailing dots and spaces
 * go (Windows drops a trailing dot silently; a leading one hides the file). A
 * name that leaves nothing, or that Windows reserves (`CON`, `NUL`, …), falls
 * back to "Untitled". An ordinary name passes through unchanged.
 */

export const FALLBACK_EXPORT_NAME = "Untitled";

/** Room for the date and extension inside a 255-byte file-name limit. */
const MAX_NAME_LENGTH = 120;

const UNSAFE_CHARACTERS = /[\\/:*?"<>|\p{Cc}]/gu;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A project name made safe to use as the stem of a file name. */
export function safeFileStem(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(UNSAFE_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .replace(/^[\s.]+|[\s.]+$/gu, "");
  const bounded = [...cleaned].slice(0, MAX_NAME_LENGTH).join("").trimEnd();
  if (bounded.length === 0 || RESERVED_WINDOWS_NAMES.test(bounded)) {
    return FALLBACK_EXPORT_NAME;
  }
  return bounded;
}

/** `YYYY-MM-DD` for `date` in the local time zone. */
export function localDateStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The download name for an export of `projectName` made at `date`. */
export function exportFileName(
  projectName: string,
  date: Date,
  extension: string,
): string {
  return `${safeFileStem(projectName)} ${localDateStamp(date)}.${extension}`;
}
