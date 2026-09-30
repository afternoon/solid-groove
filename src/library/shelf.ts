import type { LibraryAsset } from "./manifest";

/**
 * The library's browsing model (LIB-010): scope, the two-level shelf, the slot
 * pre-filter and the filters, as pure functions over already-loaded assets.
 *
 * Framework-free on purpose: the modal is a thin view over these, so every rule
 * (what a family holds, which roles show, what a drum pad opens on) is testable
 * without a DOM, and the same answer drives the chips, the counts and the keys.
 */

/** The shelf's first row: the taxonomy's one-shot families, then Loops. */
export const SHELF_FAMILIES = [
  "drums",
  "bass",
  "tonal",
  "texture",
  "fx",
  "loops",
] as const;
export type ShelfFamily = (typeof SHELF_FAMILIES)[number];

/** The one-shot roles per family, in taxonomy order (`scripts/starter-library/taxonomy.mjs`). */
const ONE_SHOT_ROLES: Record<Exclude<ShelfFamily, "loops">, readonly string[]> = {
  drums: [
    "kick",
    "snare",
    "clap",
    "rim",
    "closed-hat",
    "open-hat",
    "cymbal",
    "tom",
    "percussion",
  ],
  bass: ["sub", "sustained", "stab", "reese"],
  tonal: ["chord", "stab", "pluck", "key", "mallet", "bell"],
  texture: ["noise", "ambience", "drone", "mechanical", "organic"],
  fx: ["impact", "riser", "downer", "sweep", "reverse", "glitch"],
};

/** Loop roles (`LOOP_TAXONOMY`), flattened in family order: loops share one row. */
const LOOP_ROLES: readonly string[] = [
  "full-loop",
  "top-loop",
  "percussion-loop",
  "bassline",
  "chord-loop",
  "melodic-loop",
  "atmosphere-loop",
];

const FAMILY_LABELS: Record<ShelfFamily, string> = {
  drums: "Drums",
  bass: "Bass",
  tonal: "Tonal",
  texture: "Texture",
  fx: "FX",
  loops: "Loops",
};

export function familyLabel(family: ShelfFamily): string {
  return FAMILY_LABELS[family];
}

/** "closed-hat" -> "Closed hat": the singular a chip shows (the tree pluralises). */
export function roleLabel(role: string): string {
  const words = role.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The shelf family an asset sits under, or `null` for what the shelf does not
 * show (presets, and one-shots whose family is outside the taxonomy).
 */
export function shelfFamilyOf(asset: LibraryAsset): ShelfFamily | null {
  if (asset.type === "loop") return "loops";
  if (asset.type !== "one-shot") return null;
  return asset.family in ONE_SHOT_ROLES ? (asset.family as ShelfFamily) : null;
}

/**
 * A family's roles in taxonomy order. A role the taxonomy does not know is
 * appended alphabetically rather than hidden, so a newer manifest never loses sounds.
 */
export function rolesOf(family: ShelfFamily, present: readonly string[] = []): string[] {
  const known = family === "loops" ? LOOP_ROLES : ONE_SHOT_ROLES[family];
  const unknown = [...new Set(present)].filter((role) => !known.includes(role)).sort();
  return [...known, ...unknown];
}

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

/** Which family and role are chosen; `role: null` is "All <family>". */
export interface ShelfSelection {
  readonly family: ShelfFamily;
  readonly role: string | null;
}

export interface ShelfEntry<K extends string> {
  readonly key: K;
  readonly label: string;
  readonly count: number;
}

/** Families that have sounds, in shelf order, with counts. */
export function shelfFamilies(
  sounds: readonly LibraryAsset[],
): ShelfEntry<ShelfFamily>[] {
  const counts = new Map<ShelfFamily, number>();
  for (const sound of sounds) {
    const family = shelfFamilyOf(sound);
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return SHELF_FAMILIES.filter((f) => counts.has(f)).map((key) => ({
    key,
    label: familyLabel(key),
    count: counts.get(key) ?? 0,
  }));
}

/** A family's roles that have sounds, in taxonomy order, with counts. */
export function shelfRoles(
  sounds: readonly LibraryAsset[],
  family: ShelfFamily,
): ShelfEntry<string>[] {
  const counts = new Map<string, number>();
  for (const sound of sounds) {
    if (shelfFamilyOf(sound) === family)
      counts.set(sound.role, (counts.get(sound.role) ?? 0) + 1);
  }
  return rolesOf(family, [...counts.keys()])
    .filter((role) => counts.has(role))
    .map((role) => ({ key: role, label: roleLabel(role), count: counts.get(role) ?? 0 }));
}

/**
 * Keep the selection valid when scope or filters change: a family with no
 * sounds falls back to the first that has some, and a role with none falls back
 * to "all roles". With nothing in view the selection is returned as it is.
 */
export function settle(
  sounds: readonly LibraryAsset[],
  selection: ShelfSelection,
): ShelfSelection {
  const families = shelfFamilies(sounds);
  if (families.length === 0) return selection;
  const family = families.some((f) => f.key === selection.family)
    ? selection.family
    : families[0].key;
  const role =
    family === selection.family &&
    selection.role !== null &&
    shelfRoles(sounds, family).some((r) => r.key === selection.role)
      ? selection.role
      : null;
  return { family, role };
}

/** The sounds the list shows for a (settled) selection. */
export function soundsInView(
  sounds: readonly LibraryAsset[],
  selection: ShelfSelection,
): LibraryAsset[] {
  return sounds.filter(
    (sound) =>
      shelfFamilyOf(sound) === selection.family &&
      (selection.role === null || sound.role === selection.role),
  );
}

// ---------------------------------------------------------------------------
// The slot pre-filter
// ---------------------------------------------------------------------------

/** What the library was opened for. */
export type LibrarySlot =
  | { readonly kind: "drum-pad"; readonly sound: LibraryAsset | null }
  | { readonly kind: "sampler" }
  | { readonly kind: "loop-track" };

/**
 * Where the library opens. A pad's own name is never read: only the manifest
 * entry of the sound it holds. An empty pad, or a sound the library cannot
 * place (`sound: null`, or outside the drums family), opens on Drums with all roles.
 */
export function slotSelection(slot: LibrarySlot): ShelfSelection {
  switch (slot.kind) {
    case "sampler":
      return { family: "tonal", role: null };
    case "loop-track":
      return { family: "loops", role: null };
    case "drum-pad":
      return {
        family: "drums",
        role:
          slot.sound && shelfFamilyOf(slot.sound) === "drums" ? slot.sound.role : null,
      };
  }
}
