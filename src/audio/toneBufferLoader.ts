import * as Tone from "tone";
import type { AssetBufferLoader } from "./AudioBufferCache";

/**
 * Decodes an asset's audio through Tone's own buffer loading. The only place
 * that touches Tone in the buffer-cache module pair — `AudioBufferCache`
 * itself stays Tone-agnostic so its generation/refcount bookkeeping can be
 * tested without any Web Audio globals installed.
 */
export const toneBufferLoader: AssetBufferLoader<Tone.ToneAudioBuffer> = {
  async load(asset) {
    if (!asset.url) {
      throw new Error(`Asset "${asset.id}" has no URL to decode`);
    }
    const buffer = new Tone.ToneAudioBuffer();
    await buffer.load(asset.url);
    return buffer;
  },
};
