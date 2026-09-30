// A hidden design tool for trying Google Fonts on the live UI without a build.
//
// `?font=Inter` loads Inter from Google Fonts and makes it the whole UI's
// font. The choice is kept in `localStorage`, so it survives navigation and
// reloads; `?font=off` (or an empty `?font=`) goes back to the default stack.
// It changes nothing unless someone asks for it, and it never reaches
// analytics.

export const FONT_OVERRIDE_STORAGE_KEY = "sg_font_override";

const LINK_ID = "sg-font-override";
const OFF_VALUES = new Set(["", "off", "none", "0", "false"]);
// Google Fonts family names are letters, digits and spaces.
const FAMILY_PATTERN = /^[A-Za-z0-9 ]{1,60}$/;

/**
 * Pure parse of a `?font=` value: a family name to use, `null` to clear the
 * override, or `undefined` when the URL made no claim (absent or invalid).
 */
export function parseFontParam(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  const family = value.trim().replace(/\s+/g, " ");
  if (OFF_VALUES.has(family.toLowerCase())) return null;
  return FAMILY_PATTERN.test(family) ? family : undefined;
}

/** The Google Fonts stylesheet for one family at the weights the UI uses. */
export function googleFontsHref(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600;700&display=swap`;
}

function readStored(storage: Storage): string | null {
  try {
    return parseFontParam(storage.getItem(FONT_OVERRIDE_STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function writeStored(family: string | null, storage: Storage): void {
  try {
    if (family) storage.setItem(FONT_OVERRIDE_STORAGE_KEY, family);
    else storage.removeItem(FONT_OVERRIDE_STORAGE_KEY);
  } catch {
    // A design tool never blocks the app.
  }
}

function apply(family: string | null, doc: Document): void {
  doc.getElementById(LINK_ID)?.remove();
  const root = doc.documentElement;
  if (!family) {
    root.style.removeProperty("--font-family");
    return;
  }
  const link = doc.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = googleFontsHref(family);
  doc.head.append(link);
  root.style.setProperty("--font-family", `"${family}", system-ui, sans-serif`);
}

/**
 * Call once per app load. Reads `?font=`, persists any claim it makes, and
 * applies the resulting override (or none). Returns the family in use.
 */
export function syncFontOverride(
  location: Pick<Location, "search"> = window.location,
  storage: Storage = localStorage,
  doc: Document = document,
): string | null {
  const claim = parseFontParam(new URLSearchParams(location.search).get("font"));
  if (claim !== undefined) writeStored(claim, storage);
  const family = claim !== undefined ? claim : readStored(storage);
  apply(family, doc);
  return family;
}
