# Solid Groove implementation backlog

| Field | Value |
| --- | --- |
| Status | Active planning document |
| Product requirements | [`docs/prd.md`](./prd.md) |
| Content plan | [`docs/sample-library.md`](./sample-library.md) |
| Scope | Private alpha P0, followed by explicitly parked P1/P2 work |

## 1. How agents use this backlog

This file is the **specification and index** for implementation order: what each task covers, what it depends on, which PRD requirements it satisfies, and what "done" means for it. The PRD remains authoritative for product behavior and acceptance criteria. A task does not weaken or replace any linked PRD requirement.

This file is **not** the live status board. Task blocks below are not edited to record progress.

### Tracking: one GitHub issue per task

Every task from Alpha Milestone 1 onwards, plus every section 3 product decision, has one GitHub issue in `afternoon/solid-groove`, titled with the task ID (for example `LOOP-003 - Transport, tempo, loop, and metronome`). The issue is the live record. The index below is the mapping.

**Alpha Milestone 0's completed tasks predate this convention and have no issues.** `FND-001` through `FND-008` and `CNT-000` were built and landed against the task blocks in this file and its PR history, which is why those blocks carry no `Status`/`Owner`/`Evidence`. Do not create issues for them retroactively — git history is their completion record. The three Alpha Milestone 0 tasks still in flight when the convention was adopted — `FND-002b`, `CNT-000b`, and `FND-009` — do have issues, as does `OPS-001`, which carries Alpha Milestone 0's four deferred hosted-verification criteria.

- **Status** is the issue's state and labels: open/closed, plus `blocked`, `needs-review`, or `parked` where they apply. `parked` tasks in section 9 get an issue only when the product owner unparks them.
- **Ownership** is the issue assignee. An agent picking up a task assigns itself before changing product code.
- **Progress, blockers, and discoveries** are issue comments. A blocker names the unmet dependency or decision, what was tried, and the smallest action that would unblock it. A cross-task discovery goes in a comment on the affected task's issue, or becomes a new issue — never a silent scope expansion.
- **Evidence** — the test commands that were run and the paths to durable artifacts — goes in the closing comment and in the PR description.
- The task's acceptance checkboxes are copied into the issue body when it is created, and are ticked there rather than in this file.

Alpha Milestone 0 task blocks have had their `Status`, `Owner`, and `Evidence` fields removed accordingly. The section 3 decision blocks, later-milestone blocks, and parked blocks still carry them; **those in-file fields are now historical and the issue governs.** Where a block says `Status: todo | Owner: unassigned | Evidence: pending`, read the issue instead. `Dependencies` and `PRD` stay on every block — they are the work graph and the requirement trace, not status.

This removes the write contention that made the old in-file claim protocol unworkable: parallel agents never edit a shared Markdown file to announce themselves, and the record survives a bad merge.

#### Issue index

| Task | Issue | Task | Issue | Task | Issue |
| --- | --- | --- | --- | --- | --- |
| `FND-002b` | [#81](https://github.com/afternoon/solid-groove/issues/81) | `CNT-000b` | [#82](https://github.com/afternoon/solid-groove/issues/82) | `FND-009` | [#83](https://github.com/afternoon/solid-groove/issues/83) |
| `DEC-001` | [#30](https://github.com/afternoon/solid-groove/issues/30) | `LOOP-005` | [#45](https://github.com/afternoon/solid-groove/issues/45) | `ARR-005` | [#63](https://github.com/afternoon/solid-groove/issues/63) |
| `DEC-002` | [#31](https://github.com/afternoon/solid-groove/issues/31) | `LOOP-006` | [#46](https://github.com/afternoon/solid-groove/issues/46) | `EXP-001` | [#64](https://github.com/afternoon/solid-groove/issues/64) |
| `DEC-003` | [#32](https://github.com/afternoon/solid-groove/issues/32) | `LOOP-007` | [#47](https://github.com/afternoon/solid-groove/issues/47) | `EXP-002` | [#65](https://github.com/afternoon/solid-groove/issues/65) |
| `DEC-004` | [#33](https://github.com/afternoon/solid-groove/issues/33) | `LOOP-008` | [#48](https://github.com/afternoon/solid-groove/issues/48) | `EXP-003` | [#66](https://github.com/afternoon/solid-groove/issues/66) |
| `DEC-005` | [#34](https://github.com/afternoon/solid-groove/issues/34) | `LOOP-009` | [#49](https://github.com/afternoon/solid-groove/issues/49) | `REL-001` | [#67](https://github.com/afternoon/solid-groove/issues/67) |
| `DEC-006` | [#35](https://github.com/afternoon/solid-groove/issues/35) | `LOOP-010` | [#50](https://github.com/afternoon/solid-groove/issues/50) | `OPS-001` | [#68](https://github.com/afternoon/solid-groove/issues/68) |
| `DEC-007` | [#36](https://github.com/afternoon/solid-groove/issues/36) | `LOOP-011` | [#51](https://github.com/afternoon/solid-groove/issues/51) | `AI-001` | [#69](https://github.com/afternoon/solid-groove/issues/69) |
| `DEC-008` | [#37](https://github.com/afternoon/solid-groove/issues/37) | `LOOP-012` | [#52](https://github.com/afternoon/solid-groove/issues/52) | `AI-002` | [#70](https://github.com/afternoon/solid-groove/issues/70) |
| `DEC-009` | [#38](https://github.com/afternoon/solid-groove/issues/38) | `CNT-001` | [#53](https://github.com/afternoon/solid-groove/issues/53) | `AI-003` | [#71](https://github.com/afternoon/solid-groove/issues/71) |
| `DEC-010` | [#39](https://github.com/afternoon/solid-groove/issues/39) | `LOOP-013` | [#54](https://github.com/afternoon/solid-groove/issues/54) | `AI-004` | [#72](https://github.com/afternoon/solid-groove/issues/72) |
| `LOOP-001` | [#40](https://github.com/afternoon/solid-groove/issues/40) | `CNT-002` | [#55](https://github.com/afternoon/solid-groove/issues/55) | `AI-005` | [#73](https://github.com/afternoon/solid-groove/issues/73) |
| `LOOP-001b` | [#41](https://github.com/afternoon/solid-groove/issues/41) | `LOOP-014` | [#56](https://github.com/afternoon/solid-groove/issues/56) | `REL-002` | [#74](https://github.com/afternoon/solid-groove/issues/74) |
| `LOOP-002` | [#42](https://github.com/afternoon/solid-groove/issues/42) | `LOOP-015` | [#57](https://github.com/afternoon/solid-groove/issues/57) | `HARD-001` | [#75](https://github.com/afternoon/solid-groove/issues/75) |
| `LOOP-003` | [#43](https://github.com/afternoon/solid-groove/issues/43) | `LOOP-016` | [#58](https://github.com/afternoon/solid-groove/issues/58) | `HARD-002` | [#76](https://github.com/afternoon/solid-groove/issues/76) |
| `LOOP-004` | [#44](https://github.com/afternoon/solid-groove/issues/44) | `ARR-001` | [#59](https://github.com/afternoon/solid-groove/issues/59) | `HARD-003` | [#77](https://github.com/afternoon/solid-groove/issues/77) |
| `AI-006` | [#95](https://github.com/afternoon/solid-groove/issues/95) | `ARR-002` | [#60](https://github.com/afternoon/solid-groove/issues/60) | `HARD-004` | [#78](https://github.com/afternoon/solid-groove/issues/78) |
| | | `ARR-003` | [#61](https://github.com/afternoon/solid-groove/issues/61) | `HARD-005` | [#79](https://github.com/afternoon/solid-groove/issues/79) |
| | | `ARR-004` | [#62](https://github.com/afternoon/solid-groove/issues/62) | `REL-003` | [#80](https://github.com/afternoon/solid-groove/issues/80) |

Labels in use: `alpha-milestone-0`…`alpha-milestone-4` for scheduling, `decision` for section 3, `blocked` where an undecided `DEC-*` gates the task, `contract` for a task that owns or changes a published contract, `gate` for the `FND-009`/`LOOP-016`/`REL-001`/`REL-002`/`REL-003` release gates, and `operator` for `OPS-001`, which needs real credentials and must never be claimed by an implementation agent.

Some issues carry `blocked` because a product decision is genuinely unmade, not because the work is hard: `CNT-002` (`DEC-003`, `DEC-010`), `LOOP-015` (`DEC-002`), `EXP-002`/`EXP-003` (`DEC-004`), `AI-001` (`DEC-005`), `HARD-003` (`DEC-005`, `DEC-009`), and `HARD-005` (`DEC-006`). An agent on one of these implements what does not depend on the decision and reports the rest — it never guesses the decision. (`DEC-001` is now decided — recorded in PRD section 16 — which unblocked `LOOP-001` and removes it and that part of `HARD-003` from this list.)

### Landing work

1. **One PR per task**, branched off the active feature branch, each agent working in its own git worktree so parallel implementations do not collide on the filesystem. A broken task never blocks review of an unrelated one.
2. Keep the change vertical and self-contained: product code, tests, fixtures, and documentation for that task in one PR. The PR body links its issue and states the evidence.
3. Do not claim a task until every dependency is closed, unless the task explicitly permits parallel discovery work.
4. A **contract-owning task lands before its dependents start.** Domain schema, command registry, parameter definitions, persistence layout, selection, audio projection, and rendering projection are contracts; an agent must not alter a published one as incidental feature work. Changing a landed contract is its own issue, updating every contract test and consumer together.
5. Git history is the completion record. Do not put a commit hash into the commit itself.
6. Do not preserve compatibility with prototype project data. Schema v1 is the first production schema; migrations are required only for persisted changes after v1 is established.

### Fanning out

The `Dependencies:` line on every task is the machine-readable work graph. An orchestrator topologically sorts it, holds live in-flight state during a run, and opens or updates the GitHub issues; implementation agents receive a single task and never need to read another agent's state. The release gates in section 2 are the synchronization points — everything inside a gate may run concurrently, and nothing crosses a gate until it closes.

That graph is mirrored onto GitHub as issue dependencies ("blocked by") by `bun run issues:deps`, so the board shows what is actionable without anyone recomputing it. It goes through the GitHub CLI, so `gh auth login` is the only setup and no token is handled directly. This file stays the source of truth: edit the `Dependencies:` line, then re-run the script. It is idempotent and dry-run by default — `--apply` writes, `--prune` also removes edges the backlog no longer declares. Alpha Milestone 0 tasks that landed before the one-issue-per-task convention have no issue to point at, so edges touching them are reported as skipped rather than created.

### Definition of done for every task

- The task's linked PRD acceptance criteria pass, including failure and empty states relevant to the slice.
- New behavior is reachable through shared commands and boundaries rather than a feature-specific mutation path.
- Tests fail before the implementation and pass afterward at the lowest useful layer.
- `bun run typecheck`, `bun run test`, and `bun run check` pass. Tasks that touch browser, Firebase, audio, performance, or export behavior also run their task-specific suites.
- Resource ownership, accessibility, supported-browser behavior, and persistence effects have been considered and tested where applicable.
- **Analytics ships with the feature.** From `FND-001c` onward, any task that adds or changes a user action emits its PRD OPS-02 events through the shared typed analytics catalog, plus the reliability event for its principal failure path, with tests that the event fires once per action and that disabling analytics changes nothing. A task whose events are left for later is not done. A user action the catalog does not yet cover extends the catalog in the same PR — at minimum a `feature_first_use` key — rather than shipping unmeasured, and no task introduces an ad-hoc event string outside the catalog.
- No event or error-report parameter carries a project, track, clip, section, or asset name, assistant text, a user-entered string, an asset URL, or a token.
- The slice has been exercised against a production-like build in the gating browsers through its browser E2E and emulator suites, not only against a local dev server. Hosted-environment verification is **not** a per-task gate: it is batched into `OPS-001` after Alpha Milestone 2 (PRD section 12, "After Alpha Milestone 2"). A task does not stay open waiting for a hosted environment that does not exist yet, and equally does not claim a deploy, smoke test, rollback, or delivered event that never happened.
- No unrelated formatting, dependency, generated-file, or refactor churn is included.

## 2. Release gates and parallelism

| Gate | Opens when | Work unlocked |
| --- | --- | --- |
| G0: Tooling ready | `FND-001` done | Deployment, code-first contracts, and independent architecture spikes |
| G0.5: Deploy and analytics contracts published | `FND-001b` and `FND-001c` done | Every later task instruments itself through the published analytics catalog and ships through the committed deploy pipeline |
| G4.5: Hosted environment verified | `OPS-001` done | Alpha Milestone 3 assistant work, and the `HARD-005` cohort invitation, on instrumentation known to work |
| G1: Contracts published | `FND-002` through `FND-005`, including `FND-002b`, done | Audio, renderer, content, and thin-slice integration |
| G2: Foundation slice proven | `FND-009` done | Broad Alpha Milestone 1 loop-workflow parallelism |
| G3: Manual loop complete | `LOOP-016` done | Arrangement, automation, and export expansion |
| G4: Arrangement/export complete | `REL-001` done | AI integration against stable commands |
| G5: AI complete | `REL-002` done | Private-alpha hardening and user validation |
| G6: Private alpha ready | `REL-003` done | P1 work may be unparked by the product owner |

Only `FND-001` starts immediately. After it lands, `FND-001b`, `FND-002`, `FND-006`, and `FND-008` may proceed in parallel because they own separate code boundaries. `CNT-000` joins them once `FND-001b` closes: it produces the real audio every later slice is tested against, owns only `scripts/` and the Storage configuration, and touches no domain, command, or audio boundary, so it never blocks and is never blocked by the contract tasks. `FND-001b` is claimed first among them: it is small, it unblocks nothing structurally, but it settles how the product ships before anything is built on top of it. `FND-001c` follows `FND-001b` and publishes the analytics catalog contract that every Alpha Milestone 1-4 feature task extends. Neither provisions an account or holds a credential; the operator pass that verifies both against a live hosted environment is `OPS-001`, after Alpha Milestone 2, so no Alpha Milestone 0-2 task is gated on a hosted environment existing. `FND-003` through `FND-005` depend on the canonical domain schema. `FND-002b` adds packs to that schema and is a contract change in its own right, so it lands inside G1 rather than as incidental work in a later content or browser task; `CNT-000b` follows it and `CNT-000` to put the shipped library on packs. Both are Alpha Milestone 0 because the alternative is migrating saved asset references later. Broad feature parallelism begins only after `FND-009` proves the contracts together.

## 3. Product decisions

Decision tasks are owned by the product owner, not guessed by implementation agents. A downstream implementation task becomes `blocked` if its required decision is not `done` by the time the task is otherwise ready.

### DEC-001 - Anonymous project retention

`Status: done`<br>
`Owner: product-owner`<br>
`Needed by: LOOP-001`<br>
`Evidence: PRD section 16 (180-day retention, cross-device pairing)`

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

### DEC-008 - Tutorial video curation and embed policy

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: P2-002`<br>
`Evidence: pending`

Decide the trusted-creator/source allowlist and how a creator or video enters it, the acceptable video provider and embedding surface, and the data-sharing and privacy terms for loading external video. Post-alpha; do not let an implementation default choose product behavior.

### DEC-009 - Analytics consent and retention policy

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: LOOP-001b, HARD-003`<br>
`Evidence: pending`

Decide whether product analytics are on by default with an opt-out or require opt-in, what the user-facing disclosure says, how long event and error data are retained, and any regional constraints. The disclosure covers two processors — Google Analytics for product events and Sentry for error monitoring ([ADR 0001](./adr/0001-sentry-for-error-monitoring.md)) — and a regional constraint Sentry's SaaS regions cannot meet would reopen the self-hosting option that ADR rejected. `FND-001c` builds the opt-out mechanism and the disclosure hook regardless; this decision sets the default state and the wording. It does not block `FND-001c`, and it must be settled before the cohort is invited in `HARD-005`.

### DEC-010 - Shipped pack list and marketplace posture

`Status: todo`<br>
`Owner: product-owner`<br>
`Needed by: CNT-002, P2-003`<br>
`Evidence: pending`

Approve the factory packs the alpha ships — each pack's name, scope, and coverage claim — against what `DEC-003` has actually cleared. The proposal in `docs/sample-library.md` section 6.5 is a starting point, not a commitment; a pack that cannot meet its coverage claim is merged or dropped rather than shipped thin.

Separately, record the intended posture on the `LIB-05` marketplace: whether Solid Groove intends users to publish and sell packs at all, and if so, what rights, revenue-sharing, and moderation model applies. The posture question does not block any alpha task — it exists so the alpha's pack model is not quietly built toward a business decision nobody has made. It must be answered before `P2-003` is unparked.

## 4. Alpha Milestone 0: foundations

### FND-001 - Test and development foundation

`Dependencies: none`<br>
`PRD: 9.1, 10, 14`

Establish the shared tooling all later agents use: runtime schema validation, browser E2E tests, Firebase Emulator tests, deterministic IDs/time, and fixture builders. Prefer Zod for runtime schemas and Playwright for Chromium, Firefox, and WebKit unless a concrete incompatibility is documented before implementation.

This task owns its own infrastructure. It creates `.github/workflows` for CI and adds the missing `emulators` block to `firebase.json`, whose current `database.rules.json` reference points at a file that does not exist and must be either supplied or removed.

- [ ] Dependencies and Bun scripts are committed without introducing `package-lock.json`.
- [ ] A non-mutating `check:ci` script exists. The current `check` runs `biome check --write`, which cannot be used as a CI gate; `check` may keep its auto-fix behavior for local use.
- [ ] Unit, component, browser, and Firebase Emulator suites have isolated example tests and documented commands. `firebase.json` gains a working emulator configuration and its dangling `database.rules.json` reference is resolved.
- [ ] CI workflows run typecheck, `check:ci`, unit tests, and the appropriate integration suites on Chromium and Firefox as gating browsers, with WebKit run as a non-gating signal per the PRD supported-environment policy.
- [ ] Test helpers provide deterministic clocks, deterministic prefixed IDs matching the PRD section 9.4 format, Firebase setup/teardown, and browser-safe fixture loading.
- [ ] Existing tests still pass, and generated sample work is not needlessly repeated by every test command.

### FND-001b - Firebase deployment and hosted alpha environment

`Dependencies: FND-001`<br>
`PRD: OPS-01; 9.1; 10 Security and privacy`

Deploy the application to Firebase Hosting, from CI, before the rest of Alpha Milestone 0 is built on top of it. Everything after this task is expected to be checked in a real browser against real Firebase services rather than only against the dev server and the emulator suite.

The alpha's only hosted environment is the **production** Firebase project — a deliberate decision recorded in PRD section 16, not an omission. Nothing here permits exposing an incomplete journey: the deployed alpha is reachable only to people given the URL and an account, and unfinished work stays behind feature flags.

This task claims the deploy pipeline. It extends the `FND-001` CI workflows rather than creating a competing one, and it owns `firebase.json` hosting configuration, the deploy job, and the release-stamping mechanism.

- [ ] `bun run build` output deploys to Firebase Hosting through one documented command and automatically from CI on merge to the default branch, using credentials held in CI rather than on a developer machine.
- [ ] Firestore rules and indexes deploy from the same pipeline as the application; a failing rules or index step fails the deploy instead of shipping code that its deployed rules do not match.
- [ ] The build stamps the git commit SHA into the client, the app can display it, and it is available to the `FND-001c` analytics and error events. The pipeline has a place for `FND-001c` to add its release registration and source-map upload without restructuring the deploy job.
- [ ] A post-deploy smoke test against the hosted URL is written and wired into the deploy job so a failure fails the deploy, covering app load, anonymous session start, project open, and audio start after a user gesture. **Running it against a real hosted URL is `OPS-001`, after Alpha Milestone 2.**
- [ ] Rollback to the previous Hosting release and its matching rules revision is documented in a runbook precise enough to follow under incident conditions. **Performing the drill is `OPS-001`, after Alpha Milestone 2.**
- [ ] No secret, provider credential, or privileged configuration reaches the client bundle; a check fails the build if one does.
- [ ] Unit, component, browser, and emulator suites still run without access to the production project and do not write to it.
- [ ] Team traffic is marked so internal sessions can be excluded from the PRD section 11 measures.
- [ ] `.env.example`, `README.md`, and `docs/testing.md` describe the deploy, the single-environment decision, and how to get a local build talking to the right project.

### FND-001c - Analytics and error-monitoring foundation

`Dependencies: FND-001b`<br>
`PRD: OPS-02, OPS-03; 11; 14 Feature definition of done; ADR 0001`

Build the typed analytics catalog, the logging boundary, and the error-reporting path that every later task uses. This task owns the contract; it does not instrument other tasks' features. Each Alpha Milestone 1-4 feature task ships its own events through this boundary as part of its definition of done.

Error monitoring uses Sentry via `@sentry/solidstart`, per [ADR 0001](./adr/0001-sentry-for-error-monitoring.md). The SDK sits *behind* this task's reporting boundary: application code calls the boundary, never the SDK, so the platform stays replaceable. Pin the SDK version — the SolidStart package is beta.

This is a **contract-owning task**: it lands before Alpha Milestone 1 fans out, and changing the published catalog shape later is its own issue.

- [ ] One typed catalog module declares every PRD OPS-02 event, its parameters, and their allowed values or buckets. Event and parameter strings appear nowhere else, and logging an unregistered event or parameter is a type error.
- [ ] The logging boundary attaches the release SHA, surface, and account-type user property automatically, and callers cannot pass free text where an enum or bucket is required.
- [ ] Alpha Milestone 0 events are emitted and proven by automated tests: `app_opened`, `first_edit`, `feature_first_use`, `save_failed`, `audio_start_failed`, and `exception`. Later-milestone events exist in the catalog as declarations without call sites. **Verifying these arrive from a deployed build is `OPS-001`, after Alpha Milestone 2.**
- [ ] Global `error`/`unhandledrejection` handlers and Solid error boundaries report an error once, with release SHA, browser and engine version, area, stable error code, and redacted message, through one application-owned reporting boundary that fans out to the GA4 `exception` counter event and to Sentry. Application code cannot reach the Sentry SDK directly. Duplicate reports from one error collapse; a failing or blocked reporter cannot stop the transport, block editing, lose unsaved state, or recurse.
- [ ] Fatal and non-fatal errors are distinguishable, and crash-free session rate comes from Sentry release-health session tracking rather than a hand-built derivation.
- [ ] Sentry is configured for a product whose value is the user's private music: `sendDefaultPii` off, console breadcrumbs disabled rather than filtered, network and DOM breadcrumbs scrubbed in `beforeSend`/`beforeBreadcrumb`, and **Session Replay not enabled** — turning it on needs a superseding ADR.
- [ ] Source maps are produced for the deployed revision, uploaded to Sentry through an authenticated channel from the `FND-001b` pipeline, and never served publicly from Hosting.
- [ ] The SDK initializes lazily after first paint with a minimal integration set, is not loaded on the marketing landing page, and its bundle cost is measured against the PRD section 10 interactive budget rather than assumed acceptable.
- [ ] A test rejects any event or error parameter carrying a project, track, clip, section, or asset name, assistant text, a user-entered string, a URL, or a token. It runs over the whole catalog **and over the Sentry payload by exercising the scrubbing functions directly**, so it also covers events and breadcrumbs added by later tasks.
- [ ] A test runs the core journey with both the analytics and error transports failing and asserts no behavioral difference; a user-facing opt-out disables collection without disabling any product capability. `DEC-009` sets the default state and disclosure wording and does not block this task.
- [ ] `docs/testing.md` documents how to verify events and errors against a deployed build, precisely enough to be executed by someone who did not write it. **Showing a deliberately triggered error arriving in Sentry with its release SHA and a symbolicated stack trace is `OPS-001`, after Alpha Milestone 2.**
- [ ] The Sentry DSN, auth token, and org/project configuration are handled as deploy configuration: the auth token lives in CI only, and the client DSN is documented as a public-by-design value rather than a secret.

### FND-002 - Canonical schema-v1 domain model

`Dependencies: FND-001`<br>
`PRD: PRJ-04; 9.4-9.5; Alpha Milestone 0`

Replace index-based prototype types with the authoritative code-first TypeScript and runtime schemas for project metadata, song, tracks, clips, placements, events, devices, returns, automation, sections, and assets.

This task owns the domain contract. It lands before `FND-003`, `FND-004`, `FND-005`, and `FND-007` start.

- [ ] Branded IDs use the PRD section 9.4 prefixed nanoid format (`trk_`, `clp_`, `evt_`, …), produced by one shared factory with a deterministic seeded variant for tests.
- [ ] Musical time is integer ticks at 192 PPQ, with conversion helpers for bars/beats/16ths and seconds, and no floating-point musical time in persistent state.
- [ ] The parameter-definition mechanism is implemented — range, unit, default, clamping policy, and automation capability declared once and read by UI, command validation, audio, and assistant tools. Only the parameters the `FND-009` slice needs are defined; per-device instrument and effect values are authored in Alpha Milestone 1 and must not be invented here.
- [ ] Parsing rejects malformed, non-finite, dangling, cross-owner, and future-version state without partial mutation.
- [ ] Deterministic schema-v1 serialization round trips through JSON-compatible values.
- [ ] Factories produce independent valid blank and fixture projects without Firebase types leaking into the domain.
- [ ] Unit and property-oriented tests cover every invariant in PRD section 9.5 and projects at ten-minute bounds.

### FND-002b - Packs and pack-qualified asset identity

`Dependencies: FND-002`<br>
`PRD: LIB-04; 9.4-9.5 (invariant 12); 9.9; Alpha Milestone 0`

Add the `Pack` entity and pack-qualified asset identity to schema v1, and record a project's pack dependencies in its metadata tier.

This is a **contract change** to a landed contract (`FND-002`), which is why it is its own task rather than incidental work inside a content or browser task. It is scheduled in Alpha Milestone 0 for one reason: after Alpha Milestone 0 there are saved projects whose asset references would need migrating, and the PRD makes moving from a flat content namespace to packs an alpha decision precisely to pay that cost once, while it is still nearly free.

Scope is the model, not the experience. Browsing by pack is `LOOP-013`, packing the shipped library is `CNT-000b`, and the marketplace is `P2-003`. Nothing here implies installation, entitlement, or purchase: the alpha's packs are all bundled factory packs, and the only per-project state is which packs and versions the project depends on.

- [ ] The `Pack` entity carries a `pak_`-prefixed ID, name, version, publisher, kind (`factory`, `user`, `third-party`), description, and one rights position, and is registered in the shared ID factory and its seeded test variant.
- [ ] Every asset reference names its owning pack and the pack version it resolved from. Parsing rejects an asset with no pack, an unknown pack, or a pack version the project does not declare.
- [ ] A project's pack dependency list is derived from project state rather than maintained by hand, is recomputed inside the same transaction that adds or removes the last reference to a pack, and is asserted to stay consistent across command, undo, and redo paths.
- [ ] The dependency list is persisted in the `projects/{projectId}` metadata tier so the dashboard and export can read it without loading song state or clip content, and the repository contract tests cover it in both implementations.
- [ ] PRD invariant 12 has unit and property-oriented tests, including an unavailable pack producing a reported missing-pack state — naming affected tracks and clips — rather than a dangling reference, a thrown parse error, or a silent substitution.
- [ ] Domain fixtures, factories, and the reference projects carry packs; a fixture project spanning two packs exists, because single-pack fixtures cannot catch a pack-qualification bug.
- [ ] `docs/persistence.md` and the domain documentation state the pack model and where a pack dependency lives.

### FND-003 - Command, transaction, and history kernel

`Dependencies: FND-002`<br>
`PRD: CLP-04; 8 Undo and redo; 9.6`

Implement one typed command registry used by pointer UI, shortcuts, and later AI actions, with validation, atomic transactions, summaries, undo, and redo.

- [ ] Initial commands cover the `FND-009` note slice plus generic entity/parameter operations needed by Alpha Milestone 1.
- [ ] Command execution either yields a valid new revision or makes no change; inverse and redo behavior are deterministic.
- [ ] Gesture and multi-command transactions create one history entry with a human-readable summary.
- [ ] Undo/redo is local, bounded, reset deliberately on project replacement, and does not depend on Firestore snapshots.
- [ ] Every registered command, invalid payload, inverse, transaction rollback, and history edge has unit tests.

### FND-004 - Firebase schema-v1 repository

`Dependencies: FND-002`<br>
`PRD: PRJ-01, PRJ-02, PRJ-03, PRJ-04; 9.1, 9.9; Alpha Milestone 0`

Implement the PRD section 9.9 three-tier Firestore layout and the repository boundary: `projects/{projectId}` metadata, `projects/{projectId}/song/current`, and `projects/{projectId}/clips/{clipId}`. Prototype `latestSnapshot` documents may be discarded and require no migration.

- [ ] The checked-in mapping documents collection paths, document shapes, ownership, schema version, revision, and timestamps in code, matching the section 9.9 tiers.
- [ ] The song document has a documented size budget asserted against the 50-track ten-minute reference fixture, and the per-track `arrangement/{trackId}` chunk overflow path is implemented and tested rather than left as a described intention. This task owns the exact budget and chunk boundary.
- [ ] Project metadata is queryable for the dashboard without loading song state or clip content; note edits write one clip document rather than rewriting song structure.
- [ ] Local/in-memory and Firestore repositories satisfy the same contract tests.
- [ ] Optimistic saves use revision checks, coalesce rapid writes, ignore stale remote echoes, expose save state, and retain retryable local state.
- [ ] Security rules and indexes are checked in; emulator tests cover owner access, anonymous identity, denial, deletion, malformed writes, and cross-project references.
- [ ] Unknown schema versions are rejected without overwrite; a post-v1 migration harness and fixture convention exist.

### FND-005 - Selection and consumer projections

`Dependencies: FND-002`<br>
`PRD: 9.2-9.3, 9.7-9.8`

Define stable selection/focus state and read-only projections for editor, audio, arrangement rendering, persistence summaries, and assistant context. UI-only state must not enter persisted song state.

- [ ] Selection supports project, track, clip, placement, event, section, automation point, device, and bar-range scopes by stable ID.
- [ ] Projections expose explicit revision/change information and cannot mutate canonical state.
- [ ] Renaming, selection, scrolling, or assistant conversation does not appear as an audio topology change.
- [ ] Selector tests cover deleted selections, reorder, empty state, large fixtures, and referential stability for unchanged entities.

### FND-006 - Single-context AudioRuntime and diagnostics

`Dependencies: FND-001`<br>
`PRD: AUD-07, AUD-09; 9.7`

Replace route/component-owned Tone lifecycle with one application-scoped `AudioRuntime`, explicit ownership/disposal, HMR handoff, and development diagnostics.

- [ ] Only `AudioRuntime` can create, install, resume, suspend, replace, or close the real-time context.
- [ ] Runtime survives compatible navigation/HMR; project graphs dispose without recreating the context.
- [ ] Resource registry tracks owners for contexts, graphs, nodes, schedules, buffers, subscriptions, timers, workers, and pending loads without retaining disposed objects.
- [ ] Disposal is idempotent and safe after partial initialization, cancellation, and failure.
- [ ] Automated lifecycle tests cover fifty HMR replacements and fifty project cycles with baseline counters and no context-limit error.

### FND-007 - Stable ID-keyed audio graph

`Dependencies: FND-002, FND-005, FND-006`<br>
`PRD: AUD-03, AUD-08; 9.7`

Implement `ProjectAudioGraph` and track/device factories that reconcile typed domain changes narrowly instead of rebuilding Tone objects from Solid effects.

- [ ] Graph registries key tracks, instruments, devices, returns, schedules, and assets by stable domain IDs.
- [ ] Parameter edits preserve node identity and use smoothing; topology edits affect only the owned subgraph.
- [ ] Buffer cache is keyed by asset ID/revision and cancels stale asynchronous loads deterministically.
- [ ] Scheduling uses musical-time projections and tracked owner handles rather than anonymous global callbacks.
- [ ] Instrumented tests prove stable identities, no unrelated node churn, idempotent teardown, and no stale-load reconnection.

### FND-008 - Arrangement renderer spike and measurement harness

`Dependencies: FND-001`<br>
`PRD: ARR-01; 9.3 including "When these budgets are enforced"; Performance budgets`

Build a disposable but representative hybrid virtualized-DOM/Canvas-2D spike, and the measurement infrastructure that Alpha Milestone 2 will enforce budgets with, before the production arrangement editor expands.

**This task is not gated on hitting the PRD frame budgets, and not gated on the physical baseline device.** Budgets bind at `ARR-005` and `HARD-001`. What Alpha Milestone 0 owes is fixtures, traces, a working harness, and honest recorded numbers.

- [ ] Deterministic fixtures include 20, 40, and 50 tracks, ten-minute arrangements, dense placements, automation, and waveform placeholders.
- [ ] The spike implements viewport culling, layered invalidation, pointer hit testing, wheel/pinch zoom anchoring, and virtualized track headers.
- [ ] Scripted scroll, zoom, seek, and selection traces capture frame time, long tasks, memory, and redraw counts, and are runnable by a single documented command.
- [ ] Baseline numbers are checked in together with the hardware, browser, and browser version that produced them. Results are not described as meeting or missing a budget when they were not measured on the baseline device.
- [ ] Reusable projection/geometry contracts and benchmark fixtures are retained and stay renderer-agnostic; experimental UI is not treated as production merely because it benchmarks well.

### CNT-000 - Starter library of sounds for testing

`Dependencies: FND-001b`<br>
`PRD: LIB-00; LIB-01; LIB-02; sample-library sections 3, 5, 6, 9, 10, 12`

Ship a real, playable library of at least 200 one-shots and publish it to Cloud Storage, so every task after this one is built and tested against real audio and real metadata instead of the two prototype WAV files in `public/samples`.

This is the **testing** library, not the factory library. `CNT-001` owns the production ingestion pipeline and `CNT-002` owns the curated, musically reviewed content; this task is what stops both of them from being a prerequisite for building the browser, sampler, drum machine, caching, and export at all.

It depends on `FND-001b` for the Firebase project and CI credentials, and on nothing else — it touches no domain type, command, or audio boundary, so it may run in parallel with the whole of `FND-002` onwards.

Content comes from two routes, and both are in scope. **Synthesis** by this repository is the baseline: it needs no counterparty, runs offline, and is reproducible byte-for-byte, so the library always builds. **Acquisition** covers the section 4.1 and 4.2 sources whose licence permits redistributing raw files, and is the only way to reach the section 6.4 organic-source floor.

Acquisition is a review workflow, not a download button. Every file is declared in an approved-source registry, selected individually, pinned to a checksum by a named reviewer, and verified on every fetch. An agent must not add a crawl mode, a search-API mode, or any bulk import: section 4.2 forbids importing search results blindly, and a tool that can do it will eventually be used to do it. Model-generated audio is out of scope entirely (PRD section 5 non-goals).

- [ ] One documented command generates the library and manifest; a second publishes both to Cloud Storage. Publishing works from CI credentials and needs no production key on a developer machine.
- [ ] Acquired CC0 content flows through the same manifest, validator, delivery layout, and uploader as generated content, differing only in its provenance record. The build works with nothing acquired, so CI never depends on a third-party host being up.
- [ ] Nothing is fetched that is not declared in the source registry and pinned in a committed lockfile with a named reviewer. A checksum mismatch, an unapproved licence, or acquired audio claiming to be synthesized fails validation. Each source's licence statement is captured and committed at fetch time, and a failed capture blocks ingest.
- [ ] Generation is deterministic — identical audio bytes and an identical manifest across runs and machines — so a no-op rebuild uploads nothing and produces no diff.
- [ ] Every one-shot role in the sample-plan taxonomy is covered, every genre in `LIB-02` has usable material across at least three families, and the section 6.4 experimental and dry-material floors are met.
- [ ] Every asset carries a stable prefixed ID, content-addressed storage key, checksum, role and tags from the controlled vocabulary, audio metadata, waveform peaks, licence with archived evidence, and a reproducible generation recipe. Validation fails CI on any missing or invalid field, on a duplicate ID or name, on byte-identical assets, and on a name carrying third-party branding.
- [ ] The manifest declares this as the testing tier and records the honest intake state; nothing is marked `approved` without human musical review, and these counts do not satisfy the section 6.1 milestones.
- [ ] Storage rules deny all client writes, factory content is publicly readable, and no other path is reachable. Objects are served with content types, immutable cache headers for content-addressed assets, and CORS allowing Web Audio decoding, range requests, and offline export.
- [ ] Validation runs in CI, and the upload path has been exercised end to end against the Firebase Storage emulator with evidence of idempotency on a second run.
- [ ] `docs/sample-library.md`, `docs/testing.md`, `README.md`, and `.env.example` document the commands, the bucket layout, the credentials, and the fact that this library is superseded rather than extended by `CNT-002`.

This task shipped before the pack model existed, so its library is one flat collection. `CNT-000b` moves it onto packs; the acceptance criteria above are not reopened by that change.

### CNT-000b - Deliver the starter library as packs

`Dependencies: CNT-000, FND-002b`<br>
`PRD: LIB-04; LIB-00; sample-library sections 5.1, 6.5, 9, 12, 15.7`

Move the shipped starter library from one flat collection onto the pack model: pack membership in the catalogue, one manifest per pack plus a pack index, pack rules in the validator, and a delivery layout with a pack dimension.

Scheduled in Alpha Milestone 0 alongside `FND-002b` and for the same reason — the manifest, the delivery layout, and every saved asset reference change shape, and doing it before Alpha Milestone 1 means no project exists yet to migrate. It touches `scripts/` and the Storage layout only.

Splitting the catalogue does not promote it: these assets stay testing content at the `metadata-review` intake state, `CNT-002` still supersedes them, and the section 6.1 milestone counts are still not satisfied by them.

- [ ] Every catalogue entry declares exactly one pack. The synthesized 200 split along the families and genre tags they already carry, into a small number of packs that each meet their own coverage claim; a pack that would ship thin is merged rather than published.
- [ ] The build emits one manifest per pack plus a pack index, in the `docs/sample-library.md` section 15.7 delivery layout. Audio storage keys are unchanged — identity is still the SHA-256 of the bytes — so identical audio in two packs is one object and a repack re-uploads no audio.
- [ ] Asset IDs stay stable across the repack, or the change is called out explicitly with what it breaks. Group numbering remains append-only and `catalog.test.mjs` still pins it.
- [ ] The validator gains the section 9 pack rules: exactly one pack per asset, no asset licence exceeding its pack's rights position, no undefined pack referenced, and every pack delivering the roles and genres its coverage claim advertises. Each new rule fails CI on a fixture that violates it.
- [ ] Determinism is preserved: identical audio bytes, identical manifests, identical pack index across runs and machines, so a no-op rebuild uploads nothing and produces no diff.
- [ ] Acquired CC0 content records its destination pack in the lockfile at pin time, and ingest checks each asset against its pack's rights position.
- [ ] Cache headers match the mutability of each object: immutable for content-addressed audio and versioned pack manifests, short-lived for the pack index and per-pack `latest` pointers.
- [ ] The upload path is exercised end to end against the Firebase Storage emulator, with evidence that a second run is idempotent and that a single changed pack re-uploads only that pack's manifest.
- [ ] `docs/sample-library.md`, `docs/testing.md`, and `README.md` describe the pack layout and the commands as they actually behave afterwards.

### FND-009 - Foundation vertical slice gate

`Dependencies: FND-001c, FND-002b, FND-003, FND-004, FND-005, FND-007, FND-008`<br>
`PRD: Alpha Milestone 0 exit criteria; section 13 dependency order`

Integrate the new boundaries through the smallest end-to-end musical path: open a schema-v1 project, add one note, play it, undo it, save it, reload it, and reproduce playback.

The slice's surface is a **16-step grid on a sampler track** — the cheapest UI that still exercises the real UI-to-command-to-audio-to-persistence path, and closest to what the prototype already has. The full step editor is `LOOP-010` and the piano roll is `LOOP-011`; neither is built here, and this grid is expected to be replaced by `LOOP-010` rather than grown into it.

- [ ] UI and keyboard actions dispatch the same command; no component mutates domain or Firestore data directly.
- [ ] The slice's sampler asset resolves through its pack, and the reopened project reports the same pack dependency it saved. The slice proves the pack-qualified reference path end to end; browsing by pack is `LOOP-013`.
- [ ] Audible playback uses the stable graph and one shared context.
- [ ] Save state and revision behavior are visible and stale echoes cannot restore the undone note.
- [ ] Unit, repository, component, browser, and audio lifecycle tests cover the slice.
- [ ] The slice emits `first_edit` and the `step_editor` `feature_first_use` key through the `FND-001c` catalog, alongside its `app_opened`, `save_failed`, and `audio_start_failed` paths, each proven by an automated test. **Observing them from the deployed build is `OPS-001`, after Alpha Milestone 2.**
- [ ] The whole slice — add a note, play it, undo it, save it, reload it — is exercised by a browser E2E test against the emulator suite in the gating browsers. **Exercising it on the hosted environment is `OPS-001`, after Alpha Milestone 2.**
- [ ] Obsolete prototype model/audio paths are removed or isolated so new work cannot import them accidentally.

## 5. Alpha Milestone 1: complete the loop workflow

Tasks in this milestone may proceed in parallel after `FND-009`, subject to their additional dependencies. Coordinate edits to shared registries and fixtures before claiming overlapping work.

### LOOP-001 - Anonymous start and project dashboard

`Status: done | Owner: unassigned | Dependencies: FND-009, DEC-001`<br>
`PRD: PRJ-01, PRJ-02, OPS-02 | Evidence: #96`

Implement anonymous entry plus create, open, rename, duplicate, and confirmed-delete flows against the v1 repository.

- [x] Blank and starter creation, independent deep duplication, empty/loading/error states, and last-modified metadata are tested.
- [x] Anonymous retention (180 days from last access, reset on access) matches `DEC-001`; refresh preserves the session.
- [x] Each device locally records which anonymous projects were created or edited there; authenticating on that device offers to pair those local records to the account, and a paired project's local record is deleted. A device shared by multiple people is not reconciled — the authenticating user is offered whatever anonymous projects were edited on that device (`DEC-001`).
- [x] Dashboard browser tests cover access control and destructive confirmation.
- [x] Emits `anon_session_created`, `account_upgraded`, `project_created` (with `source`, `template_id`, `genre`), `project_opened` (with `project_age_bucket`, `track_count_bucket`, `is_first_open`), and `project_deleted`. `project_opened` is what makes the 1- and 7-day reopen measure computable, so its parameters are not optional.

### LOOP-001b - Public landing page

`Status: todo | Owner: unassigned | Dependencies: LOOP-001`<br>
`PRD: PRJ-06, OPS-02 | Evidence: pending`

Implement the public marketing landing page as an honest front door into the anonymous-start flow.

- [ ] The page states the product promise, the browser-based/no-install nature, supported browsers, and the honest private-alpha status without advertising unshipped capabilities.
- [ ] A primary call to action starts a playable project via the PRJ-01 anonymous-start flow with no account; a secondary path leads existing users to log in.
- [ ] The page follows the editor's visual language and passes the alpha accessibility and marketing-page performance expectations; tour/pricing/richer marketing content may be staged.
- [ ] Emits `landing_cta_click` with a `cta_id` distinguishing the start-free and log-in paths, and carries the analytics disclosure and opt-out surface from `FND-001c` per `DEC-009`.

### LOOP-002 - Autosave and recovery UX

`Status: done | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: PRJ-03 | Evidence: #97`

Complete `Saving`, `Saved`, `Save failed`, retry, navigation flush, and optimistic-conflict behavior.

- [x] High-frequency gestures coalesce writes without losing final state or blocking playback.
- [x] Offline/transient failure retains edits and retry is explicit; stale acknowledgements never move controls backward.
- [x] Fake-timer, repository, and browser navigation tests cover success and failure paths.
- [x] Emits `save_failed` with an actionable `error_code` and `retry_count`, `save_recovered` on successful retry, and `undo_used` with `direction` and `actor`. Coalesced writes emit one event per failure episode, not one per attempt.

### LOOP-003 - Transport, tempo, loop, and metronome

`Status: todo | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: AUD-01, AUD-02, AUD-03, AUD-04 | Evidence: pending`

Implement dependable play/pause/stop/seek, playhead, 40-240 BPM tempo, fixed 4/4 display, bar loop, metronome, master meter, and safety limiter.

- [ ] Scheduling is ahead-of-time and remains aligned across seek, tempo change, repeated loops, and editor load.
- [ ] User-gesture unlock and focus-safe `Space` behavior work in all supported browsers.
- [ ] Master safety and meter tests include silence, extreme chains, and no transport restart on parameter edit.
- [ ] Emits `transport_play` (with `surface` and `is_first_play_in_session`), `audio_start_failed` with a browser-blocked flag when the context cannot unlock, and sampled `audio_underrun` events with the sampling rate recorded. Playback emits nothing per scheduled event or animation frame.

### LOOP-004 - Synth and one-shot sampler

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-01 | Evidence: pending`

Implement reusable synth and sampler graph/UI slices with presets, audition, pitch, sample start/end, envelopes, oscillator, and resonant filter.

- [ ] Controls dispatch validated commands and parameter changes reuse nodes with safe smoothing.
- [ ] Sample replacement cancels stale loads and preserves compatible clip data through undo/redo.
- [ ] Audio fixtures test parameter extremes, repeated triggers, cache ownership, export compatibility, and disposal.
- [ ] Emits `instrument_changed` with `instrument_type` and the `synth` and `sampler` `feature_first_use` keys. Continuous parameter gestures emit nothing per tick.

### LOOP-005 - Drum machine

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-01, CLP-02 | Evidence: pending`

Implement a 16-pad drum machine with per-pad sample, audition, pitch, level, pan, envelope, mute/solo, choke group, named lanes, and hit velocity.

- [ ] Pad and hit IDs survive reorder/duplication and all edits use shared commands.
- [ ] Chokes and multiple simultaneous hits schedule deterministically without leaking short-lived voices.
- [ ] Tests cover mute-wins-solo, choke timing, pad replacement, undo, save/reload, and teardown.
- [ ] Emits `instrument_changed` on pad sample replacement and the `drum_machine` `feature_first_use` key.

### LOOP-006 - Tempo-aware audio loops

`Status: todo | Owner: unassigned | Dependencies: LOOP-003, CNT-001`<br>
`PRD: INS-02 | Evidence: pending`

Implement loop-track playback and UI that distinguishes tempo-labelled loops from pitched one-shots.

- [ ] Source BPM and bar length validate at ingestion and remain aligned over repeated playback from 40-240 BPM.
- [ ] Seek, loop boundary, tempo change, mute/solo, save/reload, missing asset, and disposal are tested.
- [ ] The chosen alpha stretch behavior and audible limitations are documented honestly in the UI.
- [ ] Emits the `audio_loop` `feature_first_use` key and `asset_load_failed` for a missing or undecodable loop.

### LOOP-007 - Track management and mixer

`Status: todo | Owner: unassigned | Dependencies: LOOP-003`<br>
`PRD: TRK-01, TRK-02 | Evidence: pending`

Implement add, rename, reorder, duplicate, delete, mute, solo, volume, pan, and level meters through commands and stable audio graphs.

- [ ] Deletion warning and deep duplication behavior are explicit; reorder preserves ownership and routing.
- [ ] Multiple solo, mute precedence, perceptual faders, readable values, smoothing, and keyboard access are tested.
- [ ] At least 50 tracks remain correct; metadata-only edits create no audio resources.
- [ ] Emits `track_added` with `track_type` and the `mixer` `feature_first_use` key. Fader and pan drags emit one event per gesture at most, never per pointer move.

### LOOP-008 - Device-chain and routing framework

`Status: todo | Owner: unassigned | Dependencies: LOOP-007`<br>
`PRD: FX-01, FX-02 | Evidence: pending`

Implement typed ordered devices, eight inserts per track, master devices, two stereo returns, sends, bypass/reset/duplicate/reorder, preset provenance, and parameter widgets.

- [ ] Device/routing commands preserve invariants, history, autosave, and stable IDs.
- [ ] Reorder reuses nodes with a measured click-safe reconnection strategy; unrelated graphs retain identity.
- [ ] Extreme but finite ranges remain creative while invalid values and unsafe feedback are rejected.
- [ ] Emits `device_added` with `device_type` and `chain` (insert, return, or master), plus the `device_chain` and `send_return` `feature_first_use` keys.

### LOOP-009 - Core processing devices

`Status: todo | Owner: unassigned | Dependencies: LOOP-008`<br>
`PRD: FX-01, FX-02 | Evidence: pending`

Implement filter/EQ, overdrive, saturation, compression, tempo-sync/free delay, and reverb using the common live/offline device contract.

- [ ] Each required control, wet/dry/output behavior, bypass, reset, duplication, metering, and preset path is present.
- [ ] Parameters smooth without node replacement; duplicate effects and unconventional ordering are supported.
- [ ] Deterministic audio/property tests cover normal and extreme settings, limiter interaction, tails, and disposal.
- [ ] Each device type is a registered `device_type` value in the analytics catalog, so `device_added` reports which processing users reach for first.

### LOOP-010 - Step editor

`Status: todo | Owner: unassigned | Dependencies: LOOP-005`<br>
`PRD: CLP-02 | Evidence: pending`

Implement the 1-8 bar 16th-note grid for sampler and drum-machine clips.

- [ ] Paint/erase, velocity, named lanes, beat/bar styling, playback step, selection, and one-gesture history work without text selection.
- [ ] Pointer, keyboard, save/reload, resize, and 8-bar dense-fixture component tests pass.
- [ ] Emits `clip_edited` with `editor: step` and an `event_count_bucket`, once per completed paint or erase gesture rather than per step toggled, plus the `step_editor` `feature_first_use` key.

### LOOP-011 - Piano roll

`Status: todo | Owner: unassigned | Dependencies: LOOP-004`<br>
`PRD: CLP-03 | Evidence: pending`

Implement synth-note create, move, resize, group select, duplicate, delete, velocity, 16th snap, and optional in-key guides.

- [ ] Pointer geometry remains correct under scroll/zoom and every gesture is one undo transaction.
- [ ] Overlap, boundary, multi-select, keyboard, save/reload, and playback-follow tests pass.
- [ ] Emits `clip_edited` with `editor: piano_roll` and an `event_count_bucket`, once per completed gesture, plus the `piano_roll` `feature_first_use` key.

### LOOP-012 - Shared musical transformations

`Status: todo | Owner: unassigned | Dependencies: LOOP-010, LOOP-011`<br>
`PRD: CLP-04 | Evidence: pending`

Implement transpose, velocity scale, quantize, duplicate, clear, and seeded rhythmic variation for selection scopes.

- [ ] UI actions call assistant-compatible commands with deterministic summaries and inverses.
- [ ] Boundary clamping, empty selection, mixed event types, seeded output, atomic undo, and redo are tested.

### CNT-001 - Asset manifest and ingestion pipeline

`Status: todo | Owner: unassigned | Dependencies: FND-002b, CNT-000b`<br>
`PRD: LIB-01, LIB-04; sample-library sections 4, 5.1, 8, 10 | Evidence: pending`

Implement stable asset manifests, validation, generated indexes, waveform/metadata hooks, provenance, export policy, and missing/corrupt isolation.

`CNT-000` already ships a manifest schema, validator, content-addressed delivery, and provenance for the synthesized starter library, and `CNT-000b` puts both on the pack model. This task generalizes that pipeline to acquired content — per-asset licence evidence, quarantine and intake states, loops with verified BPM/bar/seam metadata, presets, and multisample instruments — rather than starting a second one beside it.

- [ ] One-shots, loops, presets, and derived files have stable IDs, an owning pack, and required searchable metadata.
- [ ] CI rejects duplicate IDs, absent licences, invalid audio metadata, broken paths, loop seams, unapproved redistribution policy, and an asset whose licence exceeds its pack's rights position.
- [ ] Pack records, per-pack manifests, and the pack index are produced by the same pipeline for acquired content as for synthesized content, and a pack that misses its coverage claim fails validation.
- [ ] Runtime and tests consume generated manifests rather than hand-maintained duplicate lists.

### LOOP-013 - Searchable, sync-audition library browser

`Status: todo | Owner: unassigned | Dependencies: CNT-001, LOOP-003`<br>
`PRD: LIB-01, LIB-02, LIB-04 | Evidence: pending`

Implement pack-organized browsing, search, filters, keyboard navigation, sync-aware audition, insertion, loading/error states, and clean preview teardown.

- [ ] Packs are a first-class way in: a user can browse one pack's contents as a coherent set, see what it is for, and start from it without knowing the taxonomy.
- [ ] Search, genre, role, and character filters work across every available pack as well as within one, and clearing a pack filter never hides an asset the user could otherwise reach.
- [ ] Pack manifests load lazily — opening the browser fetches the pack index, not every pack's metadata — and the sample-plan section 12 metadata budgets are asserted.
- [ ] Audition routes through the shared runtime, never enters export, and stops on selection change, close, navigation, or project teardown.
- [ ] Search/filter behavior remains responsive at the planned library size and exposes all content when genre filters clear.
- [ ] Missing/corrupt assets report locally without blocking other results or project playback; an entire unavailable pack degrades the same way and names the affected tracks and clips.
- [ ] Emits `library_audition` with `asset_type`, `had_genre_filter`, and a stable `pack_id`, `asset_load_failed` with `asset_type` and `error_code`, and the `library_browser` `feature_first_use` key. Search terms and pack display names are never logged.

### CNT-002 - Rounded alpha factory library

`Status: todo | Owner: unassigned | Dependencies: CNT-001, DEC-003, DEC-010`<br>
`PRD: LIB-01, LIB-02, LIB-04 | Evidence: pending`

Acquire, commission, normalize, tag, review, and ingest the initial distributable library according to `docs/sample-library.md`, delivered as the factory packs `DEC-010` approves.

This **supersedes** the `CNT-000` starter library rather than extending it. Starter assets are testing content at the `metadata-review` intake state; they are promoted only by passing the same section 11 musical review as everything else, and the ones that do not pass are retired. Replacing them must not change how the app resolves, caches, or exports an asset.

- [ ] Every asset has auditable source, licence evidence, attribution, and raw/stem/Ableton export policy.
- [ ] Role, character, tempo, key, tuning, loudness, seam, duplicate, and browser-decode audits pass.
- [ ] Library counts and coverage meet the approved sample plan without superficial genre relabelling.
- [ ] The section 6.4 organic and recorded-source floor is met with real recorded or commissioned material — the gap `CNT-000` reports and cannot close by synthesis.
- [ ] Every starter asset is either promoted through musical review or deprecated, and deprecating one does not break a project that already references it.
- [ ] Every shipped pack meets its approved coverage claim, states what it does not contain, and can build a usable idea for its stated purpose on its own. A pack that would ship thin is merged or dropped rather than published.
- [ ] Each pack's rights position covers every asset in it, and no genre in `LIB-02` is left unservable by the approved pack set.

### LOOP-014 - Shortcut registry and mapping guide

`Status: todo | Owner: unassigned | Dependencies: FND-009`<br>
`PRD: KEY-01, KEY-02 | Evidence: pending`

Implement one typed, context-aware shortcut registry powering handlers, menus, tooltips, platform labels, and the searchable `?` guide.

- [ ] PRD mappings and intentional Ableton deviations are encoded once; browser/OS and text-entry conflicts are respected.
- [ ] Focus restore, modal accessibility, layout-aware character matching, disabled actions, and every registered context are tested.
- [ ] Emits `shortcut_used` with `action_id` from the registry itself rather than from each handler, plus the `shortcut_guide` `feature_first_use` key when the `?` guide is first opened.

### LOOP-015 - Starter projects and genre templates

`Status: todo | Owner: unassigned | Dependencies: LOOP-001, LOOP-002, LOOP-004, LOOP-005, LOOP-006, LOOP-007, LOOP-008, LOOP-009, LOOP-010, LOOP-011, LOOP-012, LOOP-013, LOOP-014, CNT-002, DEC-002`<br>
`PRD: PRJ-01, LIB-02 | Evidence: pending`

Build Blank plus approved featured starters from normal editable tracks, clips, devices, and licensed assets.

- [ ] Each starter opens audibly with no missing assets, independent IDs, hidden state, or inaccessible backing track.
- [ ] Each starter names the packs it draws from, ships with them, and records them as the new project's pack dependencies.
- [ ] AI-generated variation may diversify instances, but a deterministic validated fallback always exists.
- [ ] Bundled demo projects cover every required genre and pass save, reopen, playback, and asset-policy audits.
- [ ] Every starter reports a stable `template_id` and `genre` through `project_created`, so template choice is comparable across the cohort.

### LOOP-016 - Manual loop workflow gate

`Status: todo | Owner: unassigned | Dependencies: LOOP-001, LOOP-001b, LOOP-002, LOOP-003, LOOP-004, LOOP-005, LOOP-006, LOOP-007, LOOP-008, LOOP-009, LOOP-010, LOOP-011, LOOP-012, LOOP-013, LOOP-014, LOOP-015, CNT-002`<br>
`PRD: Alpha Milestone 1 exit criteria; Appendix B scenario 1 | Evidence: pending`

Validate that a user can create, edit, process, save, and reopen an original 1-8 bar multi-track loop without AI.

- [ ] The reference journey includes drum machine, synth or sampler, audio loop, device chain, send, mixer, step editor, piano roll, shortcuts, and library audition.
- [ ] All supported-browser E2E tests pass with no leaked audio resources or direct state mutation.
- [ ] Alpha Milestone 1 PRD requirements have requirement-to-test traceability and no unresolved P0 defects.
- [ ] Every Alpha Milestone 1 event in the PRD OPS-02 catalog has a call site exercised during the reference journey and proven by an automated test; no Alpha Milestone 1 event is still declaration-only. **Observing them from the deployed build is `OPS-001`, after Alpha Milestone 2.**

## 6. Alpha Milestone 2: arrangement and export

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
- [ ] Emits `section_created` with `origin`, `arrangement_outline_created` with `template_id` and `section_count`, the `sections` `feature_first_use` key, and `arrangement_milestone` the first time a project reaches at least three named sections and two minutes. `arrangement_milestone` is the PRD section 11 primary measure and fires once per project.

### ARR-004 - Focused breakpoint automation

`Status: todo | Owner: unassigned | Dependencies: ARR-003, LOOP-009`<br>
`PRD: ARR-04 | Evidence: pending`

Implement one visible lane per track for volume, pan, send, and supported device parameters with stepped/linear points.

- [ ] Add/move/delete, target switch, copy range, section reorder, selection, and one-gesture undo work in musical time.
- [ ] Live playback, seek, loop, and offline projection reproduce parameter values without boundary discontinuities.
- [ ] Automated controls are visibly distinct and safe manual adjustment behavior is defined and tested.
- [ ] Emits `automation_lane_created` with `target_kind` on a lane's first breakpoint, plus the `automation` `feature_first_use` key. Drawing and dragging breakpoints emit nothing per point.

### ARR-005 - Arrangement performance and duration gate

`Status: todo | Owner: unassigned | Dependencies: ARR-001, ARR-002, ARR-003, ARR-004`<br>
`PRD: ARR-01; 9.3; Performance budgets | Evidence: pending`

Profile and optimize the production arrangement using deterministic 20/40/50-track ten-minute fixtures.

- [ ] PRD frame, input, long-task, load, memory, and visible-object scaling targets pass on the physical baseline device in the gating browsers. This is where those budgets first bind; `FND-008` supplied the fixtures, traces, and harness.
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
- [ ] Emits `export_started`, `export_completed`, and `export_failed` with `export_type: stereo`, bucketed duration, track count, and elapsed time, a `was_cancelled` flag, and an actionable `error_code`, plus the `export_stereo` `feature_first_use` key. File names are never logged.

### EXP-003 - Aligned stem package

`Status: todo | Owner: unassigned | Dependencies: EXP-001, DEC-004`<br>
`PRD: AUD-06, SHR-01 | Evidence: pending`

Implement selectable 16/24-bit stem export with one aligned WAV per track, separate returns, reference mix, manifest, deterministic naming/order, and ZIP packaging.

- [ ] Track stems include source, inserts, automation, fader, and pan but exclude master processing; mute/solo policy matches the PRD.
- [ ] All stems share sample rate, format, bar-1 origin, padded tail duration, and sample alignment.
- [ ] Progress, cancellation, worker/memory limits, asset policies, and recoverable failures are tested with the maximum reference fixture.
- [ ] Emits the same export event trio with `export_type: stems` plus the `export_stems` `feature_first_use` key, so stereo and stem adoption are separable in the PRD section 11 export measure.

### REL-001 - Arrangement and export gate

`Status: todo | Owner: unassigned | Dependencies: ARR-005, EXP-002, EXP-003`<br>
`PRD: Alpha Milestone 2 exit criteria; Appendix B scenarios 2 and 4 | Evidence: pending`

Validate manual creation of a two-to-ten-minute arrangement and import of its stems into an independent DAW/audio alignment harness.

- [ ] Playback, save/reopen, stereo render, and stems agree on arrangement bounds and musical events.
- [ ] Supported-browser reference runs show no skipped events, drift, missing tracks, clipped tails, leaks, or memory failure.
- [ ] Every P0 arrangement/export requirement maps to an automated test or named physical-device test procedure.
- [ ] Every Alpha Milestone 2 event in the PRD OPS-02 catalog has a call site proven by an automated test, and the primary track-progression measure is shown to compute from `project_created`, `arrangement_milestone`, and `export_completed` against recorded events. **Observing them from the deployed build, and computing the measure from real cohort data, is `OPS-001`, which runs immediately after this gate.**

### OPS-001 - Hosted environment verification and rollback drill

`Status: todo | Owner: product-owner | Dependencies: REL-001`<br>
`PRD: OPS-01, OPS-02, OPS-03; 12 "After Alpha Milestone 2" | Evidence: pending`

Provision the real hosted environment and close every OPS-01/OPS-02/OPS-03 acceptance criterion that cannot be met by writing code. This is the operator half of `FND-001b` and `FND-001c`: those tasks built the pipeline, the catalog, the reporting boundary, and their automated tests, and deliberately provisioned no accounts and held no credentials.

Run [`docs/runbooks/alpha-milestone-0.md`](./runbooks/alpha-milestone-0.md) end to end. It is written as a procedure and has never been executed; this task is its first run.

**This task is not implementation work and must not be claimed by an implementation agent.** Every criterion below requires credentials an agent does not have and must never invent. If a step reveals a defect in the pipeline, the catalog, or the reporting boundary, that fix is a new issue against the owning task — not silent repair inside this one.

Scheduled here rather than in Alpha Milestone 0 because one operator pass at the Alpha Milestone 2 boundary verifies the deploy, rollback, analytics, and monitoring paths against the whole Alpha Milestone 0-2 feature set at once, instead of re-verifying them after every milestone. It runs before Alpha Milestone 3 because the assistant's events and failure paths depend on monitoring that is known to work, and before `HARD-005` because the cohort must not be invited on unverified instrumentation.

- [ ] The Firebase project and Sentry organization exist, and all six CI variables and secrets from the runbook's part 3 are set. No credential reaches a developer machine or the repository.
- [ ] CI has taken a real deploy to Firebase Hosting on merge to the default branch, shipping Hosting, Firestore rules and indexes, and Storage rules together. The site loads and displays the deployed commit SHA.
- [ ] The post-deploy smoke test has run against the hosted URL and passed — app load, anonymous session start, project open, and audio start after a user gesture — and a deliberately failed smoke test has been shown to fail the deploy.
- [ ] The rollback drill has been **performed**: the previous Hosting release and its matching rules revision were restored, confirmed with the smoke test, and rolled forward again. The Hosting version IDs and rules commits involved are recorded.
- [ ] Every Alpha Milestone 0, Alpha Milestone 1, and Alpha Milestone 2 OPS-02 event has been observed arriving from the deployed build with its expected parameters, and the section 11 primary measure computes from real events.
- [ ] The analytics opt-out has been exercised in both directions from the deployed build, including GA4 automatic collection, and internal traffic is confirmed excluded from the section 11 measures.
- [ ] A deliberately triggered error has been shown arriving in Sentry with its release SHA, a symbolicated stack trace naming `src/` files, the expected tags, a redacted message, and no PII — as exactly one issue.
- [ ] No source map is publicly fetchable from Hosting, verified by request rather than by configuration review.
- [ ] `docs/testing.md`'s "What has not been verified" section is replaced with what was actually observed, including the date and the release SHA. Every deferred checkbox in `FND-001b`, `FND-001c`, `FND-009`, `LOOP-016`, and `REL-001` is ticked from an observed result or reopened as a defect.
- [ ] Gate **G4.5: Hosted environment verified** is marked open.

## 7. Alpha Milestone 3: AI producer

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
- [ ] Emits `assistant_proposal_shown`, `assistant_proposal_applied`, `assistant_proposal_cancelled`, and `assistant_proposal_undone` with `capability`, bucketed command count, and bucketed decision/undo times. Prompts, replies, summaries, and command payloads are never logged.

### AI-004 - Assistant conversation and proposal UI

`Status: todo | Owner: unassigned | Dependencies: AI-003`<br>
`PRD: AI-01, AI-02, AI-03, AI-04, AI-06, LRN-01 | Evidence: pending`

Implement streaming conversation, scope indicator, suggestions, proposal cards, visible diff, apply/cancel, post-action selection/highlight, undo, errors, and concise expandable explanations.

- [ ] Conversation remains responsive during playback and manual editing remains available during provider failure.
- [ ] Focus, keyboard, screen-reader announcements, cancellation, retry, stale proposal, and follow-up control highlighting are tested.
- [ ] Explanations link audible goal, accurate technique, and actual changed controls without mandatory lessons.
- [ ] Emits `assistant_message_sent` with `scope`, `assistant_suggestion_clicked` with `suggestion_id`, `assistant_result_edited` when the user manually edits an entity an applied proposal changed, and the `assistant` `feature_first_use` key. `assistant_result_edited` is what makes the ownership measure real, so it is not deferred.

### AI-005 - Alpha musical capability evaluations

`Status: todo | Owner: unassigned | Dependencies: AI-004`<br>
`PRD: AI-05; Appendix B scenarios 3 and 5 | Evidence: pending`

Build prompts, deterministic analysis helpers, and evaluation fixtures for loop sketching, variation, arrangement, transitions, processing, automation, balancing, and intentionally experimental requests.

- [ ] Drum, bass, chord, melody, and texture output uses editable events and bundled sources, never generated audio.
- [ ] Evaluation checks validity, editability, scope, atomic undo, explanation grounding, and musical diversity rather than exact notes.
- [ ] Conventional and extreme requests are distinguished without silently forcing genre conventions.

### AI-006 - Assistant transcript retention, disclosure, and opt-out

`Status: todo | Owner: unassigned | Dependencies: AI-004, DEC-005`<br>
`PRD: AI-09; AI-06; 10 Security and privacy | Evidence: pending`

Build the transcript store the team reads to improve the assistant, together with the disclosure and the opt-out that make retaining it honest. The three ship as one slice: no transcript is written before the disclosure and the opt-out exist.

The store is its own collection behind the `AI-001` gateway, **not** an extension of the `FND-001c` analytics catalog. That catalog's parameter-content test forbids exactly what a transcript contains, and that test must keep passing unchanged — this task does not widen it, add an exemption to it, or route conversation text through the analytics or error-reporting boundaries.

Two terms are decided (`DEC-005`, PRD section 16): retention is **30 days** from the message that produced the transcript, and **the AI provider may retain and train on the requests we send it**. Implement the window as configuration in one place rather than a literal spread across the server, the deletion job, and the disclosure copy. Draft disclosure copy is in [#95](https://github.com/afternoon/solid-groove/issues/95) — write it in this task rather than waiting for it, since the product owner has delegated the first draft. The `[provider]` placeholder resolves when `DEC-005` names the provider; shipping the literal string is a defect.

- [ ] A transcript record holds the user's messages, the assistant's replies, the proposals shown, and each proposal's apply/cancel/undo outcome, plus project ID, revision, and timestamps. A test rejects any record carrying song or clip content, audio, asset URLs, provider credentials, or tokens.
- [ ] Retention expiry is enforced server-side from the message timestamp using the 30-day window as configuration, and expired transcripts are deleted rather than archived, anonymized, or rolled up into a surviving summary. A test proves a record past 30 days is gone, and the disclosure reads its window from the same configured value so the two can never disagree.
- [ ] The disclosure is shown before the first assistant message of an account's first session, names the retention window and the human review purpose, sits with the `AI-06` explanation of what is sent to the provider, and gives accepting and declining equal weight. A test proves the assistant cannot be messaged before it has been shown.
- [ ] The disclosure states that the provider may retain and train on requests, and states plainly that the opt-out governs Solid Groove's own retention only — it does not withdraw what has already been sent to the provider. The control's own label and any confirmation text carry the same scope, so the claim survives a user who skims the dialog and reads only the setting.
- [ ] A durable opt-out control lives in a discoverable settings surface, not only in the first-run dialog, and shows the current state without changing it. With retention off, every assistant capability still works — proven by running the `AI-005` evaluation set with retention disabled.
- [ ] Opting out stops later retention and deletes that user's existing transcripts; emulator tests cover both, including a user who opts out mid-conversation.
- [ ] The preference is account-scoped and read server-side before any write. Absent, stale, or unreadable preference state results in no retention; a security-rules test proves a client cannot cause retention the preference does not permit, and cannot read another account's transcripts.
- [ ] The preference survives sign-out, sign-in, and anonymous-to-account upgrade, including a preference set anonymously before the account existed.
- [ ] Project deletion and account deletion delete the associated transcripts, covered by emulator tests alongside the existing `LOOP-001`/`HARD-003` deletion paths.
- [ ] Retained records carry the internal-session flag already defined for analytics user properties, so team traffic is excluded from review.
- [ ] The opt-out emits its own catalog event through the `FND-001c` boundary with a state key only, and the transport-failure test confirms retention behavior does not depend on analytics working.
- [ ] `docs/testing.md` documents how to verify, against a deployed build, that declining leaves no stored transcript and that an expired one is gone.

### REL-002 - AI producer gate

`Status: todo | Owner: unassigned | Dependencies: AI-005`<br>
`PRD: Alpha Milestone 3 exit criteria | Evidence: pending`

Run the full AI evaluation and failure matrix against stable manual commands.

- [ ] Reference loops become valid editable outlines and one undo restores byte-equivalent canonical song state.
- [ ] Malformed, stale, cancelled, timed-out, rate-limited, and provider-failed requests never mutate the project.
- [ ] Context size, latency, usage, error categories, and proposal acceptance are observable within approved privacy rules.
- [ ] Every Alpha Milestone 3 event in the PRD OPS-02 catalog has a call site and is observed from the deployed build; apply, cancel, undo, and follow-up-edit rates compute per capability.

## 8. Alpha Milestone 4: private-alpha hardening

### HARD-001 - Cross-browser compatibility suite

`Status: todo | Owner: unassigned | Dependencies: REL-002`<br>
`PRD: Supported environment; section 14 | Evidence: pending`

Expand Playwright and physical-browser procedures across current/previous Firefox, Chrome, and Edge for every core journey. Safari is best-effort for the alpha per the PRD supported-environment policy: run it, log what breaks, fix what is reasonably cheap, and record the residual risk for the product-owner decision on restoring gating status before public release.

- [ ] Capability fallbacks, audio unlock, decoding, shortcuts, downloads, Canvas/DPR, Firebase, and failure states are covered.
- [ ] Unsupported capability messages are actionable; browser regressions block release unless product-approved fallback exists.

### HARD-002 - Accessibility and resilient layout pass

`Status: todo | Owner: unassigned | Dependencies: REL-002`<br>
`PRD: section 8; Responsive behavior | Evidence: pending`

Audit and fix full keyboard operation, focus, semantics, names, contrast, reduced motion, 200% zoom, screen-reader announcements, and minimum editor dimensions.

- [ ] Critical Canvas actions have accessible DOM equivalents and focus is never stranded by panels or dialogs.
- [ ] Automated checks and manual keyboard/screen-reader scripts cover dashboard, editor, guide, assistant, and export.

### HARD-003 - Security, privacy, reliability, and telemetry

`Status: todo | Owner: unassigned | Dependencies: REL-002, DEC-001, DEC-005, DEC-009`<br>
`PRD: 10, 11, 14, OPS-01, OPS-02, OPS-03 | Evidence: pending`

Complete rule audits, validation, quotas, deletion/retention, CSP/secrets review, recovery UX, and the release dashboards over the already-shipped analytics. This task audits and reports on instrumentation; it does not add instrumentation that a feature task should have shipped. A missing event is a defect filed against the task that owned it.

- [ ] Security emulator tests and abuse cases cover all public backend surfaces and asset access.
- [ ] Crash, save failure, audio start failure, export result, AI failure, and leak signals are actionable without recording project content.
- [ ] Anonymous retention/deletion (180-day last-access window), the device-local pairing record's lifecycle (created on anonymous edit, deleted once paired to an account), analytics consent/retention (`DEC-009`), and AI data handling match product decisions and user-facing disclosures.
- [ ] Every event in the PRD OPS-02 catalog is confirmed firing from the deployed production build with the expected parameters, and any gap is filed against its owning task rather than patched here.
- [ ] Release dashboards compute the PRD section 11 primary, supporting, and guardrail measures — including crash-free session rate — from real cohort data with internal traffic excluded.

### HARD-004 - Content and template release audit

`Status: todo | Owner: unassigned | Dependencies: LOOP-015, REL-001`<br>
`PRD: LIB-01, LIB-02; docs/sample-library.md | Evidence: pending`

Run final provenance, duplicate, loudness, tuning, loop, missing-file, decode, search, demo, stem, and export audits.

- [ ] Every required genre demo opens, plays, saves, renders, and exports without missing/unlicensed assets.
- [ ] Removing an asset from discovery cannot corrupt existing fixture projects; manifest/export policies remain traceable.
- [ ] Every shipped pack is audited against its coverage claim and its rights position, and withdrawing a whole pack degrades an existing project to a reported missing-pack state rather than breaking playback or export.

### HARD-005 - Target-user validation and fixes

`Status: todo | Owner: unassigned | Dependencies: HARD-001, HARD-002, HARD-003, HARD-004, DEC-006`<br>
`PRD: Success measures; Alpha Milestone 4 | Evidence: pending`

Run facilitated loop-to-track sessions with the target cohort, categorize blockers against PRD success measures, fix release-blocking issues, and document residual risks.

- [ ] At least five representative users complete the qualitative validation exercise; the broader cohort is scheduled or completed.
- [ ] Findings distinguish product confusion, missing capability, reliability, performance, and taste/content issues.
- [ ] Release-blocking findings have regression tests or explicit product-owner disposition.

### REL-003 - Private-alpha release gate

`Status: todo | Owner: unassigned | Dependencies: HARD-005`<br>
`PRD: all P0 requirements; Alpha Milestone 4 exit criteria | Evidence: pending`

Produce the traceability matrix and release report for every P0 acceptance criterion, supported browser, reference scenario, security control, and performance/reliability budget.

- [ ] All P0 criteria are evidenced, deferred explicitly by the product owner, or block release.
- [ ] Production configuration, Firebase rules/indexes/functions, monitoring, rollback, and incident ownership are verified against the deployed production build, including a practised rollback and a live error reaching Sentry with its release SHA and a symbolicated stack trace.
- [ ] No open critical/high defect, unexplained resource leak, save-loss path, or unlicensed asset remains.

## 9. Parked post-alpha backlog

These tasks are intentionally brief until `REL-003` is `done`. Before claiming one, the product owner changes it from `parked` to `todo`, confirms acceptance criteria in the PRD, and splits it if needed.

### P1-001 - Ableton format and compatibility spike

`Status: parked | Owner: unassigned | Dependencies: REL-003, DEC-007`<br>
`PRD: SHR-02 | Evidence: pending`

Determine the oldest correctly supported Live version, serialization route, legal/technical constraints, supported editable mappings, fallback policy, and fixture test matrix.

### P1-002 - Self-contained Ableton Live export

`Status: parked | Owner: unassigned | Dependencies: P1-001`<br>
`PRD: SHR-02; Alpha Milestone 5 | Evidence: pending`

Build the portable Live Set package, copied assets, editable MIDI/automation mappings, rendered fallback stems, compatibility report, and tested reference projects.

### P1-003 - Named revisions and read-only sharing

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: PRJ-05, SHR-03 | Evidence: pending`

Add named checkpoints, safe restore, published immutable revisions, revocable links, permissions, and privacy-safe playback.

### P1-004 - Asynchronous collaboration

`Status: parked | Owner: unassigned | Dependencies: P1-003`<br>
`PRD: SHR-04 | Evidence: pending`

Add collaborator invitations, permissions, attribution, conflict behavior, and revision history without promising simultaneous editing.

### P1-005 - User sample imports and personal library

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: LIB-03 | Evidence: pending`

Add browser-decodable upload with drag-and-drop into a persistent per-user library, validation, quotas, progress, Storage security, metadata analysis, project references, and deletion semantics. Drag-and-drop-to-library and the persistent per-user library are fixed requirements; anonymous import limits, whether imports can back a sampler/drum pad or only audio-loop tracks first, and storage tiers are settled when unparked. Imported audio lands in the user's own `user`-kind pack (`LIB-04`) so one browser, resolver, cache, and audition path serve factory and user content alike; whether a user may hold more than one personal pack is settled when unparked. Imported assets become first-class library entries reusing the CNT-001 manifest/audition path and are never redistributed through shares, links, or others' projects.

### P1-006 - Preview, learning cues, and shortcut customization

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: AI-07, LRN-02, KEY-02 | Evidence: pending`

Evaluate non-destructive proposal preview, optional contextual learning cues, and persisted remappable shortcuts without weakening P0 diff/apply/undo behavior.

### P1-007 - Deeper synth and sampler controls

`Status: parked | Owner: unassigned | Dependencies: REL-003`<br>
`PRD: INS-01 (post-alpha extras); design mocks 05a, 05b | Evidence: pending`

Extend the alpha synth and sampler toward the fuller instrument shown in the design mocks: synth sub-oscillator, pulse-width, multi-mode filter (high-pass, band-pass, notch beyond the P0 resonant low-pass), filter envelope amount, and key tracking; sampler fine tune, gain, pan, an envelope hold stage, and a per-sampler filter. Reuse the LOOP-004 instrument graph, shared parameter schema, and legible-controls visual language; the alpha baseline (INS-01) already ships these instruments, so this is additive depth, not a rebuild.

### P2-001 - Real-time collaboration discovery

`Status: parked | Owner: unassigned | Dependencies: P1-004`<br>
`PRD: SHR-05 | Evidence: pending`

Research presence, simultaneous command ordering, conflict resolution, audio asset coordination, offline rejoin, and cost before committing to an architecture or delivery task.

### P2-002 - Assistant tutorial video recommendations

`Status: parked | Owner: unassigned | Dependencies: REL-002, DEC-008`<br>
`PRD: AI-08, LRN-03 | Evidence: pending`

Add curated, trusted-creator tutorial video recommendations that the assistant can surface inline (idle, inline-play, and fullscreen states per design mocks `07-*`), with no autoplay and no interruption of audio or edits. Video embeds through the provider's supported surface and is never given project-state access; optional follow-ups (summarize a video, translate a technique into a previewable proposal) reuse the existing AI command and explanation layers. Load/play failures are isolated. Depends on the DEC-008 curation, trust, embedding, and data-sharing decision.

### P2-003 - Pack marketplace

`Status: parked | Owner: unassigned | Dependencies: P1-005, DEC-010`<br>
`PRD: LIB-05; sample-library section 16 | Evidence: pending`

Let users build and publish their own packs, acquire packs from other creators, and sell premium packs.

Deliberately the last thing on this backlog by feature scope. It depends on user sample imports (`P1-005`) for user-owned content, and on `DEC-010` for whether Solid Groove wants this business at all and on what rights, revenue-sharing, and moderation terms. It is a commercial and operational commitment — creator agreements, payments, moderation, takedown, support — far more than it is a feature. `P2-004` follows it below as an operational chore rather than a feature.

Scope when unparked, at minimum: pack authoring and versioning from a user's own library; publication review, reporting, and a takedown that disables a pack for new use without breaking projects already referencing it; entitlement and per-user pack visibility with defined behaviour when access ends; purchase, refund, and payout handling; and discovery that does not turn the library into the undifferentiated catalogue the sample plan rejects. Nothing here may introduce a second content model beside `LIB-04` packs.

### P2-004 - Anonymous project expiry cleanup

`Status: parked | Owner: unassigned | Dependencies: REL-003, DEC-001`<br>
`PRD: 16 | Evidence: pending`

Build the scheduled job that deletes anonymous projects 180 days after their last access, per `DEC-001`. The job must resolve last-access per project (reset by any open/access, not just edits), only ever delete anonymous-owned projects, and be safe to retry and idempotent against partial prior runs. It must also account for the `LOOP-001` device-local pairing flow: a project paired to an authenticated account before expiry is no longer anonymous and is never a deletion candidate, and the job itself does not touch the device-local pairing records, which are owned and cleaned up client-side by `LOOP-001`.

## 10. Completion log

Add one row only when a release gate is completed. Individual task completion remains recorded in its task block and Git history.

| Date | Gate | Evidence | Approved by |
| --- | --- | --- | --- |
| - | - | - | - |
