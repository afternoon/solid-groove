import type { StemExportError, StemRenderer } from "./exportStems";

/**
 * Stem-export test helpers (tests only).
 *
 * `fakeRenderer` stands in for the offline renderer, whose real audio the
 * audio project's own suites own: it hands back `frames(call)` frames of a
 * constant, reports progress in two steps, and records every call.
 */
export function fakeRenderer(
  frames: (call: number) => number = (call) => 100 + call * 10,
) {
  const calls: Parameters<StemRenderer>[] = [];
  const render: StemRenderer = async (projection, options) => {
    calls.push([projection, options]);
    const length = frames(calls.length - 1);
    options.onProgress?.(0.5);
    options.onProgress?.(1);
    const channel = new Float32Array(length).fill(0.25);
    return {
      channels: [channel, channel],
      sampleRate: options.sampleRate,
      frames: length,
      songEndSeconds: 0,
      tailTruncated: false,
    };
  };
  return { render, calls };
}

/** The error an export rejects with; throws if it resolves instead. */
export async function exportFailure(promise: Promise<unknown>): Promise<StemExportError> {
  try {
    await promise;
  } catch (error) {
    return error as StemExportError;
  }
  throw new Error("expected the export to fail");
}

/** An archive's parts as one buffer. */
export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}
