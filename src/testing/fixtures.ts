// Browser-safe fixture loading.
//
// Fixture files live under `public/fixtures/` so the same relative path is
// reachable two ways:
//   - From Node (unit, component/jsdom, and Firebase Emulator suites all run
//     under Node) by reading the file straight off disk.
//   - From a real browser (a Playwright page, or client code bundled with
//     `VITE_MOCK_BACKEND=true`) by fetching it as a static asset at
//     `/fixtures/...`, exactly like `public/samples/...` already is.
//
// `loadFixtureJson` picks the right strategy at call time rather than at
// import time, so one function works in every suite FND-001 sets up. It
// deliberately branches on `process` (present in every Node-based test
// runner, including jsdom) rather than on `window` (present in jsdom *and* a
// real browser, which would send jsdom down the fetch path where there is no
// server to answer it).

import type { RawProjectDocuments } from "../persistence/documents";

const isNodeRuntime =
	typeof process !== "undefined" && !!process.versions?.node;

/** Reads and parses a JSON fixture from `public/fixtures/<relativePath>`. */
export async function loadFixtureJson<T>(relativePath: string): Promise<T> {
	if (isNodeRuntime) {
		const { readFile } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		// `import.meta.url` is read into a local first: some runtimes evaluate
		// `import.meta.url` inline as an accessor, and passing that access
		// expression directly as `new URL()`'s second argument has been
		// observed to resolve against an empty base under Bun's Vite module
		// runner. Capturing the value first keeps resolution deterministic.
		const moduleUrl = import.meta.url;
		const fixtureUrl = new URL(
			`../../public/fixtures/${relativePath}`,
			moduleUrl,
		);
		const path = fileURLToPath(fixtureUrl);
		return JSON.parse(await readFile(path, "utf8")) as T;
	}

	const response = await fetch(`/fixtures/${relativePath}`);
	if (!response.ok) {
		throw new Error(`Fixture not found: ${relativePath} (${response.status})`);
	}
	return (await response.json()) as T;
}

/**
 * Loads a stored schema-vN project fixture from
 * `public/fixtures/persistence/v{version}-{name}.json`.
 *
 * This is the fixture convention the persistence migration harness follows
 * (see `src/persistence/migrations.ts`): each supported source version keeps a
 * file of the documents exactly as they were stored, so a migration added after
 * schema v1 is tested against real historical state rather than against state
 * reconstructed by today's encoder.
 */
export async function loadStoredProjectFixture(
	fileName: string,
): Promise<RawProjectDocuments> {
	return loadFixtureJson<RawProjectDocuments>(`persistence/${fileName}`);
}
