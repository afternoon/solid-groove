import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The structural half of the PRD `PRJ-06` performance expectation for a public
 * marketing page (backlog `LOOP-001b`).
 *
 * The landing page is the product's first impression and has no editing state
 * to protect, so nothing a visitor might never use should be on its first-paint
 * path. Two SDKs dominate that cost, and both are kept off it structurally
 * rather than by intention:
 *
 * - **Error monitoring.** Never loaded on this surface at all (ADR 0001), which
 *   `src/telemetry.ts` enforces at runtime and `scripts/verify-bundle-budget.mjs`
 *   enforces against the built bundle.
 * - **Firebase.** Only the "Log in" path needs an identity provider, and it
 *   reaches `authService` through a dynamic `import()` on click. Merely
 *   importing that module starts Firebase's own dynamic config import (see the
 *   `FirebaseAuthService` constructor), so a *static* import of it anywhere in
 *   this page's graph would put the SDK back on the first-paint path — which is
 *   exactly how the previous landing page (`LoginButton`) worked.
 *
 * This walks the page's static import closure inside `src/`, so the realistic
 * regression — someone re-adding `import { authService } from "../auth/authService"`
 * because a click handler needs it — fails here with the reason.
 */

const sourceRoot = join(process.cwd(), "src");
const landingPage = join(sourceRoot, "components", "LandingPage.tsx");

/**
 * Static import specifiers that survive into the bundle.
 *
 * Excludes the dynamic form, which is the point of the check, and `import
 * type`, which TypeScript erases entirely — a type-only import of the auth
 * service costs a visitor nothing.
 */
function staticImports(file: string): string[] {
	const source = readFileSync(file, "utf8").replace(
		/^\s*import\s+type\s[^;]*;/gm,
		"",
	);
	return [
		...[...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]),
		...[...source.matchAll(/^\s*import\s+"([^"]+)"/gm)].map(
			(match) => match[1],
		),
	];
}

/** Resolves a relative specifier to the source file it names, if any. */
function resolveRelative(fromFile: string, specifier: string): string | null {
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	]) {
		if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
	}
	return null;
}

/**
 * Every module statically reachable from `entry`, plus the bare (package)
 * specifiers those modules import.
 */
function staticClosure(entry: string): {
	files: Set<string>;
	packages: Set<string>;
} {
	const files = new Set<string>();
	const packages = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || files.has(file)) continue;
		files.add(file);
		for (const specifier of staticImports(file)) {
			if (specifier.startsWith(".")) {
				const target = resolveRelative(file, specifier);
				if (target) queue.push(target);
			} else {
				packages.add(specifier);
			}
		}
	}
	return { files, packages };
}

describe("the landing page's first-paint cost (PRD PRJ-06, section 10)", () => {
	const { files, packages } = staticClosure(landingPage);
	const reachable = [...files].map((file) => relative(sourceRoot, file));

	it("has a module graph to check", () => {
		expect(existsSync(landingPage)).toBe(true);
		expect(reachable.length).toBeGreaterThan(1);
	});

	it("does not statically import any Firebase SDK", () => {
		expect(
			[...packages].filter((specifier) => specifier.startsWith("firebase")),
		).toEqual([]);
	});

	it("does not statically import the auth service, which pulls Firebase in", () => {
		expect(reachable).not.toContain(join("auth", "authService.ts"));
		expect(reachable).not.toContain("firebaseConfig.ts");
	});

	it("still reaches the auth service dynamically, so log-in works", () => {
		expect(readFileSync(landingPage, "utf8")).toMatch(
			/import\(\s*"\.\.\/auth\/authService"\s*\)/,
		);
	});

	it("does not statically import the error-monitoring SDK (ADR 0001)", () => {
		expect(
			[...packages].filter((specifier) => specifier.startsWith("@sentry/")),
		).toEqual([]);
	});
});
