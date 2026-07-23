# Solid Groove implementation backlog

| Field | Value |
| --- | --- |
| Status | Active planning document |
| Product requirements | [`docs/prd.md`](./prd.md) |
| Content plan | [`docs/sample-library.md`](./sample-library.md) |
| Scope | Private alpha P0, followed by explicitly parked P1/P2 work |

## 1. How agents use this backlog

This file is the operational source of truth for implementation order and ownership. The PRD remains authoritative for product behavior and acceptance criteria. A task does not weaken or replace any linked PRD requirement.

### Status values

- `todo`: not claimed and dependencies may or may not be complete.
- `in-progress`: owned by exactly one agent and actively being implemented.
- `blocked`: work started but cannot continue; the task records the concrete blocker.
- `review`: implementation is complete but requires contract, product, or integration review.
- `done`: merged implementation and tests satisfy every task checkbox.
- `parked`: intentionally outside the current release phase; do not claim.

### Claim and completion protocol

1. Before changing product code, set the task's `Status` to `in-progress` and replace `unassigned` with the agent identifier. Coordinate that claim on the shared branch before doing substantial work; Git history records when ownership changed.
2. Claim only one implementation task at a time. Do not claim a task until every dependency is `done` unless the task explicitly permits parallel discovery work.
3. The owning agent is the only agent that edits its task block. Cross-task discoveries are recorded under `Notes` in the affected task or proposed as a new task instead of silently expanding scope.
4. Keep changes vertical and mergeable. Product code, tests, fixtures, documentation, and the final backlog update belong in the same implementation commit or PR.
5. To finish, check every acceptance box, set `Status` to `done`, and replace `Evidence: pending` with the relevant test commands and durable artifact paths. Git history is the completion record; do not put a commit hash into the commit itself.
6. Use `blocked` only with a named unmet dependency or decision. Include what was tried and the smallest action needed to unblock it.
7. An agent must not alter a published domain, command, persistence, selection, audio-projection, or rendering-projection contract as incidental feature work. Create or claim a contract-change task and update all contract tests and consumers together.
8. Do not preserve compatibility with prototype project data. Schema v1 is the first production schema; migrations are required only for persisted changes after v1 is established.

### Definition of done for every task

- The task's linked PRD acceptance criteria pass, including failure and empty states relevant to the slice.
- New behavior is reachable through shared commands and boundaries rather than a feature-specific mutation path.
- Tests fail before the implementation and pass afterward at the lowest useful layer.
- `bun run typecheck`, `bun run test`, and `bun run check` pass. Tasks that touch browser, Firebase, audio, performance, or export behavior also run their task-specific suites.
- Resource ownership, accessibility, supported-browser behavior, and persistence effects have been considered and tested where applicable.
- No unrelated formatting, dependency, generated-file, or refactor churn is included.

## 2. Release gates and parallelism

| Gate | Opens when | Work unlocked |
| --- | --- | --- |
| G0: Tooling ready | `FND-001` done | Code-first contracts and independent architecture spikes |
| G1: Contracts published | `FND-002` through `FND-005` done | Audio, renderer, content, and thin-slice integration |
| G2: Foundation slice proven | `FND-009` done | Broad Phase 1 loop-workflow parallelism |
| G3: Manual loop complete | `LOOP-016` done | Arrangement, automation, and export expansion |
| G4: Arrangement/export complete | `REL-001` done | AI integration against stable commands |
| G5: AI complete | `REL-002` done | Private-alpha hardening and user validation |
| G6: Private alpha ready | `REL-003` done | P1 work may be unparked by the product owner |

Only `FND-001` starts immediately. After it lands, `FND-002`, `FND-006`, and `FND-008` may proceed in parallel because they own separate code boundaries. `FND-003` through `FND-005` depend on the canonical domain schema. Broad feature parallelism begins only after `FND-009` proves the contracts together.

## 3. Product decisions

Decision tasks are owned by the product owner, not guessed by implementation agents. A downstream implementation task becomes `blocked` if its required decision is not `done` by the time the task is otherwise ready.

### DEC-001 - Anonymous project retention

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: LOOP-001`<br>
`Evidence: pending`

Decide whether anonymous projects expire and define the account-upgrade promise across devices. Record the decision in PRD section 16 and add any retention/deletion requirements to `LOOP-001` and `HARD-003`.

### DEC-002 - Featured alpha templates

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: LOOP-015`<br>
`Evidence: pending`

Approve the six featured dashboard genres or replace the proposal in the sample-library plan. The broader required genre coverage remains unchanged.

### DEC-003 - Alpha content sources and licences

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: CNT-002`<br>
`Evidence: pending`

Approve content sources, commissioning budget, redistribution terms, attribution policy, and whether any source assets must be excluded from stems or Ableton packages.

### DEC-004 - WAV normalization policy

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: EXP-002`<br>
`Evidence: pending`

Decide whether stereo and stem exports preserve project gain exactly or apply a documented peak/loudness policy. Do not let an implementation library choose product behavior implicitly.

### DEC-005 - AI provider and data policy

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: AI-001`<br>
`Evidence: pending`

Choose the provider/model, per-user budget and usage limits, request retention policy, and acceptable project context sent off-platform.

### DEC-006 - Alpha test cohort

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: HARD-005`<br>
`Evidence: pending`

Recruit 8-20 target users and record their primary tools, experience, genres, browsers, and hardware so validation is not biased toward the implementation team.

### DEC-007 - Ableton exporter ownership route

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: P1-001`<br>
`Evidence: pending`

Choose direct Live Set serialization or a supported partner/integration route. The exporter must still target the oldest Live version that correctly supports the handoff.

## 4. Phase 0: foundations

### FND-001 - Test and development foundation

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: none`<br>
`PRD: 9.1, 10, 14`<br>
`Evidence: pending`

Establish the shared tooling all later agents use: runtime schema validation, browser E2E tests, Firebase Emulator tests, deterministic IDs/time, and fixture builders. Prefer Zod for runtime schemas and Playwright for Chromium, Firefox, and WebKit unless a concrete incompatibility is documented before implementation.

- [ ] Dependencies and Bun scripts are committed without introducing `package-lock.json`.
- [ ] Unit, component, browser, and Firebase Emulator suites have isolated example tests and documented commands.
- [ ] CI runs typecheck, non-mutating formatting/lint checks, unit tests, and the appropriate integration suites.
- [ ] Test helpers provide deterministic clocks, IDs, Firebase setup/teardown, and browser-safe fixture loading.
- [ ] Existing tests still pass, and generated sample work is not needlessly repeated by every test command.

### FND-002 - Canonical schema-v1 domain model

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-001`<br>
`PRD: PRJ-04; 9.4-9.5; Phase 0`<br>
`Evidence: pending`

Replace index-based prototype types with the authoritative code-first TypeScript and runtime schemas for project metadata, song, tracks, clips, placements, events, devices, returns, automation, sections, and assets.

- [ ] Stable branded IDs and integer musical time at a documented PPQ are used for persistent relationships.
- [ ] Parameter definitions share ranges, defaults, units, clamping policy, and automation capability across consumers.
- [ ] Parsing rejects malformed, non-finite, dangling, cross-owner, and future-version state without partial mutation.
- [ ] Deterministic schema-v1 serialization round trips through JSON-compatible values.
- [ ] Factories produce independent valid blank and fixture projects without Firebase types leaking into the domain.
- [ ] Unit and property-oriented tests cover every invariant in PRD section 9.5 and projects at ten-minute bounds.

### FND-003 - Command, transaction, and history kernel

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-002`<br>
`PRD: CLP-04; 8 Undo and redo; 9.6`<br>
`Evidence: pending`

Implement one typed command registry used by pointer UI, shortcuts, and later AI actions, with validation, atomic transactions, summaries, undo, and redo.

- [ ] Initial commands cover the `FND-009` note slice plus generic entity/parameter operations needed by Phase 1.
- [ ] Command execution either yields a valid new revision or makes no change; inverse and redo behavior are deterministic.
- [ ] Gesture and multi-command transactions create one history entry with a human-readable summary.
- [ ] Undo/redo is local, bounded, reset deliberately on project replacement, and does not depend on Firestore snapshots.
- [ ] Every registered command, invalid payload, inverse, transaction rollback, and history edge has unit tests.

### FND-004 - Firebase schema-v1 repository

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-002`<br>
`PRD: PRJ-01, PRJ-02, PRJ-03, PRJ-04; 9.1, 9.9; Phase 0`<br>
`Evidence: pending`

Implement the v1 Firestore document/chunk layout and repository boundary. Prototype `latestSnapshot` documents may be discarded and require no migration.

- [ ] The checked-in mapping documents collection paths, document shapes, ownership, schema version, revision, timestamps, and chunking boundaries in code.
- [ ] Project metadata is queryable without loading full song state; no document can grow indefinitely toward the Firestore size limit.
- [ ] Local/in-memory and Firestore repositories satisfy the same contract tests.
- [ ] Optimistic saves use revision checks, coalesce rapid writes, ignore stale remote echoes, expose save state, and retain retryable local state.
- [ ] Security rules and indexes are checked in; emulator tests cover owner access, anonymous identity, denial, deletion, malformed writes, and cross-project references.
- [ ] Unknown schema versions are rejected without overwrite; a post-v1 migration harness and fixture convention exist.

### FND-005 - Selection and consumer projections

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-002`<br>
`PRD: 9.2-9.3, 9.7-9.8`<br>
`Evidence: pending`

Define stable selection/focus state and read-only projections for editor, audio, arrangement rendering, persistence summaries, and assistant context. UI-only state must not enter persisted song state.

- [ ] Selection supports project, track, clip, placement, event, section, automation point, device, and bar-range scopes by stable ID.
- [ ] Projections expose explicit revision/change information and cannot mutate canonical state.
- [ ] Renaming, selection, scrolling, or assistant conversation does not appear as an audio topology change.
- [ ] Selector tests cover deleted selections, reorder, empty state, large fixtures, and referential stability for unchanged entities.

### FND-006 - Single-context AudioRuntime and diagnostics

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-001`<br>
`PRD: AUD-07, AUD-09; 9.7`<br>
`Evidence: pending`

Replace route/component-owned Tone lifecycle with one application-scoped `AudioRuntime`, explicit ownership/disposal, HMR handoff, and development diagnostics.

- [ ] Only `AudioRuntime` can create, install, resume, suspend, replace, or close the real-time context.
- [ ] Runtime survives compatible navigation/HMR; project graphs dispose without recreating the context.
- [ ] Resource registry tracks owners for contexts, graphs, nodes, schedules, buffers, subscriptions, timers, workers, and pending loads without retaining disposed objects.
- [ ] Disposal is idempotent and safe after partial initialization, cancellation, and failure.
- [ ] Automated lifecycle tests cover fifty HMR replacements and fifty project cycles with baseline counters and no context-limit error.

### FND-007 - Stable ID-keyed audio graph

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-002, FND-005, FND-006`<br>
`PRD: AUD-03, AUD-08; 9.7`<br>
`Evidence: pending`

Implement `ProjectAudioGraph` and track/device factories that reconcile typed domain changes narrowly instead of rebuilding Tone objects from Solid effects.

- [ ] Graph registries key tracks, instruments, devices, returns, schedules, and assets by stable domain IDs.
- [ ] Parameter edits preserve node identity and use smoothing; topology edits affect only the owned subgraph.
- [ ] Buffer cache is keyed by asset ID/revision and cancels stale asynchronous loads deterministically.
- [ ] Scheduling uses musical-time projections and tracked owner handles rather than anonymous global callbacks.
- [ ] Instrumented tests prove stable identities, no unrelated node churn, idempotent teardown, and no stale-load reconnection.

### FND-008 - Arrangement renderer spike and benchmark

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-001`<br>
`PRD: ARR-01; 9.3; Performance budgets`<br>
`Evidence: pending`

Build a disposable but representative hybrid virtualized-DOM/Canvas-2D spike before the production arrangement editor expands.

- [ ] Deterministic fixtures include 20, 40, and 50 tracks, ten-minute arrangements, dense placements, automation, and waveform placeholders.
- [ ] The spike implements viewport culling, layered invalidation, pointer hit testing, wheel/pinch zoom anchoring, and virtualized track headers.
- [ ] Scripted scroll, zoom, seek, and selection traces capture frame time, long tasks, memory, and redraw counts.
- [ ] Results meet PRD budgets on the physical 2019 Intel MacBook Pro in supported browsers or produce an ADR with profiles and next action.
- [ ] Reusable projection/geometry contracts and benchmark fixtures are retained; experimental UI is not treated as production merely because it benchmarks well.

### FND-009 - Foundation vertical slice gate

`Status: todo`<br>
`Owner: unassigned`<br>
`Dependencies: FND-003, FND-004, FND-005, FND-007, FND-008`<br>
`PRD: Phase 0 exit criteria; section 13 dependency order`<br>
`Evidence: pending`

Integrate the new boundaries through the smallest end-to-end musical path: open a schema-v1 project, add one note, play it, undo it, save it, reload it, and reproduce playback.

- [ ] UI and keyboard actions dispatch the same command; no component mutates domain or Firestore data directly.
- [ ] Audible playback uses the stable graph and one shared context.
- [ ] Save state and revision behavior are visible and stale echoes cannot restore the undone note.
- [ ] Unit, repository, component, browser, and audio lifecycle tests cover the slice.
- [ ] Obsolete prototype model/audio paths are removed or isolated so new work cannot import them accidentally.

## 5. Phase 1: complete the loop workflow

Tasks in this phase may proceed in parallel after `FND-009`, subject to their additional dependencies. Coordinate edits to shared registries and fixtures before claiming overlapping work.

### LOOP-001 - Anonymous start and project dashboard

`Status: todo | Owner: unassigned | Dependencies: FND-009, DEC-001`<br>
`PRD: PRJ-01, PRJ-02 | Evidence: pending`

Implement anonymous entry plus create, open, rename, duplicate, and confirmed-delete flows against the v1 repository.

- [ ] Blank and starter creation, independent deep duplication, empty/loading/error states, and last-modified metadata are tested.
- [ ] Anonymous retention and upgrade messaging match `DEC-001`; refresh preserves the session.
- [ ] Dashboard browser tests cover access control and destructive confirmation.

### LOOP-002 - Autosave and recovery UX

`Status: todo | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: PRJ-03 | Evidence: pending`

Complete `Saving`, `Saved`, `Save failed`, retry, navigation flush, and optimistic-conflict behavior.

- [ ] High-frequency gestures coalesce writes without losing final state or blocking playback.
- [ ] Offline/transient failure retains edits and retry is explicit; stale acknowledgements never move controls backward.
- [ ] Fake-timer, repository, and browser navigation tests cover success and failure paths.

### LOOP-003 - Transport, tempo, loop, and metronome

`Status: todo | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: AUD-01, AUD-02, AUD-03, AUD-04 | Evidence: pending`

Implement dependable play/pause/stop/seek, playhead, 40-240 BPM tempo, fixed 4/4 display, bar loop, metronome, master meter, and safety limiter.

- [ ] Scheduling is ahead-of-time and remains aligned across seek, tempo change, repeated loops, and editor load.
- [ ] User-gesture unlock and focus-safe `Space` behavior work in all supported browsers.
- [ ] Master safety and meter tests include silence, extreme chains, and no transport restart on parameter edit.

### LOOP-004 - Synth and one-shot sampler

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-01 | Evidence: pending`

Implement reusable synth and sampler graph/UI slices with presets, audition, pitch, sample start/end, envelopes, oscillator, and resonant filter.

- [ ] Controls dispatch validated commands and parameter changes reuse nodes with safe smoothing.
- [ ] Sample replacement cancels stale loads and preserves compatible clip data through undo/redo.
- [ ] Audio fixtures test parameter extremes, repeated triggers, cache ownership, export compatibility, and disposal.

### LOOP-005 - Drum machine

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-01, CLP-02 | Evidence: pending`

Implement a 16-pad drum machine with per-pad sample, audition, pitch, level, pan, envelope, mute/solo, choke group, named lanes, and hit velocity.

- [ ] Pad and hit IDs survive reorder/duplication and all edits use shared commands.
- [ ] Chokes and multiple simultaneous hits schedule deterministically without leaking short-lived voices.
- [ ] Tests cover mute-wins-solo, choke timing, pad replacement, undo, save/reload, and teardown.

### LOOP-006 - Tempo-aware audio loops

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-02 | Evidence: pending`

Implement loop-track playback and UI that distinguishes tempo-labelled loops from pitched one-shots.

- [ ] Source BPM and bar length validate at ingestion and remain aligned over repeated playback from 40-240 BPM.
- [ ] Seek, loop boundary, tempo change, mute/solo, save/reload, missing asset, and disposal are tested.
- [ ] The chosen alpha stretch behavior and audible limitations are documented honestly in the UI.

### LOOP-007 - Track management and mixer

`Status: todo | Owner: unassigned | Dependencies: LOOP-003`<br>
`PRD: TRK-01, TRK-02 | Evidence: pending`

Implement add, rename, reorder, duplicate, delete, mute, solo, volume, pan, and level meters through commands and stable audio graphs.

- [ ] Deletion warning and deep duplication behavior are explicit; reorder preserves ownership and routing.
- [ ] Multiple solo, mute precedence, perceptual faders, readable values, smoothing, and keyboard access are tested.
- [ ] At least 50 tracks remain correct; metadata-only edits create no audio resources.

### LOOP-008 - Device-chain and routing framework

`Status: todo | Owner: unassigned | Dependencies: LOOP-007`<br>
`PRD: FX-01, FX-02 | Evidence: pending`

Implement typed ordered devices, eight inserts per track, master devices, two stereo returns, sends, bypass/reset/duplicate/reorder, preset provenance, and parameter widgets.

- [ ] Device/routing commands preserve invariants, history, autosave, and stable IDs.
- [ ] Reorder reuses nodes with a measured click-safe reconnection strategy; unrelated graphs retain identity.
- [ ] Extreme but finite ranges remain creative while invalid values and unsafe feedback are rejected.

### LOOP-009 - Core processing devices

`Status: todo | Owner: unassigned | Dependencies: LOOP-008`<br>
`PRD: FX-01, FX-02 | Evidence: pending`

Implement filter/EQ, overdrive, saturation, compression, tempo-sync/free delay, and reverb using the common live/offline device contract.

- [ ] Each required control, wet/dry/output behavior, bypass, reset, duplication, metering, and preset path is present.
- [ ] Parameters smooth without node replacement; duplicate effects and unconventional ordering are supported.
- [ ] Deterministic audio/property tests cover normal and extreme settings, limiter interaction, tails, and disposal.

### LOOP-010 - Step editor

`Status: todo | Owner: unassigned | Dependencies: LOOP-005`<br>
`PRD: CLP-02 | Evidence: pending`

Implement the 1-8 bar 16th-note grid for sampler and drum-machine clips.

- [ ] Paint/erase, velocity, named lanes, beat/bar styling, playback step, selection, and one-gesture history work without text selection.
- [ ] Pointer, keyboard, save/reload, resize, and 8-bar dense-fixture component tests pass.

### LOOP-011 - Piano roll

`Status: todo | Owner: unassigned | Dependencies: LOOP-004`<br>
`PRD: CLP-03 | Evidence: pending`

Implement synth-note create, move, resize, group select, duplicate, delete, velocity, 16th snap, and optional in-key guides.

- [ ] Pointer geometry remains correct under scroll/zoom and every gesture is one undo transaction.
- [ ] Overlap, boundary, multi-select, keyboard, save/reload, and playback-follow tests pass.

### LOOP-012 - Shared musical transformations

`Status: todo | Owner: unassigned | Dependencies: LOOP-010, LOOP-011`<br>
`PRD: CLP-04 | Evidence: pending`

Implement transpose, velocity scale, quantize, duplicate, clear, and seeded rhythmic variation for selection scopes.

- [ ] UI actions call assistant-compatible commands with deterministic summaries and inverses.
- [ ] Boundary clamping, empty selection, mixed event types, seeded output, atomic undo, and redo are tested.

### CNT-001 - Asset manifest and ingestion pipeline

`Status: todo | Owner: unassigned | Dependencies: FND-002`<br>
`PRD: LIB-01; sample-library sections 4, 8, 10 | Evidence: pending`

Implement stable asset manifests, validation, generated indexes, waveform/metadata hooks, provenance, export policy, and missing/corrupt isolation.

- [ ] One-shots, loops, presets, and derived files have stable IDs and required searchable metadata.
- [ ] CI rejects duplicate IDs, absent licences, invalid audio metadata, broken paths, loop seams, and unapproved redistribution policy.
- [ ] Runtime and tests consume generated manifests rather than hand-maintained duplicate lists.

### LOOP-013 - Searchable, sync-audition library browser

`Status: todo | Owner: unassigned | Dependencies: CNT-001, LOOP-003`<br>
`PRD: LIB-01, LIB-02 | Evidence: pending`

Implement search, filters, keyboard navigation, sync-aware audition, insertion, loading/error states, and clean preview teardown.

- [ ] Audition routes through the shared runtime, never enters export, and stops on selection change, close, navigation, or project teardown.
- [ ] Search/filter behavior remains responsive at the planned library size and exposes all content when genre filters clear.
- [ ] Missing/corrupt assets report locally without blocking other results or project playback.

### CNT-002 - Rounded alpha factory library

`Status: todo | Owner: unassigned | Dependencies: CNT-001, DEC-003`<br>
`PRD: LIB-01, LIB-02 | Evidence: pending`

Acquire, commission, normalize, tag, review, and ingest the initial distributable library according to `docs/sample-library.md`.

- [ ] Every asset has auditable source, licence evidence, attribution, and raw/stem/Ableton export policy.
- [ ] Role, character, tempo, key, tuning, loudness, seam, duplicate, and browser-decode audits pass.
- [ ] Library counts and coverage meet the approved sample plan without superficial genre relabelling.

### LOOP-014 - Shortcut registry and mapping guide

`Status: todo | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: KEY-01, KEY-02 | Evidence: pending`

Implement one typed, context-aware shortcut registry powering handlers, menus, tooltips, platform labels, and the searchable `?` guide.

- [ ] PRD mappings and intentional Ableton deviations are encoded once; browser/OS and text-entry conflicts are respected.
- [ ] Focus restore, modal accessibility, layout-aware character matching, disabled actions, and every registered context are tested.

### LOOP-015 - Starter projects and genre templates

`Status: todo | Owner: unassigned | Dependencies: LOOP-001, LOOP-002, LOOP-004, LOOP-005, LOOP-006, LOOP-007, LOOP-008, LOOP-009, LOOP-010, LOOP-011, LOOP-012, LOOP-013, LOOP-014, CNT-002, DEC-002`<br>
`PRD: PRJ-01, LIB-02 | Evidence: pending`

Build Blank plus approved featured starters from normal editable tracks, clips, devices, and licensed assets.

- [ ] Each starter opens audibly with no missing assets, independent IDs, hidden state, or inaccessible backing track.
- [ ] AI-generated variation may diversify instances, but a deterministic validated fallback always exists.
- [ ] Bundled demo projects cover every required genre and pass save, reopen, playback, and asset-policy audits.

### LOOP-016 - Manual loop workflow gate

`Status: todo | Owner: unassigned | Dependencies: LOOP-001, LOOP-002, LOOP-003, LOOP-004, LOOP-005, LOOP-006, LOOP-007, LOOP-008, LOOP-009, LOOP-010, LOOP-011, LOOP-012, LOOP-013, LOOP-014, LOOP-015, CNT-002`<br>
`PRD: Phase 1 exit criteria; Appendix B scenario 1 | Evidence: pending`

Validate that a user can create, edit, process, save, and reopen an original 1-8 bar multi-track loop without AI.

- [ ] The reference journey includes drum machine, synth or sampler, audio loop, device chain, send, mixer, step editor, piano roll, shortcuts, and library audition.
- [ ] All supported-browser E2E tests pass with no leaked audio resources or direct state mutation.
- [ ] Phase 1 PRD requirements have requirement-to-test traceability and no unresolved P0 defects.

## 6. Phase 2: arrangement and export

### ARR-001 - Production arrangement projection and shell

`Status: todo | Owner: unassigned | Dependencies: LOOP-016, FND-008`<br>
`PRD: ARR-01; 9.3 | Evidence: pending`

Turn the proven renderer contracts into the editor shell: virtualized track headers, ruler, scroll/zoom, playhead, selection overlay, layered canvases, accessible DOM controls, and resize/DPR handling.

- [ ] Viewport culling and dirty-layer redraw are proportional to visible work and idle when pixels do not change.
- [ ] Wheel, pinch, keyboard, scrollbar, resize, and playhead-follow behavior remain anchored and synchronized.
- [ ] Canvas interaction has equivalent named DOM actions for critical keyboard/accessibility workflows.

### ARR-002 - Reusable clips and placement editing

`Status: todo | Owner: unassigned | Dependencies: ARR-001`<br>
`PRD: CLP-01, ARR-01 | Evidence: pending`

Implement source clips plus timeline placements with create, select, bar-snap move/resize, loop, linked duplicate, independent variation, copy/cut/paste, delete, range select, seek, and range loop.

- [ ] The UI explicitly distinguishes reuse from independent variation and all gestures are atomic commands.
- [ ] Playback and persistence reflect visible edits immediately without index identity or audio-graph rebuilds.
- [ ] Geometry/hit-test tests cover overlap, edges, zoom extremes, offscreen culling, and ten-minute bounds.

### ARR-003 - Sections and loop-to-song workflow

`Status: todo | Owner: unassigned | Dependencies: ARR-002`<br>
`PRD: ARR-02, ARR-03 | Evidence: pending`

Implement add/rename/resize/color/reorder section markers and an editable manual loop-to-song outline action.

- [ ] Section reorder moves contained placements without hidden audio and is one undoable transaction.
- [ ] Outline creation uses linked or copied clips explicitly, is immediately playable, and undoes atomically.
- [ ] Boundary collisions, partial ranges, automation movement hooks, and save/reload are tested.

### ARR-004 - Focused breakpoint automation

`Status: todo | Owner: unassigned | Dependencies: ARR-003, LOOP-009`<br>
`PRD: ARR-04 | Evidence: pending`

Implement one visible lane per track for volume, pan, send, and supported device parameters with stepped/linear points.

- [ ] Add/move/delete, target switch, copy range, section reorder, selection, and one-gesture undo work in musical time.
- [ ] Live playback, seek, loop, and offline projection reproduce parameter values without boundary discontinuities.
- [ ] Automated controls are visibly distinct and safe manual adjustment behavior is defined and tested.

### ARR-005 - Arrangement performance and duration gate

`Status: todo | Owner: unassigned | Dependencies: ARR-001, ARR-002, ARR-003, ARR-004`<br>
`PRD: ARR-01; 9.3; Performance budgets | Evidence: pending`

Profile and optimize the production arrangement using deterministic 20/40/50-track ten-minute fixtures.

- [ ] PRD frame, input, long-task, load, memory, and visible-object scaling targets pass on the physical baseline device in four supported browsers.
- [ ] Waveform peak pyramids, caches, culling, and invalidation have bounded memory and deterministic eviction.
- [ ] Performance evidence is checked in; a WebGL proposal is forbidden unless the required measured-failure ADR is produced.

### EXP-001 - Shared offline audio renderer

`Status: todo | Owner: unassigned | Dependencies: ARR-004, LOOP-009`<br>
`PRD: AUD-05, AUD-06; 9.7 | Evidence: pending`

Build cancellable offline scheduling from the same project and device projections as live playback, without replacing the real-time Tone context.

- [ ] Notes, clips, tempo, automation, inserts, sends, master path, and release/effect tails match documented live behavior.
- [ ] Success, cancellation, and failure release all offline resources and cannot mutate project or live playback.
- [ ] Deterministic reference renders test timing, duration, tails, alignment, and live/offline parameter parity.

### EXP-002 - Stereo WAV export

`Status: todo | Owner: unassigned | Dependencies: EXP-001, DEC-004`<br>
`PRD: AUD-05, SHR-01 | Evidence: pending`

Implement full-arrangement stereo WAV export with progress, cancellation, safe file naming, and the approved gain/normalization policy.

- [ ] Duration includes release tails without drift or truncation; format metadata is valid and documented.
- [ ] The 40-track ten-minute processed fixture renders within browser memory limits on supported hardware.
- [ ] Error/cancel paths never present a partial file as successful or disturb live playback.

### EXP-003 - Aligned stem package

`Status: todo | Owner: unassigned | Dependencies: EXP-001, DEC-004`<br>
`PRD: AUD-06, SHR-01 | Evidence: pending`

Implement selectable 16/24-bit stem export with one aligned WAV per track, separate returns, reference mix, manifest, deterministic naming/order, and ZIP packaging.

- [ ] Track stems include source, inserts, automation, fader, and pan but exclude master processing; mute/solo policy matches the PRD.
- [ ] All stems share sample rate, format, bar-1 origin, padded tail duration, and sample alignment.
- [ ] Progress, cancellation, worker/memory limits, asset policies, and recoverable failures are tested with the maximum reference fixture.

### REL-001 - Arrangement and export gate

`Status: todo | Owner: unassigned | Dependencies: ARR-005, EXP-002, EXP-003`<br>
`PRD: Phase 2 exit criteria; Appendix B scenarios 2 and 4 | Evidence: pending`

Validate manual creation of a two-to-ten-minute arrangement and import of its stems into an independent DAW/audio alignment harness.

- [ ] Playback, save/reopen, stereo render, and stems agree on arrangement bounds and musical events.
- [ ] Supported-browser reference runs show no skipped events, drift, missing tracks, clipped tails, leaks, or memory failure.
- [ ] Every P0 arrangement/export requirement maps to an automated test or named physical-device test procedure.

## 7. Phase 3: AI producer

### AI-001 - Provider-independent server gateway

`Status: todo | Owner: unassigned | Dependencies: REL-001, DEC-005`<br>
`PRD: AI-01, AI-06; 9.8 | Evidence: pending`

Implement the Firebase Functions boundary for authenticated model calls, streaming, prompt versions, quotas, timeout, retry, cancellation, minimized logging, and response validation.

- [ ] Provider credentials and objects never ship to the client or enter domain state.
- [ ] Emulator/contract tests cover auth, quota, timeout, malformed stream, cancellation, provider error, and redacted telemetry.

### AI-002 - Compact project analysis and suggestions

`Status: todo | Owner: unassigned | Dependencies: REL-001`<br>
`PRD: AI-01, AI-02, AI-05 | Evidence: pending`

Build deterministic compact summaries of project structure, selection, notes, register, density, repetition, mixer/device state, and recent actions plus context-derived next steps.

- [ ] Summaries are bounded for 40-track ten-minute projects and exclude unnecessary account or raw persistence data.
- [ ] Missing context is explicit; suggestions are scoped and never block free-form conversation.
- [ ] Fixture tests assert facts/invariants rather than brittle prose.

### AI-003 - Assistant tool schema and proposal executor

`Status: todo | Owner: unassigned | Dependencies: AI-001, AI-002`<br>
`PRD: AI-03, AI-05, AI-06; Appendix A | Evidence: pending`

Expose an allowlisted, versioned subset of shared commands to the model and implement validate/diff/apply/cancel/stale-revision behavior.

- [ ] Invalid IDs, ranges, combinations, unknown tools, and stale revisions make no change.
- [ ] Valid multi-command proposals summarize impact, apply atomically as one history entry, and undo exactly.
- [ ] Every Appendix A command family has schema, authorization, invariant, malformed-response, and round-trip tests.

### AI-004 - Assistant conversation and proposal UI

`Status: todo | Owner: unassigned | Dependencies: AI-003`<br>
`PRD: AI-01, AI-02, AI-03, AI-04, AI-06, LRN-01 | Evidence: pending`

Implement streaming conversation, scope indicator, suggestions, proposal cards, visible diff, apply/cancel, post-action selection/highlight, undo, errors, and concise expandable explanations.

- [ ] Conversation remains responsive during playback and manual editing remains available during provider failure.
- [ ] Focus, keyboard, screen-reader announcements, cancellation, retry, stale proposal, and follow-up control highlighting are tested.
- [ ] Explanations link audible goal, accurate technique, and actual changed controls without mandatory lessons.

### AI-005 - Alpha musical capability evaluations

`Status: todo | Owner: unassigned | Dependencies: AI-004`<br>
`PRD: AI-05; Appendix B scenarios 3 and 5 | Evidence: pending`

Build prompts, deterministic analysis helpers, and evaluation fixtures for loop sketching, variation, arrangement, transitions, processing, automation, balancing, and intentionally experimental requests.

- [ ] Drum, bass, chord, melody, and texture output uses editable events and bundled sources, never generated audio.
- [ ] Evaluation checks validity, editability, scope, atomic undo, explanation grounding, and musical diversity rather than exact notes.
- [ ] Conventional and extreme requests are distinguished without silently forcing genre conventions.

### REL-002 - AI producer gate

`Status: todo | Owner: unassigned | Dependencies: AI-005`<br>
`PRD: Phase 3 exit criteria | Evidence: pending`

Run the full AI evaluation and failure matrix against stable manual commands.

- [ ] Reference loops become valid editable outlines and one undo restores byte-equivalent canonical song state.
- [ ] Malformed, stale, cancelled, timed-out, rate-limited, and provider-failed requests never mutate the project.
- [ ] Context size, latency, usage, error categories, and proposal acceptance are observable within approved privacy rules.

## 8. Phase 4: private-alpha hardening

### HARD-001 - Cross-browser compatibility suite

`Status: todo | Owner: unassigned | Dependencies: REL-002`<br>
`PRD: Supported environment; section 14 | Evidence: pending`

Expand Playwright and physical-browser procedures across current/previous Firefox, Chrome, Edge, and Safari for every core journey.

- [ ] Capability fallbacks, audio unlock, decoding, shortcuts, downloads, Canvas/DPR, Firebase, and failure states are covered.
- [ ] Unsupported capability messages are actionable; browser regressions block release unless product-approved fallback exists.

### HARD-002 - Accessibility and resilient layout pass

`Status: todo | Owner: unassigned | Dependencies: REL-002`<br>
`PRD: section 8; Responsive behavior | Evidence: pending`

Audit and fix full keyboard operation, focus, semantics, names, contrast, reduced motion, 200% zoom, screen-reader announcements, and minimum editor dimensions.

- [ ] Critical Canvas actions have accessible DOM equivalents and focus is never stranded by panels or dialogs.
- [ ] Automated checks and manual keyboard/screen-reader scripts cover dashboard, editor, guide, assistant, and export.

### HARD-003 - Security, privacy, reliability, and telemetry

`Status: todo | Owner: unassigned | Dependencies: REL-002, DEC-001, DEC-005`<br>
`PRD: 10, 11, 14 | Evidence: pending`

Complete rule audits, validation, quotas, deletion/retention, CSP/secrets review, crash/save/audio-start instrumentation, recovery UX, and privacy-safe product metrics.

- [ ] Security emulator tests and abuse cases cover all public backend surfaces and asset access.
- [ ] Crash, save failure, audio start failure, export result, AI failure, and leak signals are actionable without recording project content.
- [ ] Anonymous retention/deletion and AI data handling match product decisions and user-facing disclosures.

### HARD-004 - Content and template release audit

`Status: todo | Owner: unassigned | Dependencies: LOOP-015, REL-001`<br>
`PRD: LIB-01, LIB-02; docs/sample-library.md | Evidence: pending`

Run final provenance, duplicate, loudness, tuning, loop, missing-file, decode, search, demo, stem, and export audits.

- [ ] Every required genre demo opens, plays, saves, renders, and exports without missing/unlicensed assets.
- [ ] Removing an asset from discovery cannot corrupt existing fixture projects; manifest/export policies remain traceable.

### HARD-005 - Target-user validation and fixes

`Status: todo | Owner: unassigned | Dependencies: HARD-001, HARD-002, HARD-003, HARD-004, DEC-006`<br>
`PRD: Success measures; Phase 4 | Evidence: pending`

Run facilitated loop-to-track sessions with the target cohort, categorize blockers against PRD success measures, fix release-blocking issues, and document residual risks.

- [ ] At least five representative users complete the qualitative validation exercise; the broader cohort is scheduled or completed.
- [ ] Findings distinguish product confusion, missing capability, reliability, performance, and taste/content issues.
- [ ] Release-blocking findings have regression tests or explicit product-owner disposition.

### REL-003 - Private-alpha release gate

`Status: todo | Owner: unassigned | Dependencies: HARD-005`<br>
`PRD: all P0 requirements; Phase 4 exit criteria | Evidence: pending`

Produce the traceability matrix and release report for every P0 acceptance criterion, supported browser, reference scenario, security control, and performance/reliability budget.

- [ ] All P0 criteria are evidenced, deferred explicitly by the product owner, or block release.
- [ ] Production configuration, Firebase rules/indexes/functions, monitoring, rollback, and incident ownership are verified.
- [ ] No open critical/high defect, unexplained resource leak, save-loss path, or unlicensed asset remains.

## 9. Parked post-alpha backlog

These tasks are intentionally brief until `REL-003` is `done`. Before claiming one, the product owner changes it from `parked` to `todo`, confirms acceptance criteria in the PRD, and splits it if needed.

### P1-001 - Ableton format and compatibility spike

`Status: parked | Owner: unassigned | Dependencies: REL-003, DEC-007`<br>
`PRD: SHR-02 | Evidence: pending`

Determine the oldest correctly supported Live version, serialization route, legal/technical constraints, supported editable mappings, fallback policy, and fixture test matrix.

### P1-002 - Self-contained Ableton Live export

`Status: parked | Owner: unassigned | Dependencies: P1-001`<br>
`PRD: SHR-02; Phase 5 | Evidence: pending`

Build the portable Live Set package, copied assets, editable MIDI/automation mappings, rendered fallback stems, compatibility report, and tested reference projects.

### P1-003 - Named revisions and read-only sharing

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: PRJ-05, SHR-03 | Evidence: pending`

Add named checkpoints, safe restore, published immutable revisions, revocable links, permissions, and privacy-safe playback.

### P1-004 - Asynchronous collaboration

`Status: parked | Owner: unassigned | Dependencies: P1-003`<br>
`PRD: SHR-04 | Evidence: pending`

Add collaborator invitations, permissions, attribution, conflict behavior, and revision history without promising simultaneous editing.

### P1-005 - User audio imports

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: LIB-03 | Evidence: pending`

Add browser-decodable upload, validation, quotas, progress, Storage security, metadata analysis, project references, and deletion semantics.

### P1-006 - Preview, learning cues, and shortcut customization

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: AI-07, LRN-02, KEY-02 | Evidence: pending`

Evaluate non-destructive proposal preview, optional contextual learning cues, and persisted remappable shortcuts without weakening P0 diff/apply/undo behavior.

### P2-001 - Real-time collaboration discovery

`Status: parked | Owner: unassigned | Dependencies: P1-004`<br>
`PRD: SHR-05 | Evidence: pending`

Research presence, simultaneous command ordering, conflict resolution, audio asset coordination, offline rejoin, and cost before committing to an architecture or delivery task.

## 10. Completion log

Add one row only when a release gate is completed. Individual task completion remains recorded in its task block and Git history.

| Date | Gate | Evidence | Approved by |
| --- | --- | --- | --- |
| - | - | - | - |
