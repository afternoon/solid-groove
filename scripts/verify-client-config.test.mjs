import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkClientConfig } from "./verify-client-config.mjs";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "verify-client-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relativePath, content) {
  const full = join(dir, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

// 39 characters, `AIza` + 35, which is the shape `REQUIRED` pins. Fake, and
// deliberately unmistakably so -- the check asserts shape, not validity.
const API_KEY = "AIzaSyD-FAKE_EXAMPLE_KEY_NOT_REAL_12345";
const APP_ID = "1:1234567890:web:abcdef0123456789";

/**
 * The config object as a minifier emits it, in a chosen quote style.
 *
 * The shape matters more than it looks: field order, the `void 0` holes for
 * the two optional fields, and the absence of whitespace are all what real
 * output looks like, and all three are things a naive matcher trips over.
 */
function minifiedConfig(quote, { apiKey = API_KEY, appId = APP_ID } = {}) {
  const q = (v) => (v === null ? "void 0" : `${quote}${v}${quote}`);
  return (
    `var t={apiKey:${q(apiKey)},authDomain:${q("demo-groove.firebaseapp.com")},` +
    `projectId:${q("demo-groove")},databaseURL:void 0,` +
    `storageBucket:${q("demo-groove.firebasestorage.app")},` +
    `messagingSenderId:${q("1087692910497")},appId:${q(appId)},measurementId:void 0};`
  );
}

describe("checkClientConfig", () => {
  // The regression this file exists for. Vite 8's rolldown/oxc minifier writes
  // string literals with backticks where esbuild wrote double quotes, and the
  // check -- which matched double quotes only -- reported a complete, correct
  // config as four missing fields and failed the preview deploy. Every quote
  // style a minifier may reasonably pick has to read the same.
  it.each([
    ["double quotes", '"'],
    ["single quotes", "'"],
    ["backticks (Vite 8 / rolldown)", "`"],
  ])("accepts a populated config minified with %s", (_name, quote) => {
    write("assets/firebaseConfig.js", minifiedConfig(quote));

    expect(checkClientConfig(dir)).toEqual([]);
  });

  it("reports every field of a config built with the env vars unset", () => {
    // What an unset `import.meta.env.VITE_FIREBASE_API_KEY` actually compiles
    // to: the key is still there, the value is the `void 0` hole.
    write(
      "assets/firebaseConfig.js",
      "var t={apiKey:void 0,authDomain:void 0,projectId:void 0,appId:void 0};",
    );

    const failures = checkClientConfig(dir);
    expect(failures).toHaveLength(4);
    expect(failures.join("\n")).toContain("VITE_FIREBASE_API_KEY was unset");
  });

  it("reports a config that is present but malformed", () => {
    write(
      "assets/firebaseConfig.js",
      minifiedConfig("`", { apiKey: "not-a-real-key", appId: "nonsense" }),
    );

    const failures = checkClientConfig(dir);
    expect(failures).toHaveLength(2);
    expect(failures.every((f) => f.includes("present but malformed"))).toBe(true);
  });

  // The check has to mean "the object `initializeApp` receives is populated",
  // not "these four words appear somewhere in the bundle". A config-less build
  // really does ship `devBackend.ts`'s placeholder `authDomain` in one chunk
  // and a real-looking key in another, so a matcher that scanned each field
  // across the whole bundle independently would pass this and deploy an app
  // that cannot start a session.
  it("does not assemble a passing config out of unrelated chunks", () => {
    write("assets/firebaseConfig.js", "var t={apiKey:void 0,projectId:void 0};");
    write("assets/devBackend.js", 'var p={authDomain:"mock-project.firebaseapp.com"};');
    write("assets/env.js", `var e={VITE_FIREBASE_API_KEY:"${API_KEY}"};`);

    expect(checkClientConfig(dir)).not.toEqual([]);
  });

  it("finds the config wherever the bundler split it", () => {
    write("assets/vendor.js", "var x=1;");
    write("assets/nested/deep/chunk.js", minifiedConfig("`"));

    expect(checkClientConfig(dir)).toEqual([]);
  });
});
