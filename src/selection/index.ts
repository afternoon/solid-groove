/**
 * The selection/focus model (PRD sections 9.2-9.3).
 *
 * UI-only state that names canonical entities by stable ID. It never enters
 * `Song` or `Project`, and building or reconciling it never mutates them.
 */

export * from "./selection";
export * from "./types";
