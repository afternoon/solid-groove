// Feature-detected browser capabilities (PRD section 10, "Supported
// environment"; #75).
//
// The PRD asks for two things of the app here: "Browser capabilities are
// feature-detected. Core behavior does not branch only on user-agent
// strings", and "The app detects unsupported Web Audio or decoding
// capabilities and explains the limitation." This module is the first half:
// it probes the APIs Groove depends on directly, never `navigator.userAgent`,
// and says which are missing. `capabilityMessages.ts` is the second half: what
// each gap means for the producer and what they can do about it.
//
// Detection is synchronous and side-effect free apart from one
// write-then-remove probe of `localStorage` (the only way to tell a present
// store from one that throws on use, as Safari private browsing and a
// "block site data" setting both do). It constructs no `AudioContext`:
// `AudioRuntime` is the only code allowed to, so the Web Audio checks look at
// constructors and prototypes instead.

/**
 * Every capability Groove probes for. The order is the order the notice lists
 * them in: the two that stop sound outright first.
 *
 * Mirrored by `BROWSER_CAPABILITY_IDS` in `src/analytics/catalog.ts`, which is
 * what `browser_capability_missing` reports; `catalog.test.ts` fails if the
 * two drift apart.
 */
export const CAPABILITY_IDS = [
  "web_audio",
  "audio_decoding",
  "offline_audio",
  "site_storage",
  "canvas_2d",
  "file_download",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/**
 * How badly a missing capability hurts. `required` means Groove's core loop
 * (hearing what you make) is broken; `degraded` means one feature is
 * unavailable and everything else still works.
 */
export type CapabilitySeverity = "required" | "degraded";

export const CAPABILITY_SEVERITY: Readonly<Record<CapabilityId, CapabilitySeverity>> = {
  web_audio: "required",
  audio_decoding: "required",
  offline_audio: "degraded",
  site_storage: "degraded",
  canvas_2d: "degraded",
  file_download: "degraded",
};

/**
 * The slice of the global object detection reads. `window` satisfies it; a
 * test hands in a plain object with exactly the APIs it wants present.
 */
export interface CapabilityHost {
  readonly AudioContext?: unknown;
  readonly webkitAudioContext?: unknown;
  readonly OfflineAudioContext?: unknown;
  readonly webkitOfflineAudioContext?: unknown;
  readonly localStorage?: Storage;
  readonly indexedDB?: unknown;
  readonly URL?: { readonly createObjectURL?: unknown };
  readonly HTMLAnchorElement?: { readonly prototype: object };
  readonly document?: { createElement(tagName: "canvas"): HTMLCanvasElement };
}

export interface CapabilityReport {
  /** Each probed capability, and whether this browser has it. */
  readonly available: Readonly<Record<CapabilityId, boolean>>;
  /** The missing ones, in `CAPABILITY_IDS` order. */
  readonly missing: readonly CapabilityId[];
}

function isConstructor(value: unknown): value is { prototype: unknown } {
  return typeof value === "function";
}

function audioContextConstructor(host: CapabilityHost): unknown {
  return host.AudioContext ?? host.webkitAudioContext;
}

function hasWebAudio(host: CapabilityHost): boolean {
  return isConstructor(audioContextConstructor(host));
}

function hasAudioDecoding(host: CapabilityHost): boolean {
  const audioContext = audioContextConstructor(host);
  if (!isConstructor(audioContext)) return false;
  const prototype = audioContext.prototype as { decodeAudioData?: unknown } | undefined;
  return typeof prototype?.decodeAudioData === "function";
}

function hasOfflineAudio(host: CapabilityHost): boolean {
  return isConstructor(host.OfflineAudioContext ?? host.webkitOfflineAudioContext);
}

const STORAGE_PROBE_KEY = "groove:capability-probe";

/**
 * `localStorage` that can actually be written, plus IndexedDB (where Firebase
 * Auth keeps the signed-in session). Merely reading `window.localStorage`
 * throws a `SecurityError` when site data is blocked, so the whole probe sits
 * inside the `try`.
 */
function hasSiteStorage(host: CapabilityHost): boolean {
  try {
    const storage = host.localStorage;
    if (!storage) return false;
    storage.setItem(STORAGE_PROBE_KEY, "1");
    storage.removeItem(STORAGE_PROBE_KEY);
    return host.indexedDB !== undefined && host.indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * A 2D context on a fresh canvas. Null when the browser (or a privacy
 * extension, or a hardened setting) refuses canvas drawing.
 */
function hasCanvas2d(host: CapabilityHost): boolean {
  try {
    const canvas = host.document?.createElement("canvas");
    return Boolean(canvas?.getContext("2d"));
  } catch {
    return false;
  }
}

/** What `src/editor/export/downloadFile.ts` needs to hand a file over. */
function hasFileDownload(host: CapabilityHost): boolean {
  const anchor = host.HTMLAnchorElement?.prototype;
  return (
    typeof host.URL?.createObjectURL === "function" &&
    anchor !== undefined &&
    "download" in anchor
  );
}

const PROBES: Readonly<Record<CapabilityId, (host: CapabilityHost) => boolean>> = {
  web_audio: hasWebAudio,
  audio_decoding: hasAudioDecoding,
  offline_audio: hasOfflineAudio,
  site_storage: hasSiteStorage,
  canvas_2d: hasCanvas2d,
  file_download: hasFileDownload,
};

/** Probes every capability against `host` (the window, by default). */
export function detectCapabilities(
  host: CapabilityHost = globalThis as unknown as CapabilityHost,
): CapabilityReport {
  const available = Object.fromEntries(
    CAPABILITY_IDS.map((id) => [id, PROBES[id](host)]),
  ) as Record<CapabilityId, boolean>;
  return {
    available,
    missing: CAPABILITY_IDS.filter((id) => !available[id]),
  };
}

/** A report in which every capability is present: the no-notice state. */
export const FULLY_CAPABLE: CapabilityReport = {
  available: Object.fromEntries(CAPABILITY_IDS.map((id) => [id, true])) as Record<
    CapabilityId,
    boolean
  >,
  missing: [],
};

/**
 * Whether this browser can make sound at all: a Web Audio constructor to build
 * the shared context from. `useProjectAudio` asks this before building a
 * graph, so a browser without it opens the editor silent rather than crashing
 * into the error screen.
 */
export function webAudioAvailable(
  host: CapabilityHost = globalThis as unknown as CapabilityHost,
): boolean {
  return hasWebAudio(host);
}
