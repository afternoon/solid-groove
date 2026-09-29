import { describe, expect, it } from "vitest";
import { encodeWav, WAV_HEADER_BYTES } from "./wav";

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset);

const int24 = (bytes: Uint8Array, at: number) => {
  const unsigned = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
};

describe("encodeWav", () => {
  it("writes the canonical RIFF/WAVE integer-PCM header", () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([0, 0.25, -0.25]);
    const bytes = encodeWav([left, right], 48_000, 24);
    const header = view(bytes);

    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES + 3 * 2 * 3);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(header.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(ascii(bytes, 8, 8)).toBe("WAVEfmt ");
    expect(header.getUint32(16, true)).toBe(16);
    expect(header.getUint16(20, true)).toBe(1);
    expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(24, true)).toBe(48_000);
    expect(header.getUint32(28, true)).toBe(48_000 * 6);
    expect(header.getUint16(32, true)).toBe(6);
    expect(header.getUint16(34, true)).toBe(24);
    expect(ascii(bytes, 36, 4)).toBe("data");
    expect(header.getUint32(40, true)).toBe(18);
  });

  it("interleaves 24-bit samples little-endian, scaled without any gain change", () => {
    const bytes = encodeWav(
      [new Float32Array([1, -1, 0.5]), new Float32Array([0, 0.25, -0.5])],
      44_100,
      24,
    );
    const full = 2 ** 23 - 1;
    const samples = Array.from({ length: 6 }, (_, i) =>
      int24(bytes, WAV_HEADER_BYTES + i * 3),
    );
    expect(samples).toEqual([
      full,
      0,
      -full,
      Math.round(0.25 * full),
      Math.round(0.5 * full),
      Math.round(-0.5 * full),
    ]);
  });

  it("writes 16-bit samples as little-endian int16", () => {
    const bytes = encodeWav([new Float32Array([0.5, -1])], 22_050, 16);
    const data = view(bytes);
    expect(data.getUint16(34, true)).toBe(16);
    expect(data.getUint16(32, true)).toBe(2);
    expect(data.getInt16(WAV_HEADER_BYTES, true)).toBe(Math.round(0.5 * 32_767));
    expect(data.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-32_767);
  });

  it("clamps out-of-range samples to full scale and writes NaN as silence", () => {
    const bytes = encodeWav([new Float32Array([2, -3, Number.NaN])], 48_000, 16);
    const data = view(bytes);
    expect(data.getInt16(WAV_HEADER_BYTES, true)).toBe(32_767);
    expect(data.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-32_767);
    expect(data.getInt16(WAV_HEADER_BYTES + 4, true)).toBe(0);
  });

  it("encodes a zero-length render as a header with an empty data chunk", () => {
    const bytes = encodeWav([new Float32Array(0), new Float32Array(0)], 48_000, 24);
    expect(bytes.byteLength).toBe(WAV_HEADER_BYTES);
    expect(view(bytes).getUint32(40, true)).toBe(0);
  });

  it("rejects input no WAV can hold", () => {
    expect(() => encodeWav([], 48_000, 24)).toThrow(RangeError);
    expect(() =>
      encodeWav([new Float32Array(2), new Float32Array(3)], 48_000, 24),
    ).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(2)], 0, 24)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(2)], 44_100.5, 16)).toThrow(RangeError);
    expect(() => encodeWav([new Float32Array(2)], 48_000, 32 as 24)).toThrow(RangeError);
  });
});
