/**
 * The canonical schema-v1 domain model.
 *
 * These modules are the authoritative domain contract (PRD sections 9.4 and
 * 9.5): entity shapes and their runtime schemas, prefixed stable IDs, integer
 * musical time at 192 PPQ, shared parameter definitions, validation of every
 * invariant, deterministic serialization, and factories/fixtures.
 *
 * Nothing here knows about Firebase, Tone.js, or SolidJS. Persistence,
 * commands, audio, and rendering consume this model from the outside.
 */

export * from "./entities";
export * from "./factories";
export * from "./fixtures";
export * from "./ids";
export * from "./parameters";
export * from "./parse";
export * from "./serialize";
export * from "./time";
