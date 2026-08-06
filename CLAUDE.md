# Solid Groove - Development Guide

## Project Overview

Solid Groove is a browser-based music production tool designed to make music creation accessible and intuitive. It features real-time collaboration, AI assistance, pattern-based sequencing, and a library of sounds and instruments.

## Tech Stack

### Core Framework
- **SolidJS** - Reactive UI framework
  - Use SolidJS best practices: signals, stores, effects, and resource patterns
  - Prefer `createStore` from `solid-js/store` for complex state
  - Use `createEffect` for side effects and `createMemo` for derived values
  - Utilize Context providers for global state (see the `AuthProvider` pattern in `src/auth/AuthProvider.tsx`)
- **SolidJS Start** - Meta-framework for SolidJS (currently configured as CSR-only with `ssr: false`)
- **Vinxi** - Build tool and dev server

### Backend & Data
- **Firebase Authentication** - User authentication and session management
- **Firebase Firestore** - Real-time database for project storage and synchronization
- **solid-firebase** - SolidJS integration library for Firebase
  - Note: Currently using manual subscriptions in dataService rather than solid-firebase hooks

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
│   ├── AudioRuntime.ts      # Single application-scoped Tone/Web Audio context (PRD 9.7)
│   ├── resourceRegistry.ts  # Owner/type tracked audio resource registry (PRD AUD-09)
│   ├── ProjectAudioGraph.ts # Stable ID-keyed project graph reconciled from the audio projection (PRD AUD-08)
│   ├── TrackAudioGraph.ts   # One track's instrument, device chain, sends, and channel strip
│   ├── ReturnAudioGraph.ts  # One return bus's device chain and channel strip
│   ├── MasterAudioGraph.ts  # The master bus's device chain and volume stage
│   ├── DeviceChain.ts       # Ordered, ID-keyed insert-chain reconciliation shared by tracks/returns/master
│   ├── InstrumentGraph.ts   # Sampler/synth/drum-machine instrument node factory and reconciliation
│   ├── instruments/         # The per-instrument implementations behind `InstrumentGraph.ts`
│   │   ├── types.ts             # `InstrumentNode`/`InstrumentGraphContext`/`InstrumentNodeFactory`, smoothing window, kind aliases
│   │   ├── assetVoice.ts        # Reattachable per-asset buffer subscription, `playOneShot`, shared gain/pitch helpers
│   │   ├── sampler.ts           # The sampler node: pitched, windowed voices under a per-trigger amp envelope
│   │   ├── synth.ts             # The polyphonic subtractive synth node: PolySynth into one smoothed low-pass filter
│   │   └── drumMachine.ts       # The drum-machine node: per-pad strips, mute/solo, choke groups, short-lived hits
│   ├── AudioBufferCache.ts  # Asset buffer cache keyed by ID/revision with stale-load cancellation
│   ├── toneBufferLoader.ts  # The only Tone-touching asset decode path `AudioBufferCache` uses in production
│   ├── Transport.ts         # Play/pause/stop/seek, playhead, tempo mirror, bar loop, metronome (PRD AUD-01/AUD-02)
│   ├── underrun.ts          # Sampled late-dispatch counter behind `audio_underrun` (PRD AUD-03/OPS-02)
│   ├── audioLoopPlayer.ts   # Pitch-preserving time-stretch for a tempo-labelled loop event (PRD INS-02)
│   └── scheduling.ts        # Placement/clip -> absolute-tick event expansion (musical time, not wall clock)
├── auth/               # Authentication logic
│   ├── AuthProvider.tsx     # Context provider for auth state
│   └── authService.ts       # Firebase auth service wrapper
├── components/         # Reusable UI components
│   ├── Dashboard.tsx
│   ├── LandingPage.tsx     # Public marketing landing page and the entry into anonymous start (PRD PRJ-06)
│   ├── ProjectList.tsx
│   └── ConfirmDialog.tsx   # Accessible confirmation modal for destructive actions (PRD PRJ-02)
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
│   └── selection.ts         # Pure selection ops + project-driven reconciliation
├── shortcuts/          # The one typed keyboard-shortcut registry (PRD KEY-01, KEY-02)
│   ├── types.ts             # Contexts, guide groups, Ableton parity, browser conflicts
│   ├── keys.ts              # Chord parsing, layout-aware matching, platform labels
│   ├── registry.ts          # The mapping table itself, plus lookups and reserved chords
│   ├── ShortcutController.ts # Framework-free dispatch: context, text entry, analytics
│   ├── useShortcuts.ts      # Solid adapter that installs a controller on the window
│   ├── ShortcutGuide.tsx    # The searchable `?` mapping guide, generated from the registry
│   └── textEntry.ts         # What counts as a typing target
├── projection/         # Read-only consumer projections built from a Project
│   ├── fingerprint.ts       # Deterministic content fingerprint for change detection
│   ├── audioProjection.ts        # Audio engine's song projection (PRD 9.7)
│   ├── arrangementProjection.ts  # Arrangement renderer's projection (PRD 9.3)
│   ├── projectSummaryProjection.ts # Dashboard/persistence summary (PRD 9.9)
│   └── assistantContextProjection.ts # Compact assistant context (PRD 9.8)
├── routes/             # File-based routing
│   ├── index.tsx            # Home/landing page
│   ├── dashboard.tsx        # User dashboard
│   └── projects/[id].tsx    # Project editor route
├── shared/             # Helpers production code AND tests depend on
│   ├── id.ts                # PRD 9.4 prefixed-ID factory (+ seeded test variant)
│   ├── clock.ts              # Injectable Clock abstraction
│   ├── scheduler.ts          # Injectable Scheduler for coalescing/deferred work
│   └── schema.ts             # Shared Zod parse helper (PRD 9.1 runtime-schema decision)
├── testing/            # Helpers only tests use
│   └── fixtures.ts          # Browser-safe fixture loading (public/fixtures/*)
├── app.tsx             # Root application component
├── entry-client.tsx    # Client entry point
├── firebaseConfig.ts   # Firebase configuration (+ local emulator wiring)
└── projectRepositoryClient.ts  # ProjectRepository composition root: in-memory (mock) vs Firestore

e2e/                    # Playwright browser E2E suite (in-memory mock backend)
├── flows/              # One spec per core flow (docs/core-flows.md), named for its CF- id
└── support/            # walkthrough.ts — the screenshot capture a flow spec drives
e2e-emulator/           # Playwright browser E2E suite against the Firestore/Auth emulator (FND-009)
└── flows/              # Core flows whose outcome needs a real backend (saving, reload, sign-in)
tests/emulator/         # Firebase Emulator suite (Firestore rules, etc.)
public/fixtures/        # Fixture data loaded by src/testing/fixtures.ts
```

## Task tracking and landing work

Implementation work is tracked entirely in **GitHub issues** in `afternoon/solid-groove` — there is no separate backlog document. Each task is one issue, titled with its task ID (for example `LOOP-003 - Transport, tempo, loop, and metronome`):

- **The GitHub issue is the single source of truth.** Its state, labels, assignee, comments, milestone, native `blocked_by` graph, and Projects v2 **Status** are authoritative for scope, ownership, status, and readiness. Agents read these fields directly from GitHub; they do not rely on any other record.
- **The issue body is the specification** — scope, the PRD requirements it satisfies, and the acceptance checkboxes. `docs/prd.md` remains authoritative for product behavior; an issue links back to and never weakens it.
- **The issue is the live record** — its state and labels are status, its assignee is ownership, and its comments carry progress, blockers, and discoveries. Alpha Milestone 0 tasks `FND-001`–`FND-008` and `CNT-000` predate this convention and are recorded in git history instead; they have no issue.
- **Readiness is the issue's native `blocked_by` graph — nothing else.** A task is ready to start when every issue in its `blocked_by` graph is closed (`gh api repos/afternoon/solid-groove/issues/<n>/dependencies/blocked_by`, edited directly on GitHub). **Ignore any "Dependencies" field or dependency prose written into an issue body**: that text is descriptive only, is not kept in sync, and never gates readiness — the `blocked_by` graph is the authority. Keep the graph correct so the body never has to be consulted. The `blocked` label marks a task gated on an undecided `DEC-*` product decision. Milestones group tasks by Alpha Milestone; Projects v2 **Status** (Todo / In Progress / Done) drives the orchestrator.

### Core flows are the acceptance contract

A **core flow** is one user journey that must work end to end when a feature is
finished, written in plain English *before* any code exists. They live in
[`docs/core-flows.md`](./docs/core-flows.md), each with a stable ID (`CF-001`, …)
that an issue links to, a Playwright spec is named after, and a screenshot
walkthrough is captured from. Read that file for the format and the lifecycle;
what matters here is how the flows shape the work:

1. **The product owner writes the flows and links them from the issue.** A flow
   that depends on work which does not exist yet gets that dependency broken out
   as its own issue first.
2. **The flow and its spec land together, before implementation starts** —
   the entry in `docs/core-flows.md` and `e2e/flows/<ID>.spec.ts` (or
   `e2e-emulator/flows/<ID>.spec.ts`) in one PR, marked `test.fixme` because the
   implementation does not exist. That PR is the product owner's, and it is
   reviewed on its own, before anything is built, because it is the contract
   everything else is measured against — which is exactly why the implementation
   pipeline does not write it. `test.fixme` is what keeps it honest *and*
   mergeable: a skipped test is green, so the slice satisfies the same "green on
   its own commit" rule as every other PR, and a deliberately red PR would either
   block the work or redden `main` for every parallel task. The red→green
   evidence belongs in the run log, not in a merge. It also has to land as one
   PR: `bun run verify:core-flows` fails a registered flow that has no spec, so
   a register edit on its own cannot merge green.
3. **From then on the spec is frozen.** A later PR that changes its assertions
   must say so in its body and justify it; a reviewer treats an unexplained
   change as blocking. If the implementer can edit the test, the test proves
   nothing.
4. **`docs/core-flows.md` and `docs/prd.md` are read-only to implementers and
   reviewers.** A flow that is ambiguous, impossible, or contradicted by the PRD
   is reported on the issue, never edited to match what was built.
5. **The PR that closes the issue removes every `test.fixme` marker in the same
   diff that makes the flows pass**, and carries the walkthrough captured from
   that passing run. `bun run verify:core-flows` enforces the 1:1 mapping between
   registered flows and specs, and reports any flow still parked.

`.claude/workflows/solid-groove-feature.js` runs the rest of the pipeline for
one issue — verify the contract → implement → review → land → walkthrough. It
never writes a flow spec: if a linked flow is not registered and specced on
`main`, it stops without building anything. Invoke it through the
**`/implement-feature #123`** skill (`.claude/skills/implement-feature/`), from a
terminal, claude.ai/code, or the mobile app: the skill verifies the prework first
(the issue links flows, every flow is registered, complete, and specced, the
`blocked_by` graph is closed), runs the workflow, and then verifies the resulting
stack — bases, `(i/n)` titles, `Refs`/`Closes`, PR size, an untouched
specification, no flow left at `test.fixme`, and that the walkthrough images
actually return `200` rather than rendering as broken icons. The workflow and agent definitions are
human-approved: an agent running the skill reports a problem with them and never
edits them.

### Landing work

1. **A PR is a single reviewable unit of purpose, not a whole task.** Each agent works in its own git worktree so parallel implementations do not collide on the filesystem, and a broken PR never blocks review of an unrelated one. One PR does one thing a reviewer can hold in their head at once — "introduce the *X* commands", "add the *Y* domain entity and its schema", "wire the *Z* panel UI onto existing commands". A task that cannot be delivered as one such unit is **split into several stacked PRs**, sequenced so each builds on the last (see item 5).
2. **A PR's diff is at most 400 lines changed** (added + deleted in product and test code; generated files, lockfiles, and vendored assets do not count — and never let a generated blob smuggle real logic past this). This is a hard ceiling, not a target: if the honest slice does not fit, the slice is wrong — cut it smaller, do not shave tests to squeeze under. Keep each PR vertical and self-contained *for its purpose*: the product code for that slice, **the tests that cover it in the same PR** (a UI PR that leans on commands from an earlier PR in the stack re-tests the behavior it newly exposes; splitting must never drop coverage or defer it to a later PR), and any fixtures/docs that slice needs. The PR body links its issue (`Refs #<n>` for a mid-stack PR, `Closes #<n>` only on the PR that completes the task), names its place in the stack ("2 of 3, builds on #<prev>"), and states the evidence. **Any change that alters the UI includes a walkthrough** in the body of the PR that closes the issue: a sequence of captioned screenshots starting from a common entrypoint (the public landing page, the project dashboard, or a project page) and walking to the change. It is not assembled by hand — `bun run walkthrough:capture` takes one screenshot per `step()` in the now-passing core-flow specs and `bun run walkthrough:publish -- --issue <n>` pushes them to the `claude/walkthroughs` orphan branch and prints the Markdown to paste in. That is deliberate: the walkthrough is a byproduct of the test that proves the flow, so it cannot drift from what shipped, and it always starts where a person actually arrives. (Images cannot be attached to a PR body through the GitHub API at all, which is why they live on a branch and the body links them.) A PR with no user-visible change says so instead. The PR template (`.github/pull_request_template.md`) has the section.
3. **Land the central-registration edits first, as their own tiny PR.** A few files are shared registration points that every parallel feature appends to — `src/analytics/catalog.ts` (event keys), `src/commands/registry.ts` and `src/commands/index.ts` (command IDs), `src/domain/parse.ts` (invariants), and `src/editor/EditorView.tsx` (where a panel mounts). Two features editing the same one collide on merge even when their real code is disjoint, and that collision surfaces late — after review, when the first of the pair lands. So when a task must touch one of these, the **first PR in its stack is the registration alone**: add the catalog keys, register the command ID, add the invariant, reserve the panel slot — nothing else. Keep it to a few lines so it reviews in seconds (a phone-sized review) and merges immediately, shrinking the window in which a sibling can clash with it. The bulky feature PR that follows then touches only its own new files. This does not apply to a task that adds no central registration; do not manufacture a trivial PR where there is nothing shared to land.
4. **Do not edit `docs/prd.md` unless the task strictly requires it.** The PRD is authoritative for product behavior, every parallel task reads it, and it merge-conflicts as badly as any registry. A task references PRD requirements; it does not restate or amend them. Change it only when the task's own definition genuinely revises product behavior, and then in the smallest possible edit — never incidental wording, reformatting, or "while I'm here" additions.
5. Do not start a task until every `blocked_by` issue is closed, unless the task explicitly permits parallel discovery work. **Stacked PRs within one task** branch each next PR off the previous PR's branch (not off `main`), so each PR's diff shows only its own slice; set that PR's base to the previous branch (`gh pr create --base <prev-branch>`). When an earlier PR in the stack merges, retarget the next one's base to `main` (`gh pr edit <n> --base main`) and rebase it so its diff stays clean. A later PR in a stack may open while an earlier one is still in review — that is the point — but it must not be *merged* ahead of the PR it builds on.

   **A stack is only worth it if the front can merge without the back.** Four properties buy that, and a stack without them costs more to review than one big PR: (a) **every slice is green on its own commit**, not merely at the tip — run the checks per slice, so PR 1 can merge and be walked away from; (b) **each PR states the invariant that makes it safe and proves it in one line** ("`Foo.test.tsx` untouched across the stack — `git diff --stat` is empty, 22 tests pass unchanged"), so the reviewer verifies a claim in seconds instead of reading every hunk; (c) **a move is only a move** — never mix a behavior change into a relocation, or the reviewer cannot tell which hunks are which, and the two land as separate PRs instead; (d) **red tests are named and diagnosed**, with evidence they fail on unmodified `main` too, rather than dismissed as an unrelated flake. A deliberate deviation from what the issue asked for is stated in the PR body with its reasoning — declining a suggestion is a normal outcome, silently skipping it is what costs.
6. A **contract-owning task lands before its dependents start.** Domain schema, command registry, parameter definitions, persistence layout, selection, audio projection, and rendering projection are contracts; an agent must not alter a published one as incidental feature work. Changing a landed contract is its own issue, updating every contract test and consumer together.
7. Git history is the completion record. Do not put a commit hash into the commit itself.
8. Do not preserve compatibility with prototype project data. Schema v1 is the first production schema; migrations are required only for persisted changes after v1 is established.

### Definition of done for every task

- The task's linked PRD acceptance criteria pass, including failure and empty states relevant to the slice.
- **Every core flow the issue links passes**, with its `test.fixme` marker removed by the PR that closes the issue, and neither `docs/core-flows.md`, `docs/prd.md`, nor the flow spec's assertions changed along the way. `bun run verify:core-flows` passes and reports no parked flow.
- **The closing PR carries the captured walkthrough** and, once CI is green, the `deploy-preview` label so the change can be walked on a preview channel. A preview runs against the **live production** backend with production's current security rules — never label a stack that changes `firestore.rules` or `storage.rules`, since a preview cannot prove a rules change and an unreviewed branch must not reach production's access rules.
- New behavior is reachable through shared commands and boundaries rather than a feature-specific mutation path.
- Tests fail before the implementation and pass afterward at the lowest useful layer.
- `bun run typecheck`, `bun run test`, and `bun run check` pass. Tasks that touch browser, Firebase, audio, performance, or export behavior also run their task-specific suites.
- Resource ownership, accessibility, supported-browser behavior, and persistence effects have been considered and tested where applicable.
- **Analytics ships with the feature.** From `FND-001c` onward, any task that adds or changes a user action emits its PRD OPS-02 events through the shared typed analytics catalog, plus the reliability event for its principal failure path, with tests that the event fires once per action and that disabling analytics changes nothing. A task whose events are left for later is not done. A user action the catalog does not yet cover extends the catalog in the same PR — at minimum a `feature_first_use` key — rather than shipping unmeasured, and no task introduces an ad-hoc event string outside the catalog.
- No event or error-report parameter carries a project, track, clip, section, or asset name, assistant text, a user-entered string, an asset URL, or a token.
- The slice has been exercised against a production-like build in the gating browsers through its browser E2E and emulator suites, not only against a local dev server. Hosted-environment verification is **not** a per-task gate: it is batched into `OPS-001` after Alpha Milestone 2. A task does not stay open waiting for a hosted environment that does not exist yet, and equally does not claim a deploy, smoke test, rollback, or delivered event that never happened.
- No unrelated formatting, dependency, generated-file, or refactor churn is included.
- **Every PR is at most 400 changed lines and has one clear purpose** (see Landing work items 1–3). A task larger than that ships as a stack of such PRs, each carrying the tests for its own slice so coverage never dips. The task is done when the final PR in its stack — the one that closes the issue — has landed with all acceptance criteria met; earlier PRs in the stack close no issue on their own.

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
bun run check        # Run Biome linting and formatting (auto-fix)
bun run check:ci     # Same checks, non-mutating (CI gate; use `check` locally)

# Testing
bun run test              # Unit + component tests, once (needs an audio output device — see Testing below)
bun run test:watch        # Unit + component tests, watch mode
bun run test:ui           # Unit + component tests, Vitest UI
bun run test:emulator     # Firebase Emulator suite (Firestore rules, etc.)
bun run test:browser      # Browser E2E suite (Playwright: Chromium/Firefox/WebKit; in-memory mock backend)
bun run test:browser:emulator  # Browser E2E suite against a local Firestore/Auth emulator (chromium/firefox)
bun run test:browser:chromium           # Chromium-only pre-flight for the two suites above
bun run test:browser:emulator:chromium  # (see "Which browsers run where" in docs/testing.md)
bun run test:browser:install  # One-time: download Playwright's browser binaries

# Core flows and PR walkthroughs
bun run verify:core-flows                    # Every flow in docs/core-flows.md has exactly one spec, and vice versa
bun run walkthrough:capture                  # Screenshot each step() of the passing e2e/flows specs
bun run walkthrough:capture:emulator         # The same, for e2e-emulator/flows
bun run walkthrough:publish -- --issue <n>   # Push the images and print the Markdown for the PR body
```

An environment that cannot reach `cdn.playwright.dev` — Claude Code on the web
included — can only install Chromium. Run the `:chromium` pre-flights there and
let CI gate Firefox and WebKit: it runs the full matrix on every push to
`main` and `claude/**`, so pushing your branch *is* the cross-browser check. A
green Chromium-only run is not the PRD section 10 gating evidence and must not
be reported as one.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, the three backends the app can run against (mock, Firebase Emulator, real project), and the day-to-day loop; [`docs/testing.md`](./docs/testing.md) for what each suite covers, how CI gates on them, and the shared test helpers (`src/shared/id.ts`, `src/shared/clock.ts`, `src/testing/fixtures.ts`).

## Code Style Guidelines

### General Principles
- **Keep code tidy and modular**: Break out functions and components to keep them simple, clear, and easy to read
- **No long, complex blobs**: If a function or component is getting too long, split it into smaller pieces
- **Prefer third-party dependencies**: Use well-maintained libraries rather than implementing common functionality from scratch
- **Use TypeScript strictly**: The project has `strict: true` enabled

### SolidJS Best Practices

1. **State Management**
   - Use `createStore` with `produce` for complex nested state updates (see `src/editor/useEditorSession.ts`)
   - Domain state changes only through the command layer (`src/commands`); a component never mutates a `Project` directly
   - Export setter functions rather than exposing setters directly
   - Keep stores focused on a single domain (auth, editor session, etc.)

2. **Context Providers**
   - Follow the pattern in `AuthProvider.tsx:20`
   - Always provide a typed hook for consuming context (e.g., `useAuth()`)
   - Type assert the context return value to avoid optional checks

3. **Effects and Cleanup**
   - Use `createEffect` for subscriptions and side effects
   - Always call `onCleanup` for subscriptions (see project.ts:30)
   - Example pattern:
   ```typescript
   createEffect(() => {
     const unsubscribe = service.subscribe(...);
     onCleanup(() => unsubscribe());
   });
   ```

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
- `src/domain` is the authoritative schema-v1 contract (PRD sections 9.4 and 9.5). Its types, Zod schemas, invariants, and tests replace any separate domain-model document.
- It has no Firebase, Tone.js, or SolidJS imports. Persistence, commands, audio, and rendering consume it from outside; audio nodes and Firestore `Timestamp`s never enter project state.
- Persistent relationships use prefixed IDs from `createIdFactory()` (`createSeededIdFactory()` in tests), never array positions.
- Musical time is integer ticks at 192 PPQ. Seconds, bars/beats/16ths, and pixels are derived through `src/domain/time.ts`.
- A user-controlled numeric value declares its range, unit, default, clamping policy, and automation capability once in `src/domain/parameters.ts`; UI, validation, audio, and assistant tools read that definition instead of repeating literals.
- **Asset identity is pack-qualified** (PRD LIB-05, invariant 12). A `Pack` (`pak_` ID, name, `major.minor.patch` version, publisher, kind, description, one rights position) describes *library* content and is never stored inside a project; an `Asset` names the `packId` and `packVersion` it resolved from. A project's `metadata.packDependencies` is the derived list of those packs — `derivePackDependencies(song)` computes it, `executeTransaction` recomputes it once per transaction, `saveSong` writes it to the metadata tier, and `parseProject` rejects a list that has drifted from the song's assets in either direction. An unavailable pack is a reported state from `resolvePackAvailability`, naming the affected tracks and clips, never a dangling reference or a substituted version. See [`docs/persistence.md`](./docs/persistence.md#packs-and-pack-qualified-assets).
- `parseProject` is the only way to obtain a `Project`. It either returns a fully valid project or a list of issues, and never partially repairs input.
- Changing this contract is its own task (a dedicated GitHub issue), not incidental work inside a feature.

### Schema-v1 persistence (`src/persistence`)
- The PRD section 9.9 three-tier Firestore layout is a contract: `projects/{projectId}` metadata, `projects/{projectId}/song/current`, `projects/{projectId}/clips/{clipId}`, and `projects/{projectId}/arrangement/{trackId}` chunks when the song document exceeds its budget. See [`docs/persistence.md`](./docs/persistence.md).
- `src/persistence/documents.ts` owns every collection path and document body. No other module builds a Firestore path or document for a project.
- Every write is revision-checked and every tier is written independently: a note edit writes one clip document, never song structure.
- `ProjectRepository` has an in-memory and a Firestore implementation, and both run the same contract suite. Only `firestoreProjectRepository.ts` imports `firebase/firestore`, so it is not re-exported from the directory barrel.
- Autosave (`autosave.ts`) coalesces rapid edits, exposes save state, keeps a failed write queued for retry, and ignores remote echoes at or below the local revision.

### Shared command layer (`src/commands`)
- Every project mutation — pointer, keyboard, or assistant — is a registered command (PRD section 9.6). Components never write to project state; they build a typed command and hand it to `CommandHistory`.
- A command declares a versioned type, a Zod payload schema, a pure `apply`, a generated `invert`, and a one-line `summarize`. Payloads carry explicit IDs for anything they create, so replay, redo, and assistant previews reproduce the same project.
- `executeTransaction` is the atomic unit: commands apply to a working copy, the result is checked against every domain invariant, and any failure returns the original project object untouched. One committed transaction produces exactly one revision and one history entry.
- Continuous gestures use `history.beginGesture()`; every step applies immediately but the whole drag commits as one entry and one revision.
- Undo/redo is session-local, bounded, and replays inverse commands rather than project snapshots. Only an explicit `replaceProject` clears it — a save acknowledgement or remote echo must never touch it.
- Like `src/domain`, this layer imports no Firebase, Tone, or Solid. Adding or changing a command is a contract change; see the registry test's pinned command list.

### Audio engine (`src/audio`)
- `AudioRuntime` is the single application-scoped owner of the real-time Tone/Web Audio context, transport, buffer cache, and resource registry (PRD AUD-07, AUD-09; section 9.7). It is the only place production code may create, install, resume, suspend, replace, or close that context — obtain it via `getAudioRuntime()`, never construct one directly.
- `ProjectAudioGraph` reconciles a read-only `AudioSongProjection` (from `src/projection/audioProjection.ts`) into a stable graph keyed by track, instrument, device, return, and asset IDs (PRD AUD-03, AUD-08). Passing back the exact projection object the audio projection handed out previously is a complete no-op; an edit to one track, return, or placement only touches that entity's own subgraph.
- `TrackAudioGraph`/`ReturnAudioGraph`/`MasterAudioGraph` each own one channel strip (`Tone.PanVol`/`Tone.Volume`) plus a `DeviceChain`. `DeviceChain` reconciles an ordered `Device[]` by id: only added/removed devices create or dispose a node, and reordering relinks connections without recreating anything. Schema v1 has no concrete processors yet (Alpha Milestone 1 authors them); an unregistered `device.type` gets an inert passthrough node so topology is provable ahead of real DSP.
- `InstrumentGraph.ts` builds the sampler/synth/drum-machine node for a track's `Instrument`. A track only replaces its instrument node when `kind` changes; an asset swap, a drum-pad added/removed, or a generic parameter edit calls the existing node's `update()` instead. The module itself is just the `kind` dispatcher and the public surface (`InstrumentNode`, `InstrumentGraphContext`, `InstrumentNodeFactory`, `createInstrumentNode`, `playOneShot`) — consumers import it and nothing else. Each instrument's implementation lives in its own module under `src/audio/instruments/`, over the shared types in `instruments/types.ts` and the asset-subscription helpers in `instruments/assetVoice.ts`.
- `AudioBufferCache` decodes and caches asset buffers keyed by asset ID and content fingerprint, with reference-counted eviction and generation-tracked cancellation so a stale decode can never reconnect or overwrite a newer one. It never imports Tone itself — `toneBufferLoader.ts` is the one production loader that does, which keeps the cache's generation/refcount bookkeeping testable without any Web Audio globals.
- `Transport.ts` owns the session-scoped playhead: play/pause/stop/seek/continue, the 40-240 BPM clamp, a bar-aligned loop range, and the metronome (PRD AUD-01/AUD-02). It is written against an injectable `TransportEngine` rather than `Tone.getTransport()`, and it never schedules the arrangement — a tempo change is mirrored onto the transport, not applied by rebuilding nodes. Tempo lives in the song and is written only by a `parameter.set` command; this layer mirrors it. `underrun.ts` counts late dispatches and reports them *sampled* as `audio_underrun`; it compares an event's intended time against `ProjectAudioGraph.audioClockNow()` (the context's true `currentTime`), never `Tone.now()`, which is `currentTime + lookAhead` and would score healthy playback as a continuous stream of drops.
- `audioLoopPlayer.ts` plays one scheduled audio-loop event. A loop declares the tempo it was authored at, and it follows the song tempo by *time-stretching*, not resampling: `Tone.GrainPlayer` walks the buffer at `tempo / sourceTempo` while each grain sounds at its native rate, so the loop's pitch stays where it was recorded (PRD INS-02). At an unstretched rate of 1 it falls back to a plain `Tone.Player`, so a loop at its own tempo pays no granular cost at all. `audioLoopOffsetSeconds` is a position in the *buffer's* timeline and `audioLoopDurationSeconds` a span of the *song's* — the two only coincide at rate 1, and mixing them up is what silently truncates or overruns a stretched loop.
- `scheduling.ts` expands a placement's clip content into absolute-tick events (looping and clip trimming included) as a pure function of the audio projection; `ProjectAudioGraph` schedules those against `Tone.Transport` (or an injected `AudioTransport` in tests) with an owner-tracked handle per event, never an anonymous global callback.
- Every constructed Tone/Web Audio resource is registered with the owning `AudioProjectScope` (`AudioRuntime.openProjectScope`) so disposal is idempotent and instrumented (PRD AUD-09) — components and domain stores request graph operations but never receive mutable audio nodes.
- `src/editor/useProjectAudio.ts` is the one place a component wires a `Project` onto `ProjectAudioGraph`: it rebuilds the `AudioSongProjection` (passing the previous one through, so an unrelated edit reuses unchanged entries) on every project change, and its `play()` is the allowed user gesture that resumes the shared `AudioRuntime` context. The prototype `SongPlayer`/`ToneInstrument`/`AudioProvider.tsx` playback path this superseded was removed by `FND-009`; do not reintroduce a component-owned Tone lifecycle.

### Shortcut registry (`src/shortcuts`)
- `src/shortcuts/registry.ts` is the only place a key combination is written down (PRD KEY-01). Event handling, tooltips, menu labels, the `?` guide, the `shortcut_used` analytics `action_id` set, and [`docs/shortcuts.md`](./docs/shortcuts.md) are all derived from it; a component never compares `event.key` itself and never adds its own `keydown` listener — modals included, which register `view.close_surface` for `Escape` (see `src/components/ConfirmDialog.tsx`) rather than owning a per-modal listener.
- An entry declares action ID, per-platform keys, valid contexts, guide group, and whether it follows or intentionally differs from Ableton Live. Enabled state is not in the registry — the surface that owns the action supplies a handler with an optional `isEnabled()`, and an action with no handler simply does not fire.
- `ShortcutController` is framework-free and owns every dispatch rule: `global` is always active, `dialog` suppresses every other context, typing targets keep their keys (only `Escape` is marked `textEntry: "allowed"`), auto-repeat is ignored unless the mapping opts in, and a disabled or unhandled action leaves the browser default alone. `useShortcuts` is the thin Solid adapter that installs it on the window.
- Matching reads `KeyboardEvent.key`, never `code`, and ignores the Shift modifier for punctuation, so `?` and `+` work on any keyboard layout.
- `ShortcutController` logs `shortcut_used` with the matched entry's own `action_id`; handlers never log analytics. Adding a mapping means adding its ID to `SHORTCUT_ACTION_IDS` in both the registry and `src/analytics/catalog.ts`, or `catalog.test.ts` fails.
- Adding a shortcut also means updating `docs/shortcuts.md` — `src/shortcuts/docs.test.ts` fails if the two drift.

### Service Layer
- Create service modules for external integrations (authService, dataService)
- Services handle all direct Firebase API calls
- Services provide clean, typed interfaces to the rest of the app

### Real-time Synchronization
- Use Firestore's `onSnapshot` for real-time updates
- Subscriptions are set up in `createEffect` with proper cleanup
- Store updates use `produce` for immutable updates

### File-based Routing
- Routes are defined by files in `src/routes/`
- Dynamic routes use `[param]` syntax
- Use `useParams()` to access route parameters

## Testing

- Test files use `.test.ts` or `.test.tsx` extension
- Vitest configured with jsdom for DOM testing
- Use `@solidjs/testing-library` for component tests
- Use `@testing-library/jest-dom` for DOM assertions
- Beyond unit/component tests, the project has a Firebase Emulator suite (`tests/emulator/`, `bun run test:emulator`), a Playwright browser E2E suite against the in-memory mock backend (`e2e/`, `bun run test:browser`), and a Playwright browser E2E suite against a local Firestore/Auth emulator (`e2e-emulator/`, `bun run test:browser:emulator`) — see [`docs/testing.md`](./docs/testing.md) for what each covers and how CI gates on them
- Use `src/shared/id.ts`'s `createId`/`createSeededIdFactory` for entity IDs and `src/shared/clock.ts`'s `Clock` for anything that needs the current time, rather than calling `nanoid()`/`Date.now()` directly, so tests can be deterministic
- Use `src/testing/fixtures.ts`'s builders (`buildProject`, `buildTrack`, ...) instead of hand-writing fixture literals in new tests

### `bun run test` needs an audio output device

Importing `tone` creates a real global `AudioContext`, and `node-web-audio-api`'s `cpal` backend refuses to create one on a host with no default output device (containers, CI runners, headless VMs), so any suite that reaches Tone fails at import time with `InvalidStateError: cpal backend error during default_output_config: DeviceUnavailable`.

That is an environment problem, not a test bug — **do not "fix" it by mocking Tone, skipping the file, or editing `src/audio/testAudioContext.ts`.** Set up a null ALSA device instead; [`CONTRIBUTING.md`](./CONTRIBUTING.md#a-null-alsa-device-on-machines-with-no-audio-hardware) has the exact steps.

**It applies to `bun run test` only — not the browser suites.** A real browser constructs a context regardless: Firefox reports `state="suspended"` on a runner with no `/dev/snd` at all. So if a *browser* test fails around audio, a null ALSA device will not help and its absence is not the cause — this exact wrong turn has already cost a CI round. See [`docs/testing.md`](./docs/testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap), and `LOOP-003` (#43) for the product-side gap behind it.

## Important Configuration Notes

1. **SSR is disabled** - The app runs client-side only (app.config.ts:4)
2. **Module system** - Using ESNext with bundler resolution
3. **JSX** - Preserved with `solid-js` import source
4. **Strict TypeScript** - All strict checks enabled
5. **Package Management** - This project uses Bun as the package manager
   - **NEVER commit package-lock.json** - This file is auto-generated by npm and conflicts with Bun's package management
   - Use `bun install` for installing dependencies, not `npm install`
   - package-lock.json is in .gitignore and should remain there

## Common Tasks

### Adding a new route
1. Create file in `src/routes/`
2. File name becomes the route (e.g., `about.tsx` → `/about`)
3. Default export is the page component

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
