// WAV encoding, hashing, and the ingestion-time analysis recorded in the
// manifest (docs/sample-library.md sections 9, 10 and 12).

import { createHash } from "node:crypto";
import { dbfs, peak, rms, SAMPLE_RATE } from "./dsp.mjs";

export const BIT_DEPTH = 24;

/**
 * Normalize the two accepted shapes — one `Float32Array` (mono) or an array of
 * them (one per channel) — into a channel list.
 */
function asChannels(samples) {
  return ArrayBuffer.isView(samples) ? [samples] : samples;
}

/**
 * Encode float samples in [-1, 1] as a 24-bit PCM WAV.
 *
 * Masters are 48 kHz / 24-bit per the audio preparation standards. Accepts mono
 * or interleaved multi-channel: the synthesized library is genuinely mono and
 * stays mono rather than being widened to claim a bigger specification, while
 * acquired stereo ambiences and field recordings keep the spatial information
 * that is the reason to use them (section 10).
 */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const channels = asChannels(samples);
  const frames = channels[0]?.length ?? 0;
  for (const channel of channels) {
    if (channel.length !== frames) {
      throw new Error("every channel must have the same number of frames");
    }
  }
  const bytesPerSample = BIT_DEPTH / 8;
  const blockAlign = bytesPerSample * channels.length;
  const dataSize = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  const ascii = (text) => {
    buffer.write(text, offset, "ascii");
    offset += text.length;
  };
  const u32 = (value) => {
    buffer.writeUInt32LE(value, offset);
    offset += 4;
  };
  const u16 = (value) => {
    buffer.writeUInt16LE(value, offset);
    offset += 2;
  };

  ascii("RIFF");
  u32(36 + dataSize);
  ascii("WAVE");
  ascii("fmt ");
  u32(16); // PCM chunk size
  u16(1); // format: PCM
  u16(channels.length);
  u32(sampleRate);
  u32(sampleRate * blockAlign); // byte rate
  u16(blockAlign);
  u16(BIT_DEPTH);
  ascii("data");
  u32(dataSize);

  // 24-bit signed little-endian, channel-interleaved. The asymmetric clamp
  // keeps the negative extreme representable instead of wrapping to positive
  // full scale.
  const maximum = 2 ** (BIT_DEPTH - 1) - 1;
  const minimum = -(2 ** (BIT_DEPTH - 1));
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const clamped = Math.max(-1, Math.min(1, channel[frame]));
      const value = Math.max(minimum, Math.min(maximum, Math.round(clamped * maximum)));
      buffer.writeIntLE(value, offset, 3);
      offset += 3;
    }
  }
  return buffer;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Compact min/max waveform peaks, so the library browser can draw a waveform
 * without downloading the audio (docs/sample-library.md section 12).
 */
export function waveformPeaks(samples, buckets = 64) {
  // One waveform per asset regardless of channel count: the browser draws a
  // single overview, and a per-channel payload would double the metadata for
  // no visible difference at this bucket resolution.
  const channels = asChannels(samples);
  const frames = channels[0]?.length ?? 0;
  const peaks = [];
  // Bucket boundaries are computed proportionally rather than by a fixed
  // stride: a stride leaves short assets with fewer buckets than declared,
  // and a client that trusts `buckets` would then draw a truncated waveform.
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor((bucket * frames) / buckets);
    const end = Math.floor(((bucket + 1) * frames) / buckets);
    let low = 0;
    let high = 0;
    for (let i = start; i < end; i++) {
      for (const channel of channels) {
        if (channel[i] < low) low = channel[i];
        if (channel[i] > high) high = channel[i];
      }
    }
    peaks.push(round(low, 3), round(high, 3));
  }
  return peaks;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The audio facts the manifest records for every asset. */
export function analyze(samples, sampleRate = SAMPLE_RATE) {
  const channels = asChannels(samples);
  const frames = channels[0]?.length ?? 0;
  // Peak and RMS are taken across every channel, so a loud right channel
  // cannot hide behind a quiet left one in the headroom check.
  const peakAmplitude = Math.max(...channels.map(peak));
  const meanSquare =
    channels.reduce((sum, channel) => sum + rms(channel) ** 2, 0) / channels.length;
  return {
    sampleRate,
    bitDepth: BIT_DEPTH,
    channels: channels.length,
    durationSeconds: round(frames / sampleRate, 4),
    peakDbfs: round(dbfs(peakAmplitude), 2),
    rmsDbfs: round(dbfs(Math.sqrt(meanSquare)), 2),
  };
}

/**
 * Content-addressed storage key. Identity is the hash of the bytes, never the
 * source URL or a human filename, so re-running the build is idempotent and a
 * project can pin an exact asset version (sections 9 and 12).
 */
export function storageKeyFor(hash, extension = "wav") {
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${extension}`;
}

/**
 * Content types for the delivery layout. A preset is delivered as a
 * content-addressed object exactly like a WAV (`CNT-001`), so the uploader
 * needs one place that maps a master's declared format onto what the bucket
 * serves it as.
 */
export const CONTENT_TYPES = {
  wav: "audio/wav",
  json: "application/json",
};

export function contentTypeForKey(storageKey) {
  const extension = storageKey.split(".").pop();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
