/**
 * Retained, renderer-agnostic arrangement contracts (PRD section 9.3; the task
 * `FND-008`). See `geometry.ts`, `projection.ts`, `revision.ts`, and
 * `waveformCache.ts` for the pieces this re-exports, and `spike/README.md`
 * for what is disposable versus what is meant to survive into `ARR-005`.
 */

export * from "./geometry";
export * from "./projection";
export * from "./revision";
export * from "./waveformCache";
