import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The structural half of PRD `OPS-03` / ADR 0001 decision 1: "application code
 * does not call the Sentry SDK directly."
 *
 * A comment saying so is a convention; this is the check that makes it a fact.
 * The same shape as `src/projection/boundaries.test.ts`, and the same rule
 * `src/persistence` applies to `firestoreProjectRepository.ts`: the one module
 * that touches the vendor SDK is kept out of the directory barrel, so reaching
 * it requires naming it, and naming it fails here.
 */

const sourceRoot = join(process.cwd(), "src");

/** The single module allowed to import the Sentry SDK. */
const SENTRY_SDK_OWNER = join("monitoring", "sentrySink.ts");

/**
 * Modules allowed to import Firebase's analytics SDK: the transport behind the
 * logging boundary, and the Firebase app bootstrap that predates it and owns
 * SDK initialization for the whole app.
 */
const ANALYTICS_SDK_OWNERS = [
  join("analytics", "firebaseTransport.ts"),
  "firebaseConfig.ts",
];

/** Names a barrel must not export, ignoring the prose above the exports. */
function exportedSpecifiers(barrelPath: string): string[] {
  const source = readFileSync(barrelPath, "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

function sourceFiles(directory = sourceRoot): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/** Every module specifier a file imports, static or dynamic. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...[...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]),
    ...[...source.matchAll(/import\s*\(\s*"([^"]+)"/g)].map((match) => match[1]),
  ];
}

function importersOf(prefix: string): string[] {
  return sourceFiles()
    .filter((file) => importsOf(file).some((specifier) => specifier.startsWith(prefix)))
    .map((file) => relative(sourceRoot, file));
}

describe("the Sentry SDK is reachable from exactly one module (ADR 0001)", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(20);
  });

  it("is imported by sentrySink.ts and nothing else", () => {
    expect(importersOf("@sentry/")).toEqual([SENTRY_SDK_OWNER]);
  });

  it("is not re-exported from the monitoring barrel", () => {
    // Being absent from the barrel is what stops application code reaching
    // the SDK by accident through `~/monitoring`.
    expect(exportedSpecifiers(join(sourceRoot, "monitoring", "index.ts"))).not.toContain(
      "./sentrySink",
    );
  });

  it("is reached only through the composition root, and only dynamically", () => {
    // A static import would pull the SDK into the entry chunk and break the
    // "lazily after first paint" requirement; scripts/verify-bundle-budget.mjs
    // checks the built output, and this checks the source.
    const importers = sourceFiles().filter((file) =>
      importsOf(file).some((specifier) => specifier.includes("sentrySink")),
    );
    expect(importers.map((file) => relative(sourceRoot, file))).toEqual(["telemetry.ts"]);

    const telemetry = readFileSync(join(sourceRoot, "telemetry.ts"), "utf8");
    expect(telemetry).toMatch(/await import\("\.\/monitoring\/sentrySink"\)/);
    expect(telemetry).not.toMatch(/^import .*sentrySink/m);
  });
});

describe("the analytics vendor SDK is reachable from exactly one module", () => {
  it("is imported by the transport and the app bootstrap, and nothing else", () => {
    expect(importersOf("firebase/analytics").sort()).toEqual(
      [...ANALYTICS_SDK_OWNERS].sort(),
    );
  });

  it("is not re-exported from the analytics barrel", () => {
    expect(exportedSpecifiers(join(sourceRoot, "analytics", "index.ts"))).not.toContain(
      "./firebaseTransport",
    );
  });
});

describe("the catalog and the scrubbing rules stay vendor-free", () => {
  // They are the two things a test must be able to exercise directly over the
  // whole surface, including events and breadcrumbs later tasks add.
  const VENDOR_FREE = [
    join("analytics", "catalog.ts"),
    join("analytics", "buckets.ts"),
    join("analytics", "errorCodes.ts"),
    join("analytics", "consent.ts"),
    join("monitoring", "scrub.ts"),
    join("monitoring", "browserInfo.ts"),
  ];

  const FORBIDDEN = ["firebase", "@sentry/", "solid-js", "@solidjs/", "tone"];

  it.each(VENDOR_FREE)("%s imports no vendor SDK", (relativePath) => {
    for (const specifier of importsOf(join(sourceRoot, relativePath))) {
      for (const forbidden of FORBIDDEN) {
        expect(
          specifier.startsWith(forbidden),
          `${relativePath} imports "${specifier}"`,
        ).toBe(false);
      }
    }
  });
});
