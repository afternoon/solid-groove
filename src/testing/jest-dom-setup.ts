// Explicit vitest setup: registers `@testing-library/jest-dom`'s matchers.
//
// `vite-plugin-solid` normally auto-injects this via a bare module specifier
// (`@testing-library/jest-dom/vitest`) resolved directly against
// `vitest.config.ts`'s `test.setupFiles`, outside Vite's own module graph.
// Declaring the real import in a relative file that `vitest.config.ts` points
// to instead lets it resolve exactly like every other project import — which
// matters when running from a git-worktree checkout nested under the main
// checkout (see `vitest.config.ts`'s `exclude` note), where that raw bare
// specifier can resolve against the wrong `node_modules`.
//
// Keep "jest-dom" in this filename: `vite-plugin-solid` only skips its own
// auto-injection when an existing `test.setupFiles` entry path matches
// `/jest-dom/`, and would otherwise add its (broken, here) specifier too.
import "@testing-library/jest-dom/vitest";
