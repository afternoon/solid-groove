import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	eagerClosure,
	eagerEntryPoints,
	staticImports,
} from "./verify-bundle-budget.mjs";

let dir;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "verify-bundle-budget-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function write(relativePath, content) {
	const full = join(dir, relativePath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content, "utf8");
	return full;
}

describe("staticImports", () => {
	it("finds both static import forms as a minifier emits them", () => {
		expect(
			staticImports('import{a as b}from"./chunk.js";import"./side-effect.js";'),
		).toEqual(["./chunk.js", "./side-effect.js"]);
	});

	it("does not treat a dynamic import as a static edge", () => {
		// The load-bearing case: the whole check exists to prove the SDK is
		// reached only this way, so counting it would make the check vacuous.
		expect(staticImports('t(()=>import("./sentrySink.js"),[])')).toEqual([]);
	});

	it("keeps a static edge that sits next to a dynamic one", () => {
		expect(
			staticImports('import{x}from"./eager.js";const p=import("./lazy.js");'),
		).toEqual(["./eager.js"]);
	});
});

describe("eagerEntryPoints", () => {
	it("takes the entry script and every preloaded module, ignoring CSS", () => {
		write("assets/client.js", "");
		write("assets/preloaded.js", "");
		write("assets/styles.css", "");
		const html =
			'<link rel="modulepreload" href="/assets/preloaded.js">' +
			'<link rel="stylesheet" href="/assets/styles.css">' +
			'<script type="module" src="/assets/client.js"></script>';

		expect(eagerEntryPoints(html, dir).map((f) => f.replace(dir, ""))).toEqual([
			"/assets/preloaded.js",
			"/assets/client.js",
		]);
	});

	it("skips a referenced file the build did not emit", () => {
		expect(eagerEntryPoints('<script src="/assets/missing.js">', dir)).toEqual(
			[],
		);
	});
});

describe("eagerClosure", () => {
	it("follows static imports transitively", () => {
		const entry = write("assets/client.js", 'import"./a.js";');
		write("assets/a.js", 'export*from"./b.js";');
		write("assets/b.js", "export const b = 1;");

		expect(eagerClosure([entry]).size).toBe(3);
	});

	it("stops at a dynamic import, which is what keeps the SDK out", () => {
		const entry = write("assets/client.js", 't(()=>import("./sdk.js"),[])');
		write("assets/sdk.js", "export const sentryTrace = 1;");

		const closure = eagerClosure([entry]);
		expect(closure.size).toBe(1);
		expect([...closure].some((f) => f.endsWith("sdk.js"))).toBe(false);
	});

	it("terminates on an import cycle", () => {
		const entry = write("assets/a.js", 'import"./b.js";');
		write("assets/b.js", 'import"./a.js";');

		expect(eagerClosure([entry]).size).toBe(2);
	});
});
