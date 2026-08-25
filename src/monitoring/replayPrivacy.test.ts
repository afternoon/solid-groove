// ADR 0002 decision 2 asks that a surface rendering user-authored content be
// marked at the component level, so it is masked "by the default *and* by its
// own markup". That is only worth anything if something checks it: the global
// `maskAllText` default lives in one file and can be weakened from a distance
// — an SDK upgrade, an unmask selector added to make a replay readable, a
// later decision to relax it. The first table below is what stops the
// component-level marking rotting as surfaces move.
//
// The second table has the opposite job, which matters as much. Decision 1
// says replay exists to show where people get stuck, and a replay of grey
// blocks shows nothing, so it pins the surfaces deliberately *not* marked —
// the arrangement canvas, a mixer strip, the piano roll — and fails if a later
// change re-broadens masking over them. One policy read from both ends: mask
// the names, keep the interface.
//
// Both read source rather than rendering components: the question is
// structural, the answer must cover surfaces a later task adds, and rendering
// these panels would need a project fixture, an audio runtime, and a router.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative as relativeTo } from "node:path";
import { describe, expect, it } from "vitest";
import { MASK_ATTRIBUTES, MASK_CONTENT, UNMASK_CONTENT } from "./replayPrivacy";

const sourceRoot = join(process.cwd(), "src");

function read(relative: string): string {
  return readFileSync(join(sourceRoot, relative), "utf8");
}

function componentFiles(directory: string = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * The end of the JSX opening tag starting at `start`, or -1.
 *
 * Scoping to one tag is what makes an assertion about *this element* rather
 * than about the file. A prop is full of characters that look like the tag's
 * end and are not — `>` in an arrow function, an apostrophe in a comment, a `/`
 * that opens a comment — so this skips strings and comments and ends the tag
 * only on a `>` outside them at brace depth zero.
 */
function tagEnd(source: string, start: number): number {
  type Skip = '"' | "'" | "`" | "line" | "block" | null;
  let depth = 0;
  let skipping: Skip = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (skipping === "line") {
      if (char === "\n") skipping = null;
      continue;
    }
    if (skipping === "block") {
      if (char === "*" && next === "/") {
        skipping = null;
        i++;
      }
      continue;
    }
    if (skipping) {
      if (char === skipping) skipping = null;
      continue;
    }
    if (char === "/" && next === "/") skipping = "line";
    else if (char === "/" && next === "*") skipping = "block";
    else if (char === '"' || char === "'" || char === "`") skipping = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Every JSX opening tag containing `anchor`, as raw source. Every occurrence,
 * not the first: a class name that also appears in a comment at the top of its
 * file (`.library-search` is discussed in one) would otherwise be looked for in
 * whatever tag happened to precede that prose.
 */
function openingTagsAround(source: string, anchor: string): string[] {
  const tags: string[] = [];
  for (let at = source.indexOf(anchor); at !== -1; ) {
    const start = source.lastIndexOf("<", at);
    const end = start === -1 ? -1 : tagEnd(source, start);
    if (start !== -1 && end > at) tags.push(source.slice(start, end));
    at = source.indexOf(anchor, at + anchor.length);
  }
  return tags;
}

/**
 * Every element that renders a string a user typed, with the anchor its
 * marking sits on.
 *
 * The bar for a row is narrow and deliberate: a project name, a track name, a
 * clip name (schema v1's only user-writable `name` fields), or the live
 * contents of a text input. An asset, pad, or pack name is a library fact we
 * ship, and masking it would hide which sound someone reached for — the exact
 * behaviour replay is there to observe. Adding a surface that shows one of
 * those three names, or that accepts typed text, means adding it here.
 */
const MASKED_NAMES: readonly {
  readonly file: string;
  readonly anchor: string;
  readonly renders: string;
}[] = [
  {
    file: "components/ProjectList.tsx",
    anchor: "project-title",
    renders: "a project's name on the dashboard",
  },
  {
    file: "components/ProjectList.tsx",
    anchor: "project-rename-input",
    renders: "the new project name as it is typed",
  },
  {
    file: "editor/EditorHeader.tsx",
    anchor: "project-name",
    renders: "the open project's name",
  },
  {
    file: "editor/Mixer.tsx",
    anchor: "mixer-strip-name",
    renders: "the track name, editable in place",
  },
  {
    file: "editor/TrackEditor.tsx",
    anchor: "track-name",
    renders: "the selected track's name",
  },
  {
    file: "editor/EditorView.tsx",
    anchor: "track-name",
    renders: "the drum track's name",
  },
  {
    file: "arrangement/ArrangementView.tsx",
    anchor: "arrangement-header-name",
    renders: "track names down the arrangement's header column",
  },
  {
    file: "arrangement/ArrangementView.tsx",
    anchor: "arrangement-selection-live",
    renders: "the selected track's name, announced to assistive tech",
  },
  {
    file: "arrangement/ArrangementView.tsx",
    anchor: "Arrangement tracks",
    renders: "track names in the arrangement's accessible mirror",
  },
  {
    file: "library/LibraryBrowser.tsx",
    anchor: "library-search",
    renders: "the sound search the user typed",
  },
  {
    file: "library/LibraryFacets.tsx",
    anchor: "library-search",
    renders: "the sound search the user typed",
  },
  {
    file: "library/PackList.tsx",
    anchor: "pack-browser-search",
    renders: "the pack search the user typed",
  },
  {
    file: "components/ConfirmDialog.tsx",
    anchor: "confirm-dialog-title",
    renders: "a project or track name in a delete confirmation",
  },
];

/**
 * Surfaces that stay unmarked, pinned so masking cannot creep back over them.
 *
 * Each is a container whose *contents* are the product — the arrangement's
 * clips, a mixer strip's faders, the piano roll's notes. Most render no
 * user-authored name directly; where one is nested inside, it carries its own
 * marking above. The literal `class="…"` is the assertion: re-broadening
 * masking to one of these means turning it into a template literal, and this
 * fails on that.
 *
 * `arrangement-canvas-stack` is the exception worth stating plainly. It *does*
 * carry user-authored section names, drawn into the canvas by
 * `arrangement/canvasRenderer.ts`, and ADR 0003 turns canvas capture on — so
 * those names are recorded. Masking cannot reach inside a canvas anyway; the
 * disclosure covers it instead of a mark that would do nothing.
 */
const DELIBERATELY_UNMARKED: readonly {
  readonly file: string;
  readonly literal: string;
}[] = [
  {
    file: "arrangement/ArrangementView.tsx",
    literal: 'class="arrangement-canvas-stack"',
  },
  {
    file: "arrangement/ArrangementView.tsx",
    literal: 'class="arrangement-headers"',
  },
  {
    file: "editor/Mixer.tsx",
    literal: 'class="mixer-strip"',
  },
  {
    file: "components/ProjectList.tsx",
    literal: 'class="project-card"',
  },
  {
    file: "editor/PianoRoll.tsx",
    literal: 'class="piano-roll"',
  },
  {
    file: "editor/StepEditor.tsx",
    literal: 'class="step-lane"',
  },
  {
    file: "editor/DrumMachinePanel.tsx",
    literal: 'class="pad-control pad-sample"',
  },
  {
    file: "editor/LoopInfo.tsx",
    literal: 'class="loop-asset"',
  },
  {
    file: "instrument/SamplerPanel.tsx",
    // The sample group carries a layout class of its own; the pin follows the
    // markup so it keeps asserting what it is for — a plain, unmasked string
    // literal, which turning masking back on would have to replace with a
    // template literal.
    literal: 'class="instrument-panel-group sampler-sample-group"',
  },
  // The title beside it *is* masked (see MASKED_NAMES). The message is fixed
  // explanatory copy, and a delete confirmation is friction worth observing.
  {
    file: "components/ConfirmDialog.tsx",
    literal: 'class="confirm-dialog-message"',
  },
];

describe("user-authored names are masked (ADR 0002 decision 2)", () => {
  for (const surface of MASKED_NAMES) {
    it(`masks ${surface.anchor} in ${surface.file}, which renders ${surface.renders}`, () => {
      const tags = openingTagsAround(read(surface.file), surface.anchor);
      expect(
        tags.length,
        `"${surface.anchor}" was not found on an element in ${surface.file}`,
      ).toBeGreaterThan(0);
      expect(
        tags.some((tag) => tag.includes("MASK_CONTENT")),
        `"${surface.anchor}" in ${surface.file} renders ${surface.renders} ` +
          `but does not carry ${MASK_CONTENT}. ADR 0002 decision 2 requires ` +
          "a surface rendering user-authored content to be masked by its own " +
          "markup as well as by the global default.",
      ).toBe(true);
    });
  }

  it("imports the marking from this module rather than writing the class inline", () => {
    // A hand-written "sentry-mask" string would not be found by a rename and
    // would not be found by the check above either.
    for (const file of new Set(MASKED_NAMES.map((s) => s.file))) {
      expect(read(file), `${file} should import its marking`).toContain(
        'from "../monitoring/replayPrivacy"',
      );
    }
  });
});

describe("the interface stays visible (ADR 0002 decision 1)", () => {
  for (const surface of DELIBERATELY_UNMARKED) {
    it(`leaves ${surface.literal} in ${surface.file} unmarked`, () => {
      expect(
        read(surface.file),
        `${surface.literal} in ${surface.file} appears to have been masked or ` +
          "blocked. It is unmarked on purpose: replay is worth having only " +
          "while the interface around a masked name stays legible (ADR 0002 " +
          "decision 1).",
      ).toContain(surface.literal);
    });
  }
});

/**
 * Every dynamic attribute on a *DOM* element whose value interpolates a
 * `.name`, across `src/**\/*.tsx`.
 *
 * A JSX attribute on a capitalised tag is a component prop, not an attribute —
 * `<ConfirmDialog message={...}>` becomes text, `<FillSlider ariaLabel={...}>`
 * becomes an `aria-label` on the DOM element the slider renders, and that
 * element is caught here in its own right. Only a lower-case tag puts the
 * attribute into the recording under the name written here.
 */
function nameBearingAttributes(): { attribute: string; where: string }[] {
  const attribute = /([A-Za-z][A-Za-z-]*)=\{((?:[^{}`]|`[^`]*`|\{[^{}]*\})*)\}/g;
  const found: { attribute: string; where: string }[] = [];
  for (const path of componentFiles()) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(attribute)) {
      if (!/\.name\b/.test(match[2])) continue;
      const tagAt = source.lastIndexOf("<", match.index);
      const tag = source.slice(tagAt + 1).match(/^[A-Za-z][\w.]*/)?.[0] ?? "";
      if (!/^[a-z]/.test(tag)) continue;
      found.push({
        attribute: match[1],
        where: `<${tag} ${match[1]}> in ${relativeTo(sourceRoot, path)}`,
      });
    }
  }
  return found;
}

/**
 * `value` on an input is a name — the mixer's rename field — and is not in
 * `MASK_ATTRIBUTES` because `maskAllInputs` already covers an input's value at
 * capture. Listing it as an attribute as well would be a second name for the
 * same protection.
 */
const MASKED_ELSEWHERE = ["value"];

describe("names in attributes are masked (ADR 0002 decision 2)", () => {
  it("masks aria-label, which is where names reach the DOM", () => {
    expect(MASK_ATTRIBUTES).toContain("aria-label");
  });

  it("keeps the SDK's own defaults, which this list replaces", () => {
    // `maskAttributes` overrides rather than extends, so adding one attribute
    // without these would unmask two.
    expect(MASK_ATTRIBUTES).toContain("title");
    expect(MASK_ATTRIBUTES).toContain("placeholder");
  });

  it("covers every attribute a name is interpolated into", () => {
    const uncovered = nameBearingAttributes().filter(
      (hit) =>
        !MASK_ATTRIBUTES.includes(hit.attribute) &&
        !MASKED_ELSEWHERE.includes(hit.attribute),
    );
    expect(
      uncovered.map((hit) => hit.where),
      "These attributes are built from a name and are recorded verbatim: " +
        "attribute masking is by attribute name, so no class on the element " +
        "covers them. Add the attribute to MASK_ATTRIBUTES, or build the " +
        "value without the name.",
    ).toEqual([]);
  });

  it("finds the attributes it is scanning for", () => {
    // The scan is a regex over source; if it silently matched nothing, the
    // check above would pass by finding no work to do.
    expect(nameBearingAttributes().length).toBeGreaterThan(10);
  });
});

describe("nothing unmasks itself (ADR 0002 decision 2)", () => {
  it("exposes the mask class Sentry looks for by default", () => {
    // Named as a string rather than imported from the SDK, so `sentrySink.ts`
    // stays the only module importing `@sentry/*` (ADR 0001 decision 1).
    expect(MASK_CONTENT).toBe("sentry-mask");
  });

  it("has no component that unmasks itself", () => {
    // Unmasking is permitted only for stable, non-user-authored chrome, and
    // only by an explicit named selector in the SDK configuration — never by a
    // component deciding for itself that its own content is safe to record.
    const offenders: string[] = [];
    for (const file of new Set(MASKED_NAMES.map((s) => s.file))) {
      if (read(file).includes(UNMASK_CONTENT)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
