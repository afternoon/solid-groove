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
 * The encoder writes the file in chunks of at most {@link WAV_CHUNK_FRAMES}
 * frames ({@link wav24Chunks}), so a caller can hand each one to a `Blob` and
 * let it go: a ten-minute render never needs its whole WAV in memory beside its
 * float data (EXP-002's memory criterion). {@link encodeWav24} joins the same
 * chunks into one buffer for callers that want the file whole.
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

/** Frames per chunk {@link wav24Chunks} yields: 768 KiB of stereo data. */
export const WAV_CHUNK_FRAMES = 131_072;

/** Checks `channels` can be written as a WAV and returns its frame count. */
function validate(channels: readonly Float32Array[], sampleRate: number): number {
  if (channels.length < 1) throw new RangeError("A WAV needs at least one channel");
  if (!Number.isInteger(sampleRate) || sampleRate < 1) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`);
  }
  const frames = channels[0].length;
  if (channels.some((channel) => channel.length !== frames)) {
    throw new RangeError("Every channel must be the same length");
  }
  if (wav24ByteLength(channels.length, frames) - 8 > MAX_RIFF_BYTES) {
    throw new RangeError("The render is too long for a WAV file");
  }
  return frames;
}

function header(channelCount: number, frames: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const blockAlign = channelCount * BYTES_PER_SAMPLE;
  const writeAscii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[at + index] = text.charCodeAt(index);
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, wav24ByteLength(channelCount, frames) - 8, true);
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
  return bytes;
}

/** Frames `from`..`to` of `channels`, interleaved as 24-bit PCM. */
function samples(
  channels: readonly Float32Array[],
  from: number,
  to: number,
): Uint8Array {
  const bytes = new Uint8Array((to - from) * channels.length * BYTES_PER_SAMPLE);
  let at = 0;
  for (let frame = from; frame < to; frame += 1) {
    for (const channel of channels) {
      const value = toPcm24(channel[frame]);
      bytes[at] = value & 0xff;
      bytes[at + 1] = (value >> 8) & 0xff;
      bytes[at + 2] = (value >> 16) & 0xff;
      at += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}

/**
 * Encodes `channels` (one equally long array per channel) as a 24-bit PCM WAV,
 * yielded in order: the header, then the samples in chunks of at most
 * `chunkFrames` frames. Throws a `RangeError` straight away — before anything
 * is yielded — for input a WAV cannot describe, including a render too long
 * for a RIFF file, rather than writing a header that lies about its length.
 */
export function wav24Chunks(
  channels: readonly Float32Array[],
  sampleRate: number,
  chunkFrames: number = WAV_CHUNK_FRAMES,
): Iterable<Uint8Array> {
  const frames = validate(channels, sampleRate);
  return (function* () {
    yield header(channels.length, frames, sampleRate);
    for (let from = 0; from < frames; from += chunkFrames) {
      yield samples(channels, from, Math.min(frames, from + chunkFrames));
    }
  })();
}

/** The whole WAV {@link wav24Chunks} writes, as one buffer. */
export function encodeWav24(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  const bytes = new Uint8Array(
    wav24ByteLength(channels.length, channels[0]?.length ?? 0),
  );
  let at = 0;
  for (const chunk of wav24Chunks(channels, sampleRate)) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
