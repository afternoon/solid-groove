# Arrangement renderer spike (`FND-008`)

Everything in this directory is the **disposable** half of `FND-008` — a
representative hybrid virtualized-DOM/Canvas 2D UI built to give the
measurement harness (`perf/arrangement.bench.spec.ts`) something real to
drive, and to prove out the geometry/projection contracts under an actual
Canvas renderer. Per the backlog task and PRD section 9.3 ("When these
budgets are enforced"), it is explicitly **not gated on hitting the PRD frame
budgets** and is expected to be replaced, not grown, by the production
arrangement editor (`ARR-005`).

## What's retained vs. disposable

- **Retained** (one directory up, in `src/arrangement/`): `geometry.ts`,
  `projection.ts`, `revision.ts`, `waveformCache.ts`, and their tests. These
  have no DOM/Canvas/SolidJS imports and are the renderer-agnostic contracts
  `ARR-005` is expected to keep using.
- **Disposable** (this directory): `ArrangementSpike.tsx`, `canvasLayers.ts`,
  and `instrumentation.ts`. This is UI code wired to one specific
  Canvas-drawing approach and one specific measurement harness; it benchmarking
  well here does not make it production code (see the backlog task's last
  acceptance line).

## What it implements

- **Viewport culling** — `visiblePlacements`/`visiblePlacementsForTrack`
  (`../projection.ts`) query only the visible tick range plus a small
  overscan, using the per-track sorted index instead of scanning every
  placement in the project.
- **Layered invalidation** — three stacked `<canvas>` elements (background,
  content, interaction), each redrawn only when its own dirty reason fires
  (`ArrangementSpike.tsx`'s `markDirty`/`drawDirtyLayers`). Moving the
  playhead or hovering a placement redraws only the interaction layer.
  Nothing runs on a permanent animation-frame loop; a draw happens only when
  something is marked dirty, and at most once per animation frame.
- **Pointer hit testing** — `hitTestArrangement` (`../projection.ts`) checks
  resize handles before the placement body, using the same tick/row
  conversion the drawing code uses.
- **Wheel/pinch zoom anchoring** — `zoomAtAnchor` (`../geometry.ts`) keeps the
  musical tick under the pointer fixed across a zoom change; plain wheel
  scrolls, ctrl/cmd-wheel (the desktop-browser pinch-zoom convention) zooms.
- **Virtualized track headers** — the header column only renders DOM nodes
  for `visibleRowRange(...) + overscan`, translated to track the shared
  scroll position, rather than one element per track in the project.

## Running it in a browser

```sh
bun run dev
```

then open `/spike/arrangement?tracks=50` (`tracks` accepts `20`, `40`, or
`50`, matching `createArrangementSpikeProject` in
`src/domain/fixtures.ts`; defaults to `50`).

## Measurement harness

See [`docs/arrangement-renderer-spike.md`](../../../docs/arrangement-renderer-spike.md)
for the single documented command that runs the scripted scroll/zoom/seek/
selection traces and where the baseline numbers are checked in.
