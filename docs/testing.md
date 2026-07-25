# Test and development foundation

| Field | Value |
| --- | --- |
| Status | Implemented (`FND-001`) |
| Scope | Shared tooling all later agents use: dependencies, test suites, CI, and test helpers |

Related documents: [Product requirements](./prd.md) ([9.1](./prd.md#91-committed-alpha-stack), [10](./prd.md#10-non-functional-requirements), [14](./prd.md#14-test-strategy-and-definition-of-done)), [backlog](./backlog.md#fnd-001---test-and-development-foundation)

This document is the map of "which suite do I run, and how." It does not restate `CLAUDE.md`'s stack/style conventions.

## Suites at a glance

| Suite | Command | Runner | Environment | External services |
| --- | --- | --- | --- | --- |
| Unit + component | `bun run test` | Vitest (`vitest.config.ts`) | jsdom | None — Firebase and audio are mocked/faked |
| Firebase Emulator | `bun run test:emulator` | Vitest (`vitest.emulator.config.ts`), wrapped by `firebase emulators:exec` | Node | Local Firestore emulator only, started and torn down automatically |
| Browser E2E | `bun run test:browser` | Playwright (`playwright.config.ts`) | Real browsers (Chromium, Firefox, WebKit) | A local dev server (`bun run dev`) against the in-memory mock backend |

Each suite is isolated on purpose: `bun run test` never needs a browser or an emulator running, so it stays fast enough to run on every save. `test:emulator` and `test:browser` are heavier and are meant for CI and pre-push checks.

## Unit and component tests

```sh
bun run test        # run once
bun run test:watch  # watch mode
bun run test:ui     # Vitest UI
```

Config: `vitest.config.ts`. `vite-plugin-solid` sets `test.environment: "jsdom"` automatically, so both plain unit tests (e.g. `src/shared/id.test.ts`) and component tests using `@solidjs/testing-library` (e.g. `src/components/Dashboard.test.tsx`) run under the same command — see those two files for the canonical shape of each.

`src/audio/ToneInstrument.test.ts` additionally renders real audio via `node-web-audio-api` (see `src/audio/testAudioContext.ts`). Importing `tone` creates a real (non-offline) global `AudioContext` as a side effect, and `node-web-audio-api`'s `cpal` backend needs to find *some* default output device to satisfy that, even though the tests themselves only render through `Tone.Offline`. On a machine with no audio hardware (`/dev/snd` absent — every GitHub-hosted runner, most containers), that context creation throws `InvalidStateError: ... DeviceUnavailable` and the whole file fails before any test runs.

`.github/workflows/ci.yml`'s `checks` job works around this without needing real hardware or a kernel module: it installs the ALSA runtime library (`libasound2t64`) and points `~/.asoundrc` at ALSA's built-in `null` PCM as the default output device (discards every sample, touches no hardware). That gives `cpal` a device to find. Running the same suite locally on a machine with no audio device needs the same `~/.asoundrc` (see the CI step for the exact config) — machines with real audio hardware need no workaround.

Each render in `renderSynth()` (the test file's shared helper) also disposes the `ToneInstrument` it builds once the offline render resolves. Without that, repeated back-to-back offline renders in the same process left native audio nodes bound to torn-down `OfflineAudioContext`s undisposed, which showed up as rare, wildly out-of-range sample values (filter-energy assertions occasionally comparing against values like `1e30`) once the suite could actually run past context creation. Always dispose the built instrument after consuming its rendered buffer in new tests that follow this pattern.

## Firebase Emulator suite

```sh
bun run test:emulator
```

`test:emulator` runs `firebase emulators:exec --only firestore --project demo-solid-groove "vitest run --config vitest.emulator.config.ts"`. `firebase emulators:exec` starts the Firestore emulator declared in `firebase.json`, sets `FIRESTORE_EMULATOR_HOST` for the child process, runs the suite, and shuts the emulator down regardless of pass/fail. A `demo-*` project ID is the Firebase-documented convention for emulator-only testing: no real GCP project, login, or credentials are needed.

`firebase.json` also declares an `auth` emulator (port `9099`) for future tasks that need to test Firebase Authentication behavior directly; `--only firestore` keeps today's suite (which only needs Firestore) fast by not starting it.

Suite location: `tests/emulator/`, isolated from `vitest.config.ts` via `vitest.emulator.config.ts`'s own `include`. `tests/emulator/setup.ts` provides `createTestEnvironment()`, which reads `firestore.rules` (the real rules file, not a copy) and connects to whatever host/port the running emulator reports.

The example suite, `tests/emulator/firestoreRules.emulator.test.ts`, proves `firestore.rules`' ownership model against a real Firestore instance: owner read/write, cross-owner denial, unauthenticated denial, and the "cannot reassign ownership on update" rule — the PRD 9.9 requirement that "security rules enforce ownership/collaborator access and must be tested against an emulator before sharing ships." Later tasks extend this file (or add siblings under `tests/emulator/`) as collaborator access and the `song`/`clips` subcollections land.

Requires a JDK (the emulator runs on the JVM); `.github/workflows/ci.yml` installs Temurin 21.

## Browser E2E suite

```sh
bun run test:browser:install   # one-time (or after a Playwright version bump)
bun run test:browser
```

Config: `playwright.config.ts`. `webServer` starts `bun run dev` with `VITE_MOCK_BACKEND=true` and waits for it before running tests, so the suite needs no real Firebase project — see `src/model/dataService.ts` and `src/auth/authService.ts` for the mock implementations it exercises.

Suite location: `e2e/`. The example test, `e2e/smoke.spec.ts`, is PRD section 14's "anonymous start" required end-to-end layer: it loads the landing page, starts an anonymous session, and confirms the dashboard renders the mock-seeded project.

Three projects run: `chromium`, `firefox`, `webkit`. Per the PRD section 10 supported-environment policy, Chromium and Firefox are P0-gating; WebKit runs alongside them as a signal only (`.github/workflows/ci.yml` marks the WebKit job `continue-on-error`) — WebKit passing is evidence, not proof, about real Safari.

`bun run test:browser:install` (`playwright install --with-deps chromium firefox webkit`) downloads browser binaries from Playwright's CDN. That download needs outbound access to `cdn.playwright.dev`; a locked-down sandbox that blocks that host cannot run this suite even though the config and tests are otherwise valid (verify with `bunx playwright test --list`, which does not need the binaries).

## `check` vs `check:ci`

```sh
bun run check     # tsc --noEmit && biome check --write   (local: auto-fixes)
bun run check:ci  # tsc --noEmit && biome check            (CI: non-mutating gate)
```

`check` is for local development, where auto-fixing formatting/lint issues is convenient. `check:ci` is the same checks without `--write`, so CI fails loudly on a violation instead of silently rewriting files in the runner and passing anyway.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. **`checks`** — `bun run typecheck`, `bun run check:ci`, then a null-ALSA-device setup step (see "Unit and component tests" above) before `bun run test`. Everything else depends on this.
2. **`browser`** — the Playwright suite, matrixed over `chromium`, `firefox`, `webkit`. Chromium/Firefox failures block the workflow; WebKit failures are reported but do not (`continue-on-error`).
3. **`emulator`** — `bun run test:emulator`, with a JDK installed for the Firestore emulator.

## Test helpers

| Helper | Location | Purpose |
| --- | --- | --- |
| `createId`, `createSeededIdFactory`, `isPrefixedId` | `src/shared/id.ts` | The PRD section 9.4 prefixed-ID format (`trk_...`, `clp_...`, ...). `createId` is the production generator; `createSeededIdFactory(seed)` is deterministic for fixtures and round-trip tests. One shared factory, not a separate test-only ID shape. |
| `systemClock`, `createManualClock` | `src/shared/clock.ts` | A `Clock` abstraction so domain code depends on an injectable clock instead of calling `Date.now()` directly. `createManualClock` never advances on its own — tests control time explicitly. |
| `parseOrThrow`, `safeParseWithIssues`, `finiteNumberInRange` | `src/shared/schema.ts` | The shared Zod entry point PRD section 9.1 commits to for runtime schemas. `parseOrThrow` fails closed (throws `SchemaValidationError`, never returns a partial value) per invariant 6; `finiteNumberInRange` is the shared clamping primitive invariant 4 asks for. `FND-002` builds the schema-v1 domain schemas on top of this rather than inventing its own parse/error shape. |
| `loadFixtureJson`, `loadSampleProjectFixture` | `src/testing/fixtures.ts` | Browser-safe fixture loading: reads `public/fixtures/*.json` from disk under Node (unit/component/emulator suites) or fetches it as a static asset under a real browser, picking the strategy at call time. |
| `buildProject`, `buildTrack`, `buildSong`, `buildInstrument` | `src/testing/fixtures.ts` | Override-friendly builders for the current prototype domain types (`src/model/types.ts`), so a test constructs one valid object and overrides only what it cares about. `FND-002` replaces the prototype types with the schema-v1 domain model and supersedes these. |

`src/shared/` holds helpers production code also depends on (both current and future domain code use `createId`/`Clock`); `src/testing/` holds helpers that only make sense inside a test.

## Why `firebase.json`'s `database` block was removed, not fixed

The prototype `firebase.json` pointed `database.rules.json` at a file that never existed, and nothing in the app uses the Realtime Database — only Firestore (`src/firebaseConfig.ts`) and Firebase Authentication. Supplying an unused `database.rules.json` just to satisfy the reference would add a maintenance burden for a service the product doesn't use; removing the `database` key resolves the dangling reference honestly. `firebase.json` now only declares `firestore` (rules) and `emulators` (`firestore` + `auth`, matching what the app and its tests actually exercise). Adding Realtime Database back is a normal follow-up if a future task actually needs it.

## Generated sample audio and the test suites

`scripts/generate-samples.mjs` (idempotent — it only writes files that are missing) runs via `predev`/`prebuild`, and now also via `pretest:browser`, since the E2E suite loads the real app, which needs `public/samples/*` to exist. It intentionally does **not** run before `test` or `test:emulator`: neither suite serves the app or touches sample audio, so running it there would be pure overhead on every invocation.

## `bun run clean`, and the stale-cache failure it exists for

```bash
bun run clean
```

Deletes `.vinxi`, `.output`, `node_modules/.vinxi`, `node_modules/.vite`, and the `test-results` / `playwright-report` / `blob-report` output directories. It does **not** touch `node_modules` itself, so no reinstall is needed afterwards, and it leaves `public/samples` alone — those are generated artifacts rather than caches, and regenerating them is slow (see above).

It exists because of a failure mode that is genuinely hard to recognise. Vite's dependency pre-bundling cache lives *inside* `node_modules/`, so it survives `git checkout`, `bun install`, and restarting the dev server. A long-lived local clone can therefore serve module output built from a commit you are no longer on, and nothing in the normal workflow invalidates it.

The symptom to recognise:

- A route in `src/routes/` **matches** — you get a blank page rather than the `[...404]` page — but its component never mounts.
- **No error in the browser console, and none in the dev server terminal.**
- `bun run test` passes, because Vitest does not use that cache.
- A fresh clone of the same commit works.

The tell is the disagreement between those first two facts: route scanning reads the filesystem directly and sees your checkout, while module loading goes through the cache and sees the older build. When a route matches but renders nothing, suspect the cache before suspecting the code, and run `bun run clean` first.

It is also worth reaching for before trusting any local run of a suite that loads the real app — the browser E2E suite, and any future measurement harness, go through the same cache.
