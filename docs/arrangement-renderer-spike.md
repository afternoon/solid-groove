# Arrangement renderer spike and measurement harness

| Field | Value |
| --- | --- |
| Status | Implemented (`FND-008`) |
| Scope | Disposable hybrid virtualized-DOM/Canvas 2D spike, retained renderer-agnostic projection/geometry contracts, and the scripted-trace measurement harness Phase 2 (`ARR-005`) will enforce budgets with |

Related documents: [Product requirements](./prd.md) ([7.5 ARR-01](./prd.md#75-arrangement), [9.3 Arrangement renderer decision](./prd.md#93-arrangement-renderer-decision), [Performance budgets](./prd.md#performance-budgets)), [backlog](./backlog.md#fnd-008---arrangement-renderer-spike-and-measurement-harness)

**This task is not gated on hitting the PRD frame budgets, and not gated on
the physical baseline device.** Budgets bind at `ARR-005` (Phase 2) and
`HARD-001` (Phase 4). What this task owes — and what this document is the map
of — is deterministic fixtures, a working spike, scripted traces, a
single-command harness, and honestly recorded numbers from whatever hardware
ran them.

## What's retained vs. disposable

| Path | Status | Why |
| --- | --- | --- |
| `src/arrangement/geometry.ts` | Retained | Pure viewport/row/zoom math (PRD 9.3 "Viewport and scrolling model"). No DOM/Canvas/SolidJS imports. |
| `src/arrangement/projection.ts` | Retained | Builds the renderer-specific `ArrangementProjection` PRD 9.3 calls for: stable IDs, integer musical bounds, track order, colors, labels, compact preview data, revision counters, viewport culling, hit testing. |
| `src/arrangement/revision.ts` | Retained | Object-identity revision counters — cheap because domain state is edited immutably (`produce`), so reference equality already tells you what changed. |
| `src/arrangement/waveformCache.ts` | Retained (cache contract; generator is a stand-in) | LRU, multi-resolution, keyed by `(assetId, revision)`, budgeted at the PRD's `128 MiB`. `generateSyntheticPeaks` is the one piece a real audio-decode pipeline replaces later. |
| `src/arrangement/spike/*` | **Disposable** | The actual Canvas-drawing Solid component, layer-drawing code, and measurement instrumentation. Wired to one specific approach and one specific harness; see `spike/README.md`. `ARR-005` replaces this, it does not grow it. |
| `src/routes/spike/arrangement.tsx` | Disposable | Unlinked route that mounts the spike for manual poking and for the harness to drive. |
| `perf/arrangement.bench.spec.ts`, `playwright.bench.config.ts` | Harness (kept until superseded) | Drives the scripted traces and writes the baseline. |

Reusing this task's retained pieces (rather than a second, different
implementation) is expected of `ARR-005`; growing the spike's disposable UI
into a production component is not — see the backlog task's final acceptance
line: "experimental UI is not treated as production merely because it
benchmarks well."

## Fixtures

`src/domain/fixtures.ts` adds:

- `createReferenceProject({ waveformTrackCount, ... })` — the existing PRD 9.3
  reference-arrangement fixture (50 tracks, ten minutes, 2,500 placements, 100
  automation lanes by default) gains an optional `waveformTrackCount`: that
  many of its tracks become `audio` tracks holding an `audioLoop` clip instead
  of an `instrument` track holding a note clip, so waveform-preview placements
  get fixture coverage too, not just note-preview ones. Defaults to `0`, so
  every existing caller/test is unaffected.
- `createArrangementSpikeProject(trackCount)` — the task's three benchmark
  fixtures: `20`, `40`, or `50` tracks (`ARRANGEMENT_SPIKE_TRACK_COUNTS`), each
  a ten-minute arrangement with `50 × trackCount` placements (50 per track
  spread across the ten minutes — the same per-track density as the PRD 9.3
  reference arrangement, so the 50-track case reaches its "at least 2,500
  clip placements"), `2 × trackCount` automation lanes, and ~40% of tracks as
  waveform-bearing audio tracks. Deterministic (seeded by track count) and
  validated by `parseProject`, like every other domain fixture.
- `createArrangementSpikeFixtures()` — all three, keyed by track count, for
  tests or tooling that want to iterate over the full matrix.

## The spike

`src/arrangement/spike/ArrangementSpike.tsx`, mounted at
`/spike/arrangement?tracks=20|40|50` (`src/routes/spike/arrangement.tsx`).
Implements, per the backlog task's acceptance checkboxes:

- **Viewport culling** through `visiblePlacements`/`visiblePlacementsForTrack`.
- **Layered invalidation**: three stacked canvases (background/content/
  interaction), each redrawn only for its own dirty reason, coalesced to at
  most one draw per animation frame, idle when nothing is dirty.
- **Pointer hit testing** via `hitTestArrangement`, checking resize handles
  before the placement body.
- **Wheel/pinch zoom anchoring** via `zoomAtAnchor` — plain wheel scrolls,
  ctrl/cmd-wheel zooms anchored under the pointer.
- **Virtualized track headers** — a DOM `<ul>`/`<li>` list windowed to the
  visible row range plus overscan, sharing the same row metrics and scroll
  state as the canvas.

See `src/arrangement/spike/README.md` for the retained/disposable boundary in
more detail.

## Running the measurement harness

```sh
bun run bench:arrangement
```

This is `playwright test --config=playwright.bench.config.ts` (a
`prebench:arrangement` hook generates `public/samples/*` first, matching
`pretest:browser`, since the harness loads the real app shell). It:

1. Starts the dev server (`bun run dev`, `VITE_MOCK_BACKEND=true`) on its own
   port (`3100`) so it can run alongside `bun run test:browser` without
   fighting over one.
2. For each of the three benchmark track counts, opens
   `/spike/arrangement?tracks=<n>` and, once
   `[data-testid="arrangement-spike-ready"]` is attached, runs each of the
   four scripted traces the backlog task requires — **scroll, zoom, seek,
   selection** — for 120 animation frames apiece, through the same public API
   a real gesture would use (`window.__arrangementSpike`,
   `ArrangementSpikeHandle` in `ArrangementSpike.tsx`).
3. Collects, per trace: frame count; median and p95 **frame time**
   (`medianFrameMs`/`p95FrameMs` — the wall-clock interval between
   consecutive presented animation frames, the basis PRD 9.3's budget
   ("median frame time at or below 16.7 ms, p95 at or below 33 ms") is
   stated against, spanning rasterization/compositing/layout/reactive work
   as well as the draw call itself); median and p95 **draw time**
   (`medianDrawMs`/`p95DrawMs` — just the synchronous canvas draw-command
   issue duration, a strict lower bound on frame cost, not frame time);
   long-task count and total duration (Chromium-only `PerformanceObserver`
   `"longtask"` entries — Firefox/WebKit simply report zero); redraw counts
   per layer; and JS heap usage where the browser exposes it
   (`performance.memory`, Chromium-only).
4. Writes everything to `docs/perf/arrangement-spike-baseline.json`, tagged
   with the browser and the hardware (`os.cpus()`, `os.totalmem()`,
   platform/arch) that produced it.

Only Chromium is configured for the bench project today (the harness measures
one representative engine rather than tripling the run; nothing prevents
adding `firefox`/`webkit` projects to `playwright.bench.config.ts` later the
same way `playwright.config.ts` does for the functional E2E suite).

This suite is not part of `bun run test`, `bun run test:browser`, or CI's
gating matrix — it produces a baseline artifact, not a pass/fail signal, and
per the backlog task, it is not required to hit the PRD 9.3 budgets or to run
on the physical baseline device.

## Baseline status

**No baseline is checked in by this change.** `bun run test:browser:install`
downloads Playwright's browser binaries from `cdn.playwright.dev`; the
sandbox this task was implemented in has no outbound access to that host
(the same constraint `docs/testing.md` already documents for
`bun run test:browser`), so `bench:arrangement` could not actually be
executed here. `playwright test --config=playwright.bench.config.ts --list`
does not need the binaries and confirms the harness itself is wired up
correctly (12 tests: 3 track counts × 4 traces).

Per PRD 9.3's own instruction — "Measuring a spike on unrepresentative
hardware and declaring the budget met is a worse outcome than an honest early
number" — no fabricated or borrowed numbers are substituted here. The next
agent or developer with browser access should run:

```sh
bun run test:browser:install   # one-time
bun run bench:arrangement
```

and commit the resulting `docs/perf/arrangement-spike-baseline.json`, noting
the machine (ideally the physical baseline device from PRD 9.3: a 2019
13-inch Intel MacBook Pro class machine, 8 GB RAM, integrated graphics — but
any machine is an honest starting point per the "Phase 0 owes... honest
recorded numbers" instruction) and browser version it ran on, which the
harness records automatically from `os` and Playwright's own browser
metadata.
