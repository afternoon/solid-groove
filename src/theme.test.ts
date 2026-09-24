import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "./arrangement/canvasRenderer";

/* Read from disk rather than through Vite: the unit suite stubs CSS modules
   out, so an import — `?raw` included — hands back an empty string. */
const SRC_DIR = resolve(process.cwd(), "src");

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFilesUnder(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** Every stylesheet under `src/`, as written on disk, keyed by relative path. */
const stylesheets = Object.fromEntries(
  cssFilesUnder(SRC_DIR).map((path) => [
    relative(SRC_DIR, path).split(sep).join("/"),
    readFileSync(path, "utf8"),
  ]),
);

const themeCss = stylesheets["theme.css"] ?? "";

/**
 * Every colour the product paints is named once, in `src/theme.css`. These
 * tests are what keeps that true: a stylesheet that reintroduces a literal, a
 * token that is read but never defined, or a canvas fallback that drifts away
 * from the theme all fail here rather than quietly costing the next palette
 * change a sweep across twenty-odd files.
 */

/** `--token: value;` declarations, as written in `theme.css`. */
function themeTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, name, value] of themeCss.matchAll(
    /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim,
  )) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

/** Resolve a token through however many `var(--x)` aliases it is defined by. */
function resolveToken(name: string): string {
  const tokens = themeTokens();
  let value = tokens.get(name);
  for (let hops = 0; value !== undefined && hops < 10; hops += 1) {
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!alias?.[1]) return value;
    value = tokens.get(alias[1]);
  }
  return value ?? "";
}

const COLOR_LITERAL =
  /#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)|(?<![-\w])(?:white|black|lightgrey|lightgray|grey|gray|red|blue|green)(?![-\w])/gi;

/** The app's stylesheets, which is every one of them but the theme itself. */
function appStylesheets(): Record<string, string> {
  const sheets: Record<string, string> = {};
  for (const [path, source] of Object.entries(stylesheets)) {
    if (path !== "theme.css") sheets[path] = source;
  }
  return sheets;
}

/**
 * The values a stylesheet declares — not its selectors or property names, so
 * `.pr-key.black` and `white-space: nowrap` are not mistaken for colours.
 */
function declaredValues(source: string): string[] {
  return [
    ...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/[a-z-]+\s*:\s*([^;{}]+)[;}]/gi),
  ].map(([, value]) => String(value));
}

describe("the theme is the only place a colour is written down", () => {
  it("defines the accent, the neutral ramp, and the status colours", () => {
    const tokens = themeTokens();
    for (const name of [
      "--color-accent",
      "--color-background",
      "--color-text",
      "--color-danger",
      "--color-warning",
      "--color-success",
    ]) {
      expect(tokens.has(name), `${name} is missing from theme.css`).toBe(true);
    }
  });

  it("is literally monochrome — every colour is a neutral grey", () => {
    // The whole point of the palette: no hue anywhere in the interface
    // chrome. A tinted grey is as much a violation as a blue one, so this
    // asserts R === G === B rather than merely "low saturation".
    const coloured: string[] = [];
    for (const [name, value] of themeTokens()) {
      const hex = /^#([0-9a-f]{6})$/i.exec(resolveToken(name));
      if (!hex?.[1]) continue;
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex[1].slice(i, i + 2), 16));
      if (r !== g || g !== b) coloured.push(`${name}: ${value}`);
    }
    expect(coloured).toEqual([]);
  });

  it("spends mid-greys sparingly — a short ramp between black and white", () => {
    const ramp = [...themeTokens().keys()].filter((name) => name.startsWith("--mono-"));
    expect(ramp).toContain("--mono-00");
    expect(ramp).toContain("--mono-100");
    expect(resolveToken("--mono-00")).toBe("#000000");
    expect(resolveToken("--mono-100")).toBe("#ffffff");
    // Two anchors and a handful of working shades. Adding a step is a design
    // decision, so it should have to come past this line to do it.
    expect(ramp.length).toBeLessThanOrEqual(9);
  });

  it("only ever borrows black or white for a translucent tint", () => {
    // A tint composites over whatever is beneath it, so a *tinted* tint would
    // smuggle hue in through the back door.
    const offenders: string[] = [];
    for (const [name, value] of themeTokens()) {
      const rgb = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\//.exec(value);
      if (!rgb) continue;
      const [r, g, b] = rgb.slice(1, 4).map(Number) as [number, number, number];
      const neutral =
        (r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255);
      if (!neutral) offenders.push(`${name}: ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no colour literal in any other stylesheet", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(appStylesheets())) {
      for (const value of declaredValues(source)) {
        for (const match of value.matchAll(COLOR_LITERAL)) {
          offenders.push(`${path}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("resolves every token those stylesheets read", () => {
    // Set on an element from TSX (`StepEditor`, `FillSlider`), never in CSS.
    // `TrackRail` sets the last two from the arrangement's own `ROW_METRICS`
    // and `HEADER_WIDTH_PX`, so a track's row is the same size in both views
    // without either one writing the numbers down twice (`UI-001`).
    const setFromMarkup = new Set([
      "--step-count",
      "--velocity",
      "--track-row-height",
      "--track-column-width",
    ]);
    const declared = new Set(
      Object.values(stylesheets).flatMap((source) =>
        [...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(([, name]) => String(name)),
      ),
    );
    const unresolved = new Set<string>();
    for (const [path, source] of Object.entries(appStylesheets())) {
      for (const [, name] of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!name || setFromMarkup.has(name) || declared.has(name)) continue;
        unresolved.add(`${path}: ${name}`);
      }
    }
    expect([...unresolved]).toEqual([]);
  });

  it("pins the arrangement canvas fallbacks to the theme", () => {
    // A canvas cannot read a custom property, so `canvasRenderer.ts` carries a
    // literal for the no-stylesheet case. It has to equal what the theme says.
    for (const [name, [token, fallback]] of Object.entries(COLOR_TOKENS)) {
      expect(resolveToken(token), `${name} (${token})`).toBe(fallback);
    }
  });
});
