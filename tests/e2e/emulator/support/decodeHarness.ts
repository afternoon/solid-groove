import { getAudioRuntime } from "~/audio/AudioRuntime";
import { toneBufferLoader } from "~/audio/toneBufferLoader";
import { factoryLibrary } from "~/library/factoryLibrary";
import { codeFor } from "~/monitoring/errorReporting";

/**
 * The browser half of `compatibility.spec.ts`'s decoding checks (#75): decodes
 * audio through the production loader (`toneBufferLoader`, the one path
 * `AudioBufferCache` decodes with) on the shared runtime's context, and
 * classifies a failure exactly as `asset_load_failed` would.
 *
 * Decoding is where browsers diverge most quietly — each engine has its own
 * decoders and its own error for bad data — so this is asserted in every
 * browser the suite runs, against the real decoder, not a fake.
 */

export type DecodeOutcome =
  | {
      readonly ok: true;
      readonly channels: number;
      readonly durationSeconds: number;
      readonly sampleRate: number;
    }
  | { readonly ok: false; readonly code: string };

async function decode(url: string): Promise<DecodeOutcome> {
  // Decoding needs a context but not a running one: no user gesture, so it
  // stays suspended, which is the state a producer's first load happens in.
  getAudioRuntime().ensureContext();
  try {
    const buffer = await toneBufferLoader.load({ id: "ast_decodeprobe", url } as never);
    return {
      ok: true,
      channels: buffer.numberOfChannels,
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
    };
  } catch (error) {
    return { ok: false, code: codeFor(error) };
  }
}

/** Decodes the first factory sound the app ships, with what its manifest says. */
export async function decodeFactorySound(): Promise<{
  readonly outcome: DecodeOutcome;
  readonly expected: { readonly channels: number; readonly durationSeconds: number };
}> {
  const entry = factoryLibrary()[0];
  if (!entry) throw new Error("the factory library is empty");
  return {
    outcome: await decode(`/${entry.storageRef}`),
    expected: { channels: entry.channelCount, durationSeconds: entry.durationSeconds },
  };
}

/** Decodes whatever the server answers at `url`. */
export function decodeUrl(url: string): Promise<DecodeOutcome> {
  return decode(url);
}
