import * as Tone from "tone";
import type { AssetBufferLoader } from "./AudioBufferCache";
import { readStoredAudio } from "./storedAudio";

/**
 * Decodes an asset's audio through Tone's own buffer loading. The only place
 * that touches Tone in the buffer-cache module pair — `AudioBufferCache`
 * itself stays Tone-agnostic so its generation/refcount bookkeeping can be
 * tested without any Web Audio globals installed.
 *
 * An asset with a URL (a factory sound) is fetched from it. One without (a
 * producer's own sound, #282) is read from its `storageRef` as the signed-in
 * user through `storedAudio.ts`, which keeps it the owner's alone.
 */
export const toneBufferLoader: AssetBufferLoader<Tone.ToneAudioBuffer> = {
  async load(asset) {
    if (!asset.url) return decodeStoredAudio(asset.storageRef);
    const buffer = new Tone.ToneAudioBuffer();
    await buffer.load(asset.url);
    return buffer;
  },
};

/** The audio stored at `storageRef`, read as the signed-in user and decoded. */
export async function decodeStoredAudio(
  storageRef: string,
): Promise<Tone.ToneAudioBuffer> {
  const bytes = await readStoredAudio(storageRef);
  const decoded = await Tone.getContext().decodeAudioData(bytes);
  return new Tone.ToneAudioBuffer(decoded);
}
