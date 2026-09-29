/**
 * The stereo export's file format (EXP-002): a canonical RIFF/WAVE file of
 * interleaved, little-endian, 24-bit signed integer PCM.
 *
 * The layout is the plain 44-byte header every DAW reads:
 *
 * | Offset | Bytes | Field                                         |
 * | ------ | ----- | --------------------------------------------- |
 * | 0      | 4     | `RIFF`                                        |
 * | 4      | 4     | file length − 8                               |
 * | 8      | 4     | `WAVE`                                        |
 * | 12     | 4     | `fmt `                                        |
 * | 16     | 4     | 16 (the PCM `fmt ` body length)               |
 * | 20     | 2     | 1 (integer PCM)                               |
 * | 22     | 2     | channel count                                 |
 * | 24     | 4     | sample rate                                   |
 * | 28     | 4     | byte rate (`rate × blockAlign`)               |
 * | 32     | 2     | block align (`channels × 3`)                  |
 * | 34     | 2     | 24 (bits per sample)                          |
 * | 36     | 4     | `data`                                        |
 * | 40     | 4     | data length (`frames × blockAlign`)           |
 * | 44     | …     | samples, frame by frame, channel by channel   |
 *
 * Gain is preserved exactly (DEC-004): a float sample maps to
 * `round(sample × 2^23)`, clamped to the 24-bit range, and nothing is
 * normalized, limited or dithered here. Anything over full scale in the render
 * clips at full scale, which is what the project would do on a real output.
 *
 * The file is written into one buffer allocated at its final size, so encoding
 * a render costs the file's bytes and nothing more — no intermediate interleave
 * copy of the float data.
 */

export const WAV_HEADER_BYTES = 44;
export const WAV_BITS_PER_SAMPLE = 24;
const BYTES_PER_SAMPLE = WAV_BITS_PER_SAMPLE / 8;
const FULL_SCALE = 2 ** 23;
const MAX_SAMPLE = FULL_SCALE - 1;
const MIN_SAMPLE = -FULL_SCALE;
/** RIFF sizes are 32-bit: the largest `data` chunk a WAV can declare. */
const MAX_RIFF_BYTES = 0xffff_ffff;

/** Float sample (nominally −1..1) to a 24-bit signed integer. */
export function toPcm24(sample: number): number {
  if (!Number.isFinite(sample)) return 0;
  const scaled = Math.round(sample * FULL_SCALE);
  return Math.min(MAX_SAMPLE, Math.max(MIN_SAMPLE, scaled));
}

/** The byte length of the WAV `encodeWav24` writes for these dimensions. */
export function wav24ByteLength(channelCount: number, frames: number): number {
  return WAV_HEADER_BYTES + channelCount * frames * BYTES_PER_SAMPLE;
}

/**
 * Encodes `channels` (one equally long array per channel) as a 24-bit PCM WAV.
 * Throws a `RangeError` for a render too long for a RIFF file to describe
 * rather than writing a header that lies about its length.
 */
export function encodeWav24(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  const channelCount = channels.length;
  if (channelCount < 1) throw new RangeError("A WAV needs at least one channel");
  if (!Number.isInteger(sampleRate) || sampleRate < 1) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`);
  }
  const frames = channels[0].length;
  if (channels.some((channel) => channel.length !== frames)) {
    throw new RangeError("Every channel must be the same length");
  }
  const total = wav24ByteLength(channelCount, frames);
  if (total - 8 > MAX_RIFF_BYTES) {
    throw new RangeError("The render is too long for a WAV file");
  }

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const blockAlign = channelCount * BYTES_PER_SAMPLE;
  const writeAscii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[at + index] = text.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, total - 8, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, frames * blockAlign, true);

  let at = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = toPcm24(channels[channel][frame]);
      bytes[at] = value & 0xff;
      bytes[at + 1] = (value >> 8) & 0xff;
      bytes[at + 2] = (value >> 16) & 0xff;
      at += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
