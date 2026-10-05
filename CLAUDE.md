# Groove - Development Guide

## Project Overview

Groove is a browser-based music production tool designed to make music creation accessible and intuitive. It features real-time collaboration, AI assistance, pattern-based sequencing, and a library of sounds and instruments.

## Tech Stack

### Core Framework
- **SolidJS 2** (`solid-js@2.0.0-rc.3`) - Reactive UI framework
  - Use SolidJS best practices: signals, stores, and effects
  - Store APIs (`createStore`, `reconcile`, `snapshot`, `storePath`) come from `solid-js` itself — there is no `solid-js/store` subpath
  - Control flow (`Show`, `For`, `Switch`, `Match`, `Loading`, `Errored`) and the `JSX` types come from **`@solidjs/web`**; `solid-js` no longer exports a `JSX` namespace, and there is no `solid-js/web`. (`@solidjs/web` re-exports the control-flow components from `solid-js`, so either import resolves to the same component — most of the repo names `@solidjs/web`.)
  - `Suspense` is `Loading` and `ErrorBoundary` is `Errored`; `Errored`'s fallback receives the error as an **accessor** (`(err, reset) => ... err().message`). See `src/app.tsx`
  - Use `createEffect(compute, apply)` for side effects and `createMemo` for derived values — see "Effects and Cleanup" below, and read it before writing one
  - Utilize Context providers for global state (see the `AuthProvider` pattern in `src/auth/AuthProvider.tsx`)
- **`@solidjs/vite-plugin`** - The serving layer, in **client start mode** (`solid({ start: true })` in `vite.config.ts`). It owns the dev server, the generated entries, and the build. There is no `@solidjs/start` release for Solid 2 and there is not meant to be one — Start is a mode of this plugin now, which is why the repo carries no `app.config.ts`, no `vinxi`, and no `src/entry-client.tsx`/`src/entry-server.tsx`
- **Vite 8** - Build tool and dev server (`vite.config.ts`, which pins port 3000 and documents the client-start-mode decision)

### Backend & Data
- **Firebase Authentication** - User authentication and session management
- **Firebase Firestore** - Real-time database for project storage and synchronization
  - There is no SolidJS/Firebase integration library in the stack; the repository layer owns its own subscriptions (`ProjectRepository.watchProject`)

### Audio
- **Tone.js** - Web Audio API library for audio synthesis and playback
  - Used by `ProjectAudioGraph` (the stable, ID-keyed graph) and `src/editor/useProjectAudio.ts` (the hook that wires one open project onto it) for audio playback and synthesis

### Development Tools
- **TypeScript** - Strict mode enabled
- **Bun** - Package manager and runtime
- **Biome** - Linting and code formatting
- **Vitest** - Testing framework with jsdom

## Project Structure

```
src/
├── audio/              # Audio playback and synthesis
│   ├── AudioRuntime.ts      # Single application-scoped Tone/Web Audio context
│   ├── resourceRegistry.ts  # Owner/type tracked audio resource registry
│   ├── ProjectAudioGraph.ts # Stable ID-keyed project graph reconciled from the audio projection
│   ├── TrackAudioGraph.ts   # One track's instrument, device chain, sends, and channel strip
│   ├── ReturnAudioGraph.ts  # One return bus's device chain and channel strip
│   ├── MasterAudioGraph.ts  # The master bus's device chain and volume stage
│   ├── DeviceChain.ts       # Ordered, ID-keyed insert-chain reconciliation shared by tracks/returns/master
│   ├── summingBus.ts        # Sums any number of sources two at a time in a fixed order, so renders are bit-identical (#867)
│   ├── InstrumentGraph.ts   # Sampler/synth/drum-machine instrument node factory and reconciliation
│   ├── instruments/         # The per-instrument implementations behind `InstrumentGraph.ts`
│   │   ├── types.ts             # `InstrumentNode`/`InstrumentGraphContext`/`InstrumentNodeFactory`, smoothing window, kind aliases
│   │   ├── assetVoice.ts        # Reattachable per-asset buffer subscription, `playOneShot`, shared gain/pitch helpers
│   │   ├── sampler.ts           # The sampler node: pitched, windowed voices under a per-trigger amp envelope
│   │   ├── synth.ts             # The polyphonic subtractive synth node: PolySynth into one smoothed low-pass filter
│   │   └── drumMachine.ts       # The drum-machine node: per-pad strips, mute/solo, choke groups, short-lived hits
│   ├── AudioBufferCache.ts  # Asset buffer cache keyed by ID/revision with stale-load cancellation
│   ├── toneBufferLoader.ts  # The only Tone-touching asset decode path `AudioBufferCache` uses in production
│   ├── storedAudio.ts       # The installed source a URL-less asset's bytes are read from (a user's own sound, #282)
│   ├── Transport.ts         # Play/pause/stop/seek, playhead, tempo mirror, bar loop, metronome
│   ├── underrun.ts          # Sampled late-dispatch counter behind `audio_underrun`
│   ├── audioLoopPlayer.ts   # Pitch-preserving time-stretch for a tempo-labelled loop event
│   ├── orderedGrainPlayer.ts # `Tone.GrainPlayer` whose overlapping grains sum through a `SummingBus`
│   ├── offlineRenderer.ts   # `renderProjectOffline`: the shared, cancellable offline renderer behind export (EXP-001)
│   ├── offlineSession.ts    # One render's `OfflineContext` with the live `ProjectAudioGraph` built on it; coded `OfflineRenderError`
│   ├── offlineClock.ts      # Runs Tone's offline clock in chunks, the offline context installed only while each chunk runs
│   ├── renderLength.ts      # Where a render ends: the last clip, plus a tail trimmed to the last audible sample
│   └── scheduling.ts        # Placement/clip -> absolute-tick event expansion (musical time, not wall clock)
├── auth/               # Authentication logic
│   ├── AuthProvider.tsx     # Context provider for auth state
│   └── authService.ts       # Firebase auth service wrapper
├── components/         # Reusable UI components
│   ├── Dashboard.tsx
│   ├── LandingPage.tsx     # Public marketing landing page and the entry into anonymous start
│   ├── ProjectList.tsx
│   └── ConfirmDialog.tsx   # Accessible confirmation modal for destructive actions
├── editor/             # The FND-009 foundation vertical slice: editor state, audio wiring, and its 16-step UI
│   ├── EditorSession.ts     # Framework-free CommandHistory + ProjectAutosave + repository-watch wiring for one open project
│   ├── useEditorSession.ts  # Solid adapter: loads a project, exposes EditorSession as reactive state
│   ├── useProjectAudio.ts   # Wires one project onto ProjectAudioGraph/AudioRuntime; play/stop and audio_start_failed
│   ├── starterProject.ts    # Builds the "New Project" starter (one sampler track, pack-qualified asset, one note clip)
│   ├── StepGrid.tsx         # The slice's 16-step grid; dispatches note.add/note.remove through the command layer
│   ├── LoopInfo.tsx         # Tempo-labelled audio-loop panel: distinguishes a loop from a pitched one-shot and documents the pitch-preserving stretch honestly (LOOP-006/INS-02)
│   ├── deviceProjectRecord.ts # Device-local "opened before" bookkeeping for project_opened's is_first_open (LOOP-001)
│   └── EditorView.tsx       # The project route's top-level component
├── domain/             # Canonical schema-v1 domain model (authoritative)
│   ├── entities.ts          # Entity shapes and their Zod schemas
│   ├── ids.ts               # Prefixed stable IDs and ID factories
│   ├── time.ts              # Integer musical time at 192 PPQ
│   ├── parameters.ts        # Shared parameter definitions
│   ├── packs.ts             # Pack dependency derivation and missing-pack state (LIB-05)
│   ├── parse.ts             # Validation and domain invariants
│   ├── serialize.ts         # Deterministic JSON serialization
│   ├── factories.ts         # Blank/entity factories
│   ├── duplicateProject.ts  # Independent deep duplication with fresh IDs for every mutable entity (PRJ-02)
│   └── fixtures.ts          # Deterministic reference projects
├── persistence/        # Schema-v1 Firestore layout and repository boundary
│   ├── documents.ts         # Collection paths, document shapes, chunk overflow
│   ├── documentSize.ts      # Firestore size accounting and the size budgets
│   ├── projectRepository.ts # The repository contract both stores satisfy
│   ├── inMemoryProjectRepository.ts   # Local/test store
│   ├── firestoreProjectRepository.ts  # Production store (only Firebase import)
│   ├── autosave.ts          # Coalescing, revision-checked optimistic saves
│   └── migrations.ts        # Forward-migration harness (PRJ-04)
├── commands/           # Shared command, transaction, and history kernel
│   ├── types.ts             # Actors, envelopes, issues, command definitions
│   ├── registry.ts          # The one typed command registry
│   ├── execute.ts           # Validation, atomic transactions, revisions
│   ├── history.ts           # Local bounded undo/redo and gestures
│   ├── projectEdits.ts      # Immutable edit helpers with structural sharing
│   └── definitions/         # Registered commands, grouped by entity
├── library/            # The app's read side of the generated factory asset manifest
│   ├── factoryLibrary.ts           # Typed accessors; the only place src/ learns an asset's facts
│   └── factoryLibrary.generated.ts # GENERATED by `bun run library:emit-runtime` (CNT-001)
├── selection/          # Selection/focus state (UI-only, never persisted)
│   ├── types.ts             # SelectionScope union and SelectionState
│   ├── selection.ts         # Pure selection ops + project-driven reconciliation
│   └── arrangement.ts       # The arrangement's one selection: a point or whole clips, plus the transient drag band (ARR-006)
├── shortcuts/          # The one typed keyboard-shortcut registry (see docs/shortcuts.md)
│   ├── types.ts             # Contexts, guide groups, Ableton parity, browser conflicts
│   ├── keys.ts              # Chord parsing, layout-aware matching, platform labels
│   ├── registry.ts          # The mapping table itself, plus lookups and reserved chords
│   ├── ShortcutController.ts # Framework-free dispatch: context, text entry, analytics
│   ├── useShortcuts.ts      # Solid adapter that installs a controller on the window
│   ├── ShortcutGuide.tsx    # The searchable `?` mapping guide, generated from the registry
│   └── textEntry.ts         # What counts as a typing target
├── projection/         # Read-only consumer projections built from a Project
│   ├── fingerprint.ts       # Deterministic content fingerprint for change detection
│   ├── audioProjection.ts        # Audio engine's song projection
│   ├── arrangementProjection.ts  # Arrangement renderer's projection
│   ├── projectSummaryProjection.ts # Dashboard/persistence summary
│   └── assistantContextProjection.ts # Compact assistant context
├── routes/             # The page modules `router.tsx` points at (NOT file-based routing)
│   ├── index.tsx            # Home/landing page
│   ├── dashboard.tsx        # User dashboard
│   ├── CatchAll.tsx         # The `*404` page
│   └── projects/Project.tsx # Project editor route
├── shared/             # Helpers production code AND tests depend on
│   ├── id.ts                # Prefixed-ID factory (+ seeded test variant)
│   ├── clock.ts              # Injectable Clock abstraction
│   ├── scheduler.ts          # Injectable Scheduler for coalescing/deferred work
│   └── schema.ts             # Shared Zod parse helper
├── testing/            # Helpers only tests use
│   └── fixtures.ts          # Browser-safe fixture loading (public/fixtures/*)
├── userLibrary/        # A producer's own packs (#282): pack model and versions, import, analysis, repository
│   ├── userPacks.ts         # The pack document schema, version bumps, library read model, missing-sound report
│   ├── importSound.ts       # Refuse, analyse, upload, then list: never a partial sound
│   ├── soundAnalysis.ts     # Duration, sample rate, BPM and peaks from a dropped file
│   ├── userLibraryRepository.ts        # The boundary both stores satisfy (contract in userLibraryRepositoryContract.ts)
│   ├── inMemoryUserLibraryRepository.ts # Mock/test store
│   ├── firebaseUserLibraryRepository.ts # Firestore + Cloud Storage store
│   └── userLibraryClient.ts # Composition root: in-memory (mock) vs Firebase
├── userData/           # What a user stores outside projects, under users/{uid}/ (#282)
│   ├── userData.ts          # The layout, the kinds, the 1 GB per-account cap, the per-file limit, accepted audio types
│   └── usageLedger.ts       # How the usage total moves on Storage events: idempotent, order-tolerant, refuses over-cap writes
├── theme.css           # The palette: every colour named once, shared with the static pages
├── app.css             # The base layer over the theme: typography, document shell, element defaults
├── app.tsx             # Root application component; the plugin generates the entries from it
├── Document.tsx        # The prerendered document shell: the statically generated landing page + its meta (ADR 0008)
├── router.tsx          # The explicit route table (see "Routing" below)
├── firebaseConfig.ts   # Firebase configuration (+ local emulator wiring)
└── projectRepositoryClient.ts  # ProjectRepository composition root: in-memory (mock) vs Firestore

tests/                  # Every suite that is not a src/ unit or component test
├── playwright.chromium.ts   # Shared Chromium launch options for the Playwright configs that run Chromium
├── e2e/
│   ├── support/        # walkthrough.ts — the screenshot capture a flow spec drives
│   ├── emulator/       # THE Playwright browser E2E suite, against the Firestore/Auth emulator (FND-009)
│   │   ├── playwright.config.ts
│   │   ├── *.spec.ts   # Per-surface browser tests (layout, focus, shortcuts, export harnesses, ...)
│   │   ├── support/    # Shared helpers and the in-page harnesses the export/audio specs import
│   │   └── flows/      # EVERY core flow (docs/core-flows.md), one spec named for its CF- id
│   └── hosted/         # Post-deploy smoke test against the real Hosting URL
│       └── playwright.config.ts
└── emulator/           # Firebase Emulator suite (Firestore rules, etc.)
    └── vitest.config.ts
functions/              # Cloud Functions (#282): Storage triggers that keep users/{uid}/usage/current through src/userData/usageLedger.ts
public/fixtures/        # Fixture data loaded by src/testing/fixtures.ts
public/robots.txt       # Allows `/`, disallows the app's own routes (ADR 0008)
site.config.mjs         # The public origin, titles, and description. One place to change the domain
release.config.mjs      # Release stage and for-profit flag. Leaving the private alpha is one deliberate edit here; the library build then rejects alpha-only packs
```

## Task tracking and landing work

Work is tracked in **GitHub issues** in `afternoon/solid-groove`. The issue body is the spec: what to build or fix and how to tell it works. Its comments carry progress, decisions and blockers. Readiness is the issue's native `blocked_by` graph (`gh api repos/afternoon/solid-groove/issues/<n>/dependencies/blocked_by`); dependency prose in a body is descriptive only. **`gh` in a Claude Code cloud session:** `gh api` REST calls work, `blocked_by` reads and edits included, even though `gh auth status` says the token is invalid (ignore it). GraphQL is blocked there, so `gh pr create/list/view` and `gh issue view/list` fail; use `gh api repos/afternoon/solid-groove/...` or the GitHub MCP tools instead. In Actions every `gh` command works. The `blocked` label marks a task gated on an undecided `DEC-*` product decision. [`docs/prd.md`](./docs/prd.md) holds the product's principles, not its features; only the product owner edits it.

### The board

Status is a `status:*` label on the issue, and the pinned **Board** issue lists every open issue by column (`.github/workflows/board.yml`, `.github/scripts/board.mjs`). An issue is in exactly one column: add the new `status:*` label and the Action removes the old one.

| Column | Label | Moved there by |
| --- | --- | --- |
| Backlog | `status:backlog` | Opening an issue |
| Ready | `status:ready` | The product owner, once the spec is agreed. **This starts `/ship`** in Actions and moves the card on to In progress |
| In progress | `status:in-progress` | `/ship` starting; a failed QA; the product owner sending it back |
| Blocked | `status:blocked` | `/ship` stopping on an unclear issue or a failed run; QA failing twice |
| QA | `status:qa` | A PR that closes the issue opening |
| Ready for review | `status:review` | The QA bot passing the preview |
| Done | (closed) | Merging the PR that closes the issue |

The Backlog column is grouped by milestone, and every issue has one: `.github/workflows/milestone.yml` puts a new bug on the milestone of the area it is in and anything else on Backlog. Milestones are listed by title (`M1`, `M2`, …, numbers compared as numbers), with Backlog last. Milestones can be added, renamed and renumbered freely: the scripts read them live, and the only name they rely on is `Backlog` (any case), the catch-all. An issue labelled `needs-shaping` has open questions (listed in a comment on it) to settle in a shaping session before it can go to Ready; the board shows that label, and `human-input-required`, after the issue's number on its line, and lists those issues first in their milestone. A PR that changes `firestore.rules` or `storage.rules` gets no preview, so it moves its issue straight to Ready for review instead of QA. If an issue ever carries two `status:*` labels, the next board render keeps the later stage (Blocked always wins).

The QA bot reports on the issue's card: on a pass it adds `status:review`; on a fail it comments the findings on the PR starting with `@claude` (which starts a fix) and adds `status:in-progress`, or `status:blocked` after the second failure on the same PR. An agent working an issue keeps its card current the same way.

**Sending a card back.** To ask for changes on an issue whose PRs are open, comment the feedback on the issue or a PR, then add `status:in-progress` (not `status:ready`, which starts a fresh build). The board runs a rework agent on the open PRs, which fixes them in place, replies to the feedback, and moves the card back to QA (or Ready for review if there's no preview). It stands down if an `@claude` run is already on it, as after a failed QA.

### Shape, then ship

Every task runs in two phases:

1. **Shape (interactive).** The product owner and Claude work the issue out together in a session: questions, prototypes, design studies. It ends with the agreed spec written into the issue body. Ask as many questions as it takes here; this is the cheap place to be wrong.
2. **Ship (unattended).** **`/ship #123`** (`.claude/skills/ship/`, running `.claude/workflows/solid-groove-ship.js`) takes the issue from spec to ready PRs with no further questions. It works out which of three kinds of work the issue is and scales the process to it:

| Kind | What it is | Tests | Review |
| --- | --- | --- | --- |
| **Feature** | New capability, usually several PRs | Unit/component tests, plus a core flow when the feature adds a new user journey | Adversarial review, up to two fix rounds |
| **Fix** | Something is wrong | A regression test that fails before the fix (keep the red output for the PR body) | None |
| **Polish** | A small enhancement or tweak | A unit test where the behaviour is testable | None |

Whether the issue says "bug" or "enhancement" does not matter. Behaviour that works as coded but is not what the product owner wants is still a change to make: never stop because something "is expected behaviour". Ship stops only when the issue is genuinely unclear (two reasonable readings would build materially different things) and comments the question on the issue.

Quality outside features is kept by periodic code-quality and architecture sweeps that open their own cleanup issues, not by reviewing every small change.

### Core flows

A **core flow** is one user journey that must work end to end, written in plain English in [`docs/core-flows.md`](./docs/core-flows.md) with a stable ID (`CF-001`, …) and reproduced by `tests/e2e/emulator/flows/<ID>.spec.ts`. Flows are for journeys worth guarding for the life of the product, not for every feature.

- A feature that adds such a journey gets its flow written by the agent shipping it, as the **first PR of its own stack**: the register entry and the spec, marked `test.fixme`. The PR that completes the feature removes the `fixme` and makes it pass.
- An existing flow's assertions are not weakened to fit an implementation. If one has to change, the PR body says what changed and why.
- `bun run verify:core-flows` enforces one spec per registered flow and lists any flow still parked at `fixme`.

### Landing work

- **Open PRs ready for review, not as drafts.** The product owner is the only reviewer; a draft just hides finished work.
- **Always open the PR yourself.** Work that ends as a pushed branch with a "Create PR" link is lost: nobody clicks it. Every run that pushes a branch for an issue, including an `@claude` run from `claude.yml`, opens its PR (`gh pr create`, or the GitHub MCP `create_pull_request`) before finishing, and checks it exists.
- **Title:** `Implement #<issue>: Title` for a feature or polish, `Fix #<issue>: Title` for a fix. The title says what the PR does (for a fix, what was broken). A stack says its position in the body ("2 of 3, builds on #<prev>"), not the title.
- **Body:** `Closes #<n>` on the PR that completes the issue, `Refs #<n>` on earlier ones; what changed; the commands run and their results. Follow `.github/pull_request_template.md`.
- **One purpose per PR.** Split into a stack only when a change does more than one thing a reviewer would want to read separately (for example a refactor and the feature built on it). Around 400 changed lines is a sign to consider splitting, not a hard cap. Tests ship in the same PR as the code they cover. Never mix a behaviour change into a pure move.
- **Stacks:** each PR branches off the previous PR's branch and sets it as its base: `gh pr create --base <prev-branch>`, or the GitHub MCP `create_pull_request` with `base` set. That is all an agent does; never use `gh stack` or another `gh` extension (they are not installed, and some need GraphQL that agent sessions cannot reach). `.github/workflows/stack-link.yml` links the chain into a native GitHub stack (the stack shows on the PR page and merges bottom-up from there), and `.github/workflows/restack.yml` keeps it current and linear: when a PR merges or its branch moves, the PRs on it are rebased onto it and force-pushed with a lease, and when `main` moves, every open PR on `main` that now conflicts with it is rebased the same way (one that still merges cleanly is left alone). So a push to a stacked branch can be rejected because restack moved it: run `git pull --rebase` and push again. An agent never force-pushes a stacked branch itself, except to resolve a `restack-conflict` as that label's comment says.
- **Screenshots: required whenever any UI changes** (markup, CSS, copy). Show the changed state, and the before state when that helps; usually one to five images, never a dump of every step, never none. Capture them with the helper in `tests/e2e/support/walkthrough.ts` from any emulator-suite spec (a flow spec, or a scratch `tests/e2e/emulator/<slug>.screens.spec.ts` run with `bun run screenshots -- <spec>`), then `bun run walkthrough:publish -- --issue <n>` pushes them to the `claude/walkthroughs` branch and prints the Markdown for the PR body. Images cannot be attached through the GitHub API, which is why they live on a branch. Keep each image URL under 150 characters (the agent environment wraps longer ones in backticks and they render broken), and after updating a body check every image returns `200`. A PR with no UI change says so.
- **Preview + QA:** the PR that completes the issue gets the `deploy-preview` label once CI is green. A preview runs against the **live production** backend with production's rules, so never label a PR that changes `firestore.rules` or `storage.rules`.
- **Contracts:** domain schema, command registry, parameter definitions, persistence layout, selection, audio projection and rendering projection are contracts. Changing one is fine when the task needs it, but update every contract test and consumer in the same change and say so in the PR body.
- Git history is the completion record; do not put a commit hash into a commit. Do not preserve compatibility with prototype project data (schema v1 is the first production schema).

### Definition of done

- The issue's spec is met, including the failure and empty states it touches. A deliberate deviation is stated in the PR body with its reason.
- `bun run typecheck`, `bun run test` and `bun run check` pass. Work that touches browser, Firebase, audio or export behaviour also runs that suite.
- New behaviour goes through shared commands and boundaries, not a feature-specific mutation path.
- **Analytics ships with the feature.** A new or changed user action emits its events through the typed catalog in `src/analytics` (extend the catalog in the same PR, at minimum a `feature_first_use` key), with a test that it fires once per action. No ad-hoc event strings.
- No event or error-report parameter carries a project, track, clip, section or asset name, assistant text, a user-entered string, an asset URL, or a token.
- UI changes carry screenshots; the closing PR carries `deploy-preview`; every PR is ready for review.
- No unrelated formatting, dependency, generated-file or refactor churn.


## Commands

All commands use Bun as the package manager and runtime:

```bash
# Development
bun run dev          # Start development server

# Build and production
bun run build        # Build for production
bun run start        # Start production server
bun run clean        # Delete build/dev caches and test output (see docs/testing.md)

# Code quality
bun run check        # Run Biome linting

# Testing
bun run test              # Unit + component tests, the five application projects (needs an audio output device — see Testing below)
bun run test:all          # Every project, including the slow library-pipeline one. What CI runs.
bun run test:library      # The sample-library build pipeline alone (scripts/)
bun run test:watch        # The five application projects, watch mode
bun run test:ui           # Unit + component tests, Vitest UI
bunx vitest run --project=audio   # One layer — see vitest.config.ts for the six projects
bun run verify:test-projects      # Every test file is owned by exactly one project
bun run test:emulator     # Firebase Emulator suite (Firestore rules, etc.)
bun run test:browser:emulator  # Browser E2E suite against a local Firestore/Auth emulator (Chromium, Chrome, Edge, Firefox)
bun run test:browser:emulator:chromium  # Chromium-only pre-flight for it (see "Which browsers run where" in docs/testing.md)
bun run test:browser:install  # One-time: download Playwright's browser binaries

# Core flows and PR screenshots
bun run verify:landing-static                # `/` is statically generated, and no other path carries its markup
bun run verify:core-flows                    # Every flow in docs/core-flows.md has exactly one spec, and vice versa
bun run screenshots -- <spec>                # Capture step() screenshots from any emulator-suite spec (e.g. a scratch *.screens.spec.ts)
bun run walkthrough:capture                  # Capture step() screenshots from the core-flow specs (emulator backend)
bun run walkthrough:publish -- --issue <n>   # Push the images and print the Markdown for the PR body
```

An environment that cannot reach `cdn.playwright.dev` — Claude Code on the web
included — can only install Chromium. Run the `:chromium` pre-flight there for
any change that touches the browser. Per push, CI runs only the emulator suite's
`@sanity` subset in Chromium (one pass through each major surface; tag a spec's
`test.describe` with `{ tag: "@sanity" }` to add it, sparingly). The full
emulator browser suite, in every browser, run once a day on `main` and on demand from the
Actions tab ("Run workflow" on CI); a failed daily pass opens a bug, and tests
that only passed on a retry open a flaky-tests bug. A green Chromium-only run is
not the PRD section 10 gating evidence and must not be reported as one.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, the three backends the app can run against (mock, Firebase Emulator, real project), and the day-to-day loop; [`docs/testing.md`](./docs/testing.md) for what each suite covers, how CI gates on them, and the shared test helpers (`src/shared/id.ts`, `src/shared/clock.ts`, `src/testing/fixtures.ts`).

## Code Style Guidelines

### General Principles
- **Keep code tidy and modular**: Break out functions and components to keep them simple, clear, and easy to read
- **No long, complex blobs**: If a function or component is getting too long, split it into smaller pieces
- **Prefer third-party dependencies**: Use well-maintained libraries rather than implementing common functionality from scratch
- **Use TypeScript strictly**: The project has `strict: true` enabled

### SolidJS Best Practices

1. **State Management**
   - Use `createStore` (from `solid-js`) for complex nested state updates (see `src/editor/useEditorSession.ts`). `produce` is gone — mutating the draft **is** the setter's default behaviour: `setState((draft) => { draft.project = next; })`
   - Domain state changes only through the command layer (`src/commands`); a component never mutates a `Project` directly
   - Export setter functions rather than exposing setters directly
   - Keep stores focused on a single domain (auth, editor session, etc.)

2. **Context Providers**
   - Follow the pattern in `AuthProvider.tsx:18`
   - The context object **is** its own provider: `<AuthContext value={state}>`, not `<AuthContext.Provider value={state}>`
   - `createContext<T>()` with no default returns `T` from `useContext` and throws `ContextNotFoundError` when no provider is mounted, so there is no `as T` cast to write and no throw-wrapper hook to hand-roll
   - Always provide a typed hook for consuming context (e.g., `useAuth()`)

3. **Effects and Cleanup**
   - `createEffect` is split in two: `createEffect(compute, apply)`. **Only the compute half is tracked.** A reactive read moved into the apply half compiles, runs once, and then silently never re-runs — enumerate every reactive read an effect needs and keep all of them in the compute half
   - The apply half is where a write belongs: a signal or store write inside a tracking scope throws in dev, and the apply half is not a tracking scope
   - **Cleanup is the value the apply half returns**, not a nested `onCleanup`. `onCleanup` still exists and is still right at the top level of a component or hook body (see `src/editor/useEditorSession.ts`); what changed is that it no longer nests inside an effect
   - Example pattern:
   ```typescript
   // A subscription with no reactive dependencies: compute returns a constant,
   // the apply half opens the subscription and returns its teardown.
   createEffect(
     () => undefined,
     () => {
       const unsubscribe = service.subscribe(...);
       return () => unsubscribe();
     },
   );

   // A subscription keyed on something reactive: that key is read in compute.
   createEffect(
     () => props.id(),
     (id) => {
       const unsubscribe = service.subscribe(id, ...);
       return () => unsubscribe();
     },
   );
   ```
   - Worked examples: `src/auth/AuthProvider.tsx` (both shapes), `src/app.tsx` (`SurfaceTracker`, two reads in one compute), `src/components/TelemetryDisclosure.tsx` (a write that is only legal in the apply half)
   - `onMount` is `onSettled`, and it **returns** its cleanup rather than nesting `onCleanup` (see `src/app.tsx`)

4. **Component Structure**
   - Keep components focused on a single responsibility
   - Extract complex logic into separate functions or composables
   - Use functional components with props typing

### Firebase Integration

1. **Authentication**
   - Use AuthProvider for app-wide auth state
   - Access via `useAuth()` hook
   - AuthProvider automatically redirects unauthenticated users to home

2. **Firestore Data Access**
   - All Firestore operations go through the schema-v1 `ProjectRepository` boundary (`src/persistence`), obtained via `getProjectRepository()` (`src/projectRepositoryClient.ts`) — never call `firebase/firestore` directly outside `src/persistence/firestoreProjectRepository.ts`
   - The one other module allowed to import `firebase/firestore`, and the only one allowed to import `firebase/storage`, is `src/userLibrary/firebaseUserLibraryRepository.ts`: the personal library's packs and audio (#282), behind `UserLibraryRepository` and obtained via `getUserLibraryRepository()`. It never hands out a download URL; audio is read back as the signed-in user with `readAudio`
   - Use `ProjectRepository.watchProject` for the metadata tier's live revision; `EditorSession` wires it into `ProjectAutosave`
   - Security rules enforce owner-based access (see firestore.rules)

3. **Data Flow Pattern**
   ```
   Component → typed command → CommandHistory.execute() (EditorSession) → new Project revision
     → ProjectAutosave queues the changed tier → ProjectRepository → Firestore
   Firestore → ProjectRepository.watchProject → ProjectAutosave.applyRemote() → Component reactively updates
   ```

### Path Aliases
- Use `~/*` to reference files from `src/` directory (configured in tsconfig.json:20)
- Example: `import { useAuth } from "~/auth/AuthProvider"`

### TypeScript
- Define domain types in `src/domain` alongside their runtime schema
- Use discriminated unions for variant types (see the domain Instrument and ClipContent types)
- Leverage `Partial<T>` for update operations

## Architecture Patterns

### Canonical domain model (`src/domain`)
- `src/domain` is the authoritative schema-v1 contract. Its types, Zod schemas, invariants, and tests replace any separate domain-model document.
- It has no Firebase, Tone.js, or SolidJS imports. Persistence, commands, audio, and rendering consume it from outside; audio nodes and Firestore `Timestamp`s never enter project state.
- Persistent relationships use prefixed IDs from `createIdFactory()` (`createSeededIdFactory()` in tests), never array positions.
- Musical time is integer ticks at 192 PPQ. Seconds, bars/beats/16ths, and pixels are derived through `src/domain/time.ts`.
- A user-controlled numeric value declares its range, unit, default, clamping policy, and automation capability once in `src/domain/parameters.ts`; UI, validation, audio, and assistant tools read that definition instead of repeating literals.
- **Asset identity is pack-qualified**. A `Pack` (`pak_` ID, name, `major.minor.patch` version, publisher, kind, description, one rights position) describes *library* content and is never stored inside a project; an `Asset` names the `packId` and `packVersion` it resolved from. A project's `metadata.packDependencies` is the derived list of those packs — `derivePackDependencies(song)` computes it, `executeTransaction` recomputes it once per transaction, `saveSong` writes it to the metadata tier, and `parseProject` rejects a list that has drifted from the song's assets in either direction. Unresolvable audio is a reported state from `resolvePackAvailability`, naming the affected tracks and clips, never a dangling reference or a substituted version. It resolves per *asset*, not per version string: the caller supplies the pack versions it holds along with the asset IDs each contains, so a pack that gained sounds still resolves, a pack held at no version is a missing pack, and a deleted sound is a missing asset. See [`docs/persistence.md`](./docs/persistence.md#packs-and-pack-qualified-assets).
- `parseProject` is the only way to obtain a `Project`. It either returns a fully valid project or a list of issues, and never partially repairs input.
- Changing this contract is its own task (a dedicated GitHub issue), not incidental work inside a feature.

### Schema-v1 persistence (`src/persistence`)
- The three-tier Firestore layout is a contract: `projects/{projectId}` metadata, `projects/{projectId}/song/current`, `projects/{projectId}/clips/{clipId}`, and `projects/{projectId}/arrangement/{trackId}` chunks when the song document exceeds its budget. See [`docs/persistence.md`](./docs/persistence.md).
- `src/persistence/documents.ts` owns every collection path and document body. No other module builds a Firestore path or document for a project.
- Every write is revision-checked and every tier is written independently: a note edit writes one clip document, never song structure.
- `ProjectRepository` has an in-memory and a Firestore implementation, and both run the same contract suite. Only `firestoreProjectRepository.ts` imports `firebase/firestore`, so it is not re-exported from the directory barrel.
- Autosave (`autosave.ts`) coalesces rapid edits, exposes save state, keeps a failed write queued for retry, and ignores remote echoes at or below the local revision.

### Shared command layer (`src/commands`)
- Every project mutation — pointer, keyboard, or assistant — is a registered command. Components never write to project state; they build a typed command and hand it to `CommandHistory`.
- A command declares a versioned type, a Zod payload schema, a pure `apply`, a generated `invert`, and a one-line `summarize`. Payloads carry explicit IDs for anything they create, so replay, redo, and assistant previews reproduce the same project.
- `executeTransaction` is the atomic unit: commands apply to a working copy, the result is checked against every domain invariant, and any failure returns the original project object untouched. One committed transaction produces exactly one revision and one history entry.
- Continuous gestures use `history.beginGesture()`; every step applies immediately but the whole drag commits as one entry and one revision.
- Undo/redo is session-local, bounded, and replays inverse commands rather than project snapshots. Only an explicit `replaceProject` clears it — a save acknowledgement or remote echo must never touch it.
- Like `src/domain`, this layer imports no Firebase, Tone, or Solid. Adding or changing a command is a contract change; see the registry test's pinned command list.

### Audio engine (`src/audio`)
- `AudioRuntime` is the single application-scoped owner of the real-time Tone/Web Audio context, transport, buffer cache, and resource registry. It is the only place production code may create, install, resume, suspend, replace, or close that context — obtain it via `getAudioRuntime()`, never construct one directly.
- `ProjectAudioGraph` reconciles a read-only `AudioSongProjection` (from `src/projection/audioProjection.ts`) into a stable graph keyed by track, instrument, device, return, and asset IDs. Passing back the exact projection object the audio projection handed out previously is a complete no-op; an edit to one track, return, or placement only touches that entity's own subgraph.
- `TrackAudioGraph`/`ReturnAudioGraph`/`MasterAudioGraph` each own one channel strip (`Tone.PanVol`/`Tone.Volume`) plus a `DeviceChain`. `DeviceChain` reconciles an ordered `Device[]` by id: only added/removed devices create or dispose a node, and reordering relinks connections without recreating anything. Schema v1 has no concrete processors yet (Alpha Milestone 1 authors them); an unregistered `device.type` gets an inert passthrough node so topology is provable ahead of real DSP.
- `InstrumentGraph.ts` builds the sampler/synth/drum-machine node for a track's `Instrument`. A track only replaces its instrument node when `kind` changes; an asset swap, a drum-pad added/removed, or a generic parameter edit calls the existing node's `update()` instead. The module itself is just the `kind` dispatcher and the public surface (`InstrumentNode`, `InstrumentGraphContext`, `InstrumentNodeFactory`, `createInstrumentNode`, `playOneShot`) — consumers import it and nothing else. Each instrument's implementation lives in its own module under `src/audio/instruments/`, over the shared types in `instruments/types.ts` and the asset-subscription helpers in `instruments/assetVoice.ts`.
- `AudioBufferCache` decodes and caches asset buffers keyed by asset ID and content fingerprint, with reference-counted eviction and generation-tracked cancellation so a stale decode can never reconnect or overwrite a newer one. It never imports Tone itself — `toneBufferLoader.ts` is the one production loader that does, which keeps the cache's generation/refcount bookkeeping testable without any Web Audio globals.
- `Transport.ts` owns the session-scoped playhead: play/pause/stop/seek/continue, the 40-240 BPM clamp, a bar-aligned loop range, and the metronome. It is written against an injectable `TransportEngine` rather than `Tone.getTransport()`, and it never schedules the arrangement — a tempo change is mirrored onto the transport, not applied by rebuilding nodes. Tempo lives in the song and is written only by a `parameter.set` command; this layer mirrors it. `underrun.ts` counts late dispatches and reports them *sampled* as `audio_underrun`; it compares an event's intended time against `ProjectAudioGraph.audioClockNow()` (the context's true `currentTime`), never `Tone.now()`, which is `currentTime + lookAhead` and would score healthy playback as a continuous stream of drops.
- `audioLoopPlayer.ts` plays one scheduled audio-loop event. A loop declares the tempo it was authored at, and it follows the song tempo by *time-stretching*, not resampling: `Tone.GrainPlayer` walks the buffer at `tempo / sourceTempo` while each grain sounds at its native rate, so the loop's pitch stays where it was recorded. At an unstretched rate of 1 it falls back to a plain `Tone.Player`, so a loop at its own tempo pays no granular cost at all. `audioLoopOffsetSeconds` is a position in the *buffer's* timeline and `audioLoopDurationSeconds` a span of the *song's* — the two only coincide at rate 1, and mixing them up is what silently truncates or overruns a stretched loop.
- `scheduling.ts` expands a placement's clip content into absolute-tick events (looping and clip trimming included) as a pure function of the audio projection; `ProjectAudioGraph` schedules those against `Tone.Transport` (or an injected `AudioTransport` in tests) with an owner-tracked handle per event, never an anonymous global callback.
- Every constructed Tone/Web Audio resource is registered with the owning `AudioProjectScope` (`AudioRuntime.openProjectScope`) so disposal is idempotent and instrumented — components and domain stores request graph operations but never receive mutable audio nodes.
- [`docs/audio-graphs.html`](./docs/audio-graphs.html) draws every instrument, device and strip graph as nodes and connections. It is hand-kept, not generated: a change to how `src/audio` builds or wires nodes updates the matching entry in its `GRAPHS` list in the same PR (the comment at the top of the page explains the format).
- `src/editor/useProjectAudio.ts` is the one place a component wires a `Project` onto `ProjectAudioGraph`: it rebuilds the `AudioSongProjection` (passing the previous one through, so an unrelated edit reuses unchanged entries) on every project change, and its `play()` is the allowed user gesture that resumes the shared `AudioRuntime` context. The prototype `SongPlayer`/`ToneInstrument`/`AudioProvider.tsx` playback path this superseded was removed by `FND-009`; do not reintroduce a component-owned Tone lifecycle.

### Shortcut registry (`src/shortcuts`)
- `src/shortcuts/registry.ts` is the only place a key combination is written down ([`docs/shortcuts.md`](./docs/shortcuts.md) is its human copy). Event handling, tooltips, menu labels, the `?` guide, the `shortcut_used` analytics `action_id` set, and [`docs/shortcuts.md`](./docs/shortcuts.md) are all derived from it; a component never compares `event.key` itself and never adds its own `keydown` listener — modals included, which register `view.close_surface` for `Escape` (see `src/components/ConfirmDialog.tsx`) rather than owning a per-modal listener.
- An entry declares action ID, per-platform keys, valid contexts, guide group, and whether it follows or intentionally differs from Ableton Live. Enabled state is not in the registry — the surface that owns the action supplies a handler with an optional `isEnabled()`, and an action with no handler simply does not fire.
- `ShortcutController` is framework-free and owns every dispatch rule: `global` is always active, `dialog` suppresses every other context, typing targets keep their keys (only `Escape` is marked `textEntry: "allowed"`), auto-repeat is ignored unless the mapping opts in, and a disabled or unhandled action leaves the browser default alone. `useShortcuts` is the thin Solid adapter that installs it on the window.
- Matching reads `KeyboardEvent.key`, never `code`, and ignores the Shift modifier for punctuation, so `?` and `+` work on any keyboard layout.
- `ShortcutController` logs `shortcut_used` with the matched entry's own `action_id`; handlers never log analytics. Adding a mapping means adding its ID to `SHORTCUT_ACTION_IDS` in both the registry and `src/analytics/catalog.ts`, or `catalog.test.ts` fails.
- Adding a shortcut also means updating `docs/shortcuts.md` — `src/shortcuts/docs.test.ts` fails if the two drift.

### The palette (`src/theme.css`)
- **Read [`docs/design.md`](./docs/design.md) before changing how anything looks**: square corners, a monochrome palette with colour kept for meaning, clearly organised sections, and one shared set of parts.
- The faceplate design the instrument, device and mixer surfaces follow (#447) is [`docs/faceplate-system.html`](./docs/faceplate-system.html), a self-contained page that plays. It is the reference for layout, parts and states; `src/theme.css` stays the authority for colour.
- The Post-Alpha instruments (synth #940, wavetable #944, FM #945, drum synth #989, sampler #122/#943) follow [`docs/instrument-faceplates.html`](./docs/instrument-faceplates.html), a playable study in the faceplate system: every section stacks heading, well, switch and faders so each row lines up across the instrument; sections share one set of names and follow the signal (oscillators, filter, voice, amp envelope, filter or mod envelope, LFO); the header carries Randomize, the preset picker and Audition on its right. Its sounds and presets are stand-ins; its layout, parts and names are the reference.
- The library modal (#449) follows [`docs/library-browser.html`](./docs/library-browser.html), a playable walkthrough of finding, filtering, similar sounds, browsing packs, the library-only keys and inserting. Its data and synthesized sounds are stand-ins; its layout, parts and flow are the reference.
- The Export dialog (#724) follows the **Release** tab of [`docs/export-dialog.html`](./docs/export-dialog.html), a clickable prototype: the song leads, the stems track list is the mini-arrangement's name column (click, ⇧-click range, ⌘-click pick), stems over 2 GiB download as batched ZIPs, and a finished export celebrates in the tracks' own colours. Its data and render timings are stand-ins; its layout, parts, copy and states are the reference. The other two tabs are the alternatives it was chosen over.
- `src/theme.css` is the only place a colour is written down. It holds custom properties and nothing else, so a static page (`docs/architecture.html`) can link it without dragging the app's base styles along. `src/app.css` `@import`s it, and Vite inlines that at build time.
- **The interface is literally monochrome: every token is a neutral grey with R, G and B equal.** No tinted greys, no coloured accent, no coloured status. Black and white are the anchors; the ramp between them (`--mono-00` … `--mono-100`) is nine steps, each with exactly one job, and mid-greys are what it spends least.
- **State is brightness, not hue.** Selected, focused, active and playing are the brightest thing in their neighbourhood — usually a white fill with `--color-on-accent` (black) on it. `--color-accent-dim` and `--color-accent-deep` are the steps below for a fill under the pointer and for material that is present but not chosen.
- **The one exception is the selected track, which is black** (#447, a product-owner decision): the track the editor is showing sinks to `--color-background` wherever tracks are listed, the arrangement's header, the instrument rail, the mixer strip, and the selected drum pad's row with them, so the selection reads as a hole in the panel while pressed toggles and chosen options stay white.
- Status is monochrome too, so an error signals through emphasis and framing (`--color-danger-wash`/`-edge`) and through its wording — not through being red. A destructive action is a white fill with black on it, the loudest control on screen. If a pairing puts a bright fill under bright text, that is a bug: check the `color` beside every `background`.
- **The level meters' clip state is the one status in colour** (#447): a meter fills `--signal-ok` (green) while its track peaks under 0 dBFS and `--signal-clip` (red) for a moment after a peak goes over (`src/editor/trackLevels.ts`). Its bar is the RMS; only peaks can say a track clipped. The pair is a product-owner decision, only `LevelMeter.css` may read it, and `theme.test.ts` pins both halves.
- **A track's own colour is the other hue in the product, and it is not theme** — it is persisted domain data (`TRACK_COLORS` in `src/domain/factories.ts`), so changing it is a schema change. Against a colourless interface it is unmissable, which is the point.
- Style against a **semantic alias** (`--color-background-secondary`, `--color-text`, `--color-accent`), not a ramp step. The ramp is the vocabulary; only the aliases survive a re-theme. Never introduce a near-duplicate of a step that already exists, and never a local alias for a token that already says the same thing.
- `src/theme.test.ts` enforces all of it: a colour literal in any other stylesheet, a token read but never defined, a token whose channels are not all equal, a tint borrowing anything but black or white, a tenth ramp step, or an arrangement-canvas fallback that has drifted from the theme each fail there.
- A canvas cannot read a custom property, so `src/arrangement/canvasRenderer.ts` resolves the tokens off the document once and caches them; its literals are fallbacks for a context with no stylesheet (jsdom), pinned to the theme by that test.

### Service Layer
- Create service modules for external integrations (authService, dataService)
- Services handle all direct Firebase API calls
- Services provide clean, typed interfaces to the rest of the app

### Real-time Synchronization
- Use Firestore's `onSnapshot` for real-time updates
- Subscriptions are set up in the apply half of a `createEffect`, and their teardown is what that half returns
- Store updates mutate the draft the setter hands them; `produce` is gone, and draft mutation is the default

### Routing
- **There is no file-based routing.** `<FileRoutes />` came from `@solidjs/start/router`, and SolidStart has no Solid 2 release. Router 2 does ship a `fileRoutes()` adapter in `@solidjs/router/fs`, but it reads a `virtual:file-routes` manifest that `@solidjs/vite-plugin` does not emit, so there is nothing for it to consume
- Routes are an explicit table in `src/router.tsx`: a path and a `lazy()` page module per entry. Every page stays `lazy` — **except `/`**, which is eager because it is prerendered into the shell and its stylesheet has to be in the entry graph for that markup to paint styled (ADR 0008)
- Page modules live in `src/routes/`, but their filenames are only names — the `[param]`/`[...404]` spelling is gone, because nothing reads it. The patterns live in the table
- Use `useParams()` from `@solidjs/router` to read route parameters. Router 2 types them as `string | undefined`; narrow with `Show` rather than asserting (see `src/routes/projects/Project.tsx`)

## Testing

- Test files use `.test.ts` or `.test.tsx` extension
- Vitest configured with jsdom for DOM testing
- Use `@solidjs/testing-library` for component tests
- Use `@testing-library/jest-dom` for DOM assertions
- Beyond unit/component tests, the project has a Firebase Emulator suite (`tests/emulator/`, `bun run test:emulator`) and a Playwright browser E2E suite against a local Firestore/Auth emulator (`tests/e2e/emulator/`, `bun run test:browser:emulator`) — see [`docs/testing.md`](./docs/testing.md) for what each covers and how CI gates on them. The in-memory mock backend (`bun run dev:mock`) is a development backend only; no browser suite runs against it
- Use `src/shared/id.ts`'s `createId`/`createSeededIdFactory` for entity IDs and `src/shared/clock.ts`'s `Clock` for anything that needs the current time, rather than calling `nanoid()`/`Date.now()` directly, so tests can be deterministic
- Use `src/testing/fixtures.ts`'s builders (`buildProject`, `buildTrack`, ...) instead of hand-writing fixture literals in new tests

### `bun run test` needs an audio output device

Importing `tone` creates a real global `AudioContext`, and `node-web-audio-api`'s `cpal` backend refuses to create one on a host with no default output device (containers, CI runners, headless VMs), so any suite that reaches Tone fails at import time with `InvalidStateError: cpal backend error during default_output_config: DeviceUnavailable`.

That is an environment problem, not a test bug — **do not "fix" it by mocking Tone, skipping the file, or editing `src/audio/testAudioContext.ts`.** Set up a null ALSA device instead; [`CONTRIBUTING.md`](./CONTRIBUTING.md#a-null-alsa-device-on-machines-with-no-audio-hardware) has the exact steps.

**It applies to `bun run test` only — not the browser suites.** A real browser constructs a context regardless: Firefox reports `state="suspended"` on a runner with no `/dev/snd` at all. So if a *browser* test fails around audio, a null ALSA device will not help and its absence is not the cause — this exact wrong turn has already cost a CI round. See [`docs/testing.md`](./docs/testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap), and `LOOP-003` (#43) for the product-side gap behind it.

## Important Configuration Notes

1. **The app runs client-side only** - `solid({ start: true })` with no `ssr` in `vite.config.ts` is the plugin's **client start mode**. `vite build` emits a static `dist/client` whose `index.html` is the shell prerendered once through the built handler, and the client `render()`s (never hydrates) into it. The app itself never renders on the server, which is the PRD's client-only decision unchanged.

   That shell is **not empty**: `src/Document.tsx` renders the landing page's markup and metadata into it, so `/` is indexable, unfurls, and paints with JavaScript disabled (ADR 0008). Only the document goes through the SSR transforms — the app does not. Because the generated entry renders `<Document />` with no request, the shell cannot be path-aware, so `scripts/emit-app-shell.mjs` writes a stripped `app.html` after the build and `firebase.json` serves `/` from `index.html` and every other path from `app.html`; the dev server and `vite preview` serve one shell and an inline script removes the markup during parse. `bun run verify:landing-static` gates both halves. A landing-only tag added to the document **must** carry `data-landing="true"` or it ships on every deep link
2. **Module system** - Using ESNext with bundler resolution
3. **JSX** - Preserved with `@solidjs/web` as the import source (`tsconfig.json`'s `jsxImportSource`)
4. **Strict TypeScript** - All strict checks enabled
5. **Package Management** - This project uses Bun as the package manager
   - **NEVER commit package-lock.json** - This file is auto-generated by npm and conflicts with Bun's package management
   - Use `bun install` for installing dependencies, not `npm install`
   - package-lock.json is in .gitignore and should remain there

## Common Tasks

### Adding a new route
1. Create the page module in `src/routes/`, with the component as its default export
2. Add its path to the `routes` table in `src/router.tsx`, wrapping the import in `lazy()` so it stays its own chunk. The filename does not define the route — the table does
3. It is served the `app.html` shell, not the prerendered landing document, so it renders entirely on the client

### Adding a new data model
1. Define the entity's shape and Zod schema in `src/domain/entities.ts`, and add any invariants it needs to `src/domain/parse.ts`
2. Add a factory in `src/domain/factories.ts` and cover it in `src/domain/fixtures.ts` if other tests will need it
3. Add or extend the commands that create/mutate it in `src/commands/definitions/`, registered in `src/commands/registry.ts`
4. Extend `src/persistence/documents.ts` if it changes what a Firestore document stores

### Adding a new component
1. Create in appropriate directory under `src/components/`
2. Keep focused on single responsibility
3. Extract complex logic to separate functions
4. Use TypeScript for props

### Working with audio
1. Use `useProjectAudio()` (`src/editor/useProjectAudio.ts`) to wire a project onto playback from a component
2. All Tone.js code should be in `src/audio/`
3. Keep audio logic separate from UI components

### Referencing a factory sound
1. Never write an asset name, storage path, duration, sample rate, or channel count into `src/` — those are the library's facts, and `CNT-001` removed the last hand-maintained copy of them
2. Ask `src/library/factoryLibrary.ts` (`factoryLibraryEntry`, `createFactoryAsset`) instead; it reads `factoryLibrary.generated.ts`, which `bun run library:emit-runtime` produces from the same builders that emit the delivered pack manifests
3. To ship a different starter sound, change `RUNTIME_SELECTION` in `scripts/starter-library/runtime.mjs` and re-run the command — the committed module is drift-checked by `scripts/starter-library/runtime.test.mjs`
4. Browsing the rest of the library fetches the pack index and then a pack manifest (sample-library section 12); it is not bundled
