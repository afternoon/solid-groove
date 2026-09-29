import { describe, expect, it } from "vitest";
import { encodeWav24, toPcm24, WAV_HEADER_BYTES, wav24ByteLength } from "./wavEncoder";

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** Reads the signed 24-bit little-endian sample at `at`. */
const readPcm24 = (bytes: Uint8Array, at: number) => {
  const unsigned = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  return unsigned & 0x80_0000 ? unsigned - 0x100_0000 : unsigned;
};

describe("encodeWav24", () => {
  it("writes a canonical 24-bit stereo PCM header", () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([0.25, -0.25, 0]);
    const bytes = encodeWav24([left, right], 48_000);
    const view = new DataView(bytes.buffer);

    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES + 3 * 2 * 3);
    expect(bytes.byteLength).toBe(wav24ByteLength(2, 3));
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(ascii(bytes, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(48_000 * 6);
    expect(view.getUint16(32, true)).toBe(6);
    expect(view.getUint16(34, true)).toBe(24);
    expect(ascii(bytes, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(18);
  });

  it("interleaves the channels frame by frame at exactly the rendered gain", () => {
    const left = new Float32Array([0.5, -1]);
    const right = new Float32Array([-0.5, 0.125]);
    const bytes = encodeWav24([left, right], 44_100);
    const samples = [0, 1, 2, 3].map((index) =>
      readPcm24(bytes, WAV_HEADER_BYTES + index * 3),
    );
    // No normalization (DEC-004): 0.5 stays half scale, it is not raised to 1.
    expect(samples).toEqual([2 ** 22, -(2 ** 22), -(2 ** 23), 2 ** 20]);
  });

  it("writes an empty render as a valid file with an empty data chunk", () => {
    const bytes = encodeWav24([new Float32Array(0), new Float32Array(0)], 48_000);
    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(0);
  });

  it("refuses channels of different lengths and invalid rates", () => {
    expect(() => encodeWav24([new Float32Array(2), new Float32Array(3)], 48_000)).toThrow(
      RangeError,
    );
    expect(() => encodeWav24([new Float32Array(2)], 0)).toThrow(RangeError);
    expect(() => encodeWav24([], 48_000)).toThrow(RangeError);
  });
});

describe("toPcm24", () => {
  it("clips at full scale rather than wrapping", () => {
    expect(toPcm24(1)).toBe(2 ** 23 - 1);
    expect(toPcm24(2)).toBe(2 ** 23 - 1);
    expect(toPcm24(-2)).toBe(-(2 ** 23));
  });

  it("writes silence for a non-finite sample", () => {
    expect(toPcm24(Number.NaN)).toBe(0);
    expect(toPcm24(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
