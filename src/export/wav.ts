/**
 * A RIFF/WAVE integer-PCM encoder for export (EXP-002 stereo, EXP-003 stems).
 *
 * It writes the canonical 44-byte header — `RIFF`, `fmt ` (format tag 1), and
 * `data` — so every DAW reads it, and nothing else: no `LIST`, no `bext`, no
 * padding chunk. Samples are interleaved little-endian signed integers.
 *
 * It never changes the level of anything (`DEC-004`: export preserves project
 * gain exactly). A float sample maps to an integer by scaling alone, and one
 * outside [-1, 1] is clamped to full scale rather than wrapped, since clipping
 * is what any fixed-point file does with it and wrapping would be a loud click.
 * No dither is applied: dither is noise, and adding it is a level decision.
 */

/** The integer PCM depths export offers. */
export const WAV_BIT_DEPTHS = [16, 24] as const;
export type WavBitDepth = (typeof WAV_BIT_DEPTHS)[number];

/** The canonical header's size: `RIFF` + `fmt ` + `data` chunk headers. */
export const WAV_HEADER_BYTES = 44;

const PCM_FORMAT_TAG = 1;

/**
 * Encodes `channels` (one array per channel, all the same length) as a WAV.
 * Throws on no channels, mismatched lengths, a non-positive or non-integer
 * sample rate, or a file too large for a 32-bit RIFF size field.
 */
export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth,
): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const header = wavHeader(channels.length, sampleRate, bitDepth, frames);
  const pcm = encodePcm(channels, bitDepth);
  const bytes = new Uint8Array(header.byteLength + pcm.byteLength);
  bytes.set(header);
  bytes.set(pcm, header.byteLength);
  return bytes;
}

/**
 * The canonical 44-byte header for `frames` frames of integer PCM. Separate
 * from the samples so a stem can be padded to a longer length than it was
 * rendered at without copying its samples (EXP-003).
 */
export function wavHeader(
  channelCount: number,
  sampleRate: number,
  bitDepth: WavBitDepth,
  frames: number,
): Uint8Array {
  if (channelCount < 1) throw new RangeError("A WAV needs at least one channel");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`);
  }
  if (!WAV_BIT_DEPTHS.includes(bitDepth)) {
    throw new RangeError(`Unsupported bit depth: ${bitDepth}`);
  }
  const blockAlign = channelCount * (bitDepth / 8);
  const dataBytes = frames * blockAlign;
  if (WAV_HEADER_BYTES - 8 + dataBytes > 0xffffffff) {
    throw new RangeError("The audio is too long for a WAV file");
  }

  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT_TAG, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** A WAV's `data` chunk body: `channels` interleaved as little-endian signed
 * integers. Every channel must be the same length. */
export function encodePcm(
  channels: readonly Float32Array[],
  bitDepth: WavBitDepth,
): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== frames)) {
    throw new RangeError("Every channel of a WAV must be the same length");
  }
  if (!WAV_BIT_DEPTHS.includes(bitDepth)) {
    throw new RangeError(`Unsupported bit depth: ${bitDepth}`);
  }
  const bytesPerSample = bitDepth / 8;
  const bytes = new Uint8Array(frames * channels.length * bytesPerSample);
  const view = new DataView(bytes.buffer);
  const scale = 2 ** (bitDepth - 1) - 1;
  let at = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const value = toInteger(channel[frame], scale);
      if (bitDepth === 16) {
        view.setInt16(at, value, true);
      } else {
        bytes[at] = value & 0xff;
        bytes[at + 1] = (value >> 8) & 0xff;
        bytes[at + 2] = (value >> 16) & 0xff;
      }
      at += bytesPerSample;
    }
  }
  return bytes;
}

/** Scales a float sample to a signed integer, clamping to full scale. NaN is
 * silence rather than a garbage value. */
function toInteger(sample: number, scale: number): number {
  if (Number.isNaN(sample)) return 0;
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * scale);
}

function writeAscii(bytes: Uint8Array, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
}
