import { WAVEFORM_PEAK_COUNT } from "../library/manifest";

/**
 * What an import learns about a dropped audio file before it uploads it (#282).
 *
 * A personal sound has to behave like a factory one in the browser (LIB-01):
 * a name to search for, a family and role for the shelf, a length, a waveform,
 * and — where the file says so — its sample rate and the tempo a loop was made
 * at. None of that is typed by the producer; it is read off the file:
 *
 *  - the **name** comes from the filename, with its extension and separators
 *    dropped (`tape-kick.wav` is "tape kick");
 *  - the **duration**, channel count and **waveform** come from decoding it,
 *    which is also the proof it is playable: a file the browser cannot decode
 *    is refused here, before anything is uploaded, so an import never leaves an
 *    unplayable sound behind;
 *  - the **sample rate** comes from a WAV header (a decoder resamples, so the
 *    decoded rate is the context's, not the file's); other formats leave it
 *    unknown;
 *  - the **source tempo** comes from the filename (`break-174bpm.wav`), the way
 *    sample packs label loops; a file that states one is a loop;
 *  - the **family and role** are a guess from words in the name ("kick",
 *    "snare", "riser"), falling back on the length, so a sound lands somewhere
 *    on the shelf rather than nowhere.
 *
 * The decoder is injected, so all of this is testable without Web Audio.
 */

/** The parts of an `AudioBuffer` analysis reads. */
export interface DecodedAudio {
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** Decodes a file's bytes, rejecting when they are not audio it can play. */
export type AudioDecoder = (bytes: ArrayBuffer) => Promise<DecodedAudio>;

export interface SoundAnalysis {
  readonly name: string;
  readonly type: "one-shot" | "loop";
  readonly family: string;
  readonly role: string;
  readonly durationSeconds: number;
  readonly sampleRate: number | null;
  readonly channelCount: number;
  readonly bpm: number | null;
  readonly peaks: readonly number[] | null;
}

/** Thrown when a file decodes to nothing playable. */
export class UndecodableAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndecodableAudioError";
  }
}

/** A sound's name from its filename: no extension, no separators, at most 120 characters. */
export function soundNameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const name = stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return name === "" ? "Untitled sound" : name;
}

/** The tempo a filename states (`loop 128bpm`, `break_174_BPM`), within 40-300. */
export function bpmFromFileName(fileName: string): number | null {
  const match = /(?:^|[^0-9])(\d{2,3})\s*[_ -]?\s*bpm/i.exec(fileName);
  if (!match) return null;
  const bpm = Number(match[1]);
  return bpm >= 40 && bpm <= 300 ? bpm : null;
}

/** The sample rate and channel count a RIFF/WAVE header declares, if it is one. */
export function wavFormat(
  bytes: ArrayBuffer,
): { sampleRate: number; channelCount: number } | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes);
  const tag = (offset: number) =>
    String.fromCharCode(...new Uint8Array(bytes, offset, 4).values());
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    if (tag(offset) === "fmt " && offset + 16 <= bytes.byteLength) {
      const channelCount = view.getUint16(offset + 10, true);
      const sampleRate = view.getUint32(offset + 12, true);
      return sampleRate > 0 && channelCount > 0 ? { sampleRate, channelCount } : null;
    }
    // Chunks are word-aligned: an odd size carries a pad byte.
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * A waveform preview in the manifest's shape: {@link WAVEFORM_PEAK_COUNT}
 * bins of the loudest absolute sample across every channel, normalised so the
 * loudest bin is 255. `null` for silence, which has no shape to draw.
 */
export function waveformPeaks(audio: DecodedAudio): number[] | null {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  const length = channels[0]?.length ?? 0;
  if (length === 0) return null;
  const bins = new Array<number>(WAVEFORM_PEAK_COUNT).fill(0);
  for (let bin = 0; bin < WAVEFORM_PEAK_COUNT; bin += 1) {
    const start = Math.floor((bin * length) / WAVEFORM_PEAK_COUNT);
    const end = Math.max(
      start + 1,
      Math.floor(((bin + 1) * length) / WAVEFORM_PEAK_COUNT),
    );
    for (const data of channels) {
      for (let index = start; index < end && index < length; index += 1) {
        const value = Math.abs(data[index]);
        if (value > bins[bin]) bins[bin] = value;
      }
    }
  }
  const loudest = Math.max(...bins);
  if (loudest === 0) return null;
  return bins.map((value) => Math.round((value / loudest) * 255));
}

/** Words in a name, and the shelf place each suggests, first match wins. */
const ROLE_WORDS: readonly [RegExp, string, string][] = [
  [/\b(kick|bd|bassdrum)\b/, "drums", "kick"],
  [/\b(snare|sd|snr)\b/, "drums", "snare"],
  [/\b(clap|clp)\b/, "drums", "clap"],
  [/\b(rim|rimshot)\b/, "drums", "rim"],
  [/\b(open ?hat|oh|ohh)\b/, "drums", "open-hat"],
  [/\b(hat|hihat|hh|chh|ch)\b/, "drums", "closed-hat"],
  [/\b(crash|ride|cymbal|cym)\b/, "drums", "cymbal"],
  [/\b(tom)\b/, "drums", "tom"],
  [/\b(perc|shaker|tamb|conga|bongo|cowbell)\b/, "drums", "percussion"],
  [/\b(sub|808)\b/, "bass", "sub"],
  [/\b(bass|reese)\b/, "bass", "sustained"],
  [/\b(chord|chords)\b/, "tonal", "chord"],
  [/\b(stab)\b/, "tonal", "stab"],
  [/\b(pluck)\b/, "tonal", "pluck"],
  [/\b(piano|key|keys|rhodes)\b/, "tonal", "key"],
  [/\b(bell|bells)\b/, "tonal", "bell"],
  [/\b(riser|rise|uplifter)\b/, "fx", "riser"],
  [/\b(downer|downlifter)\b/, "fx", "downer"],
  [/\b(sweep)\b/, "fx", "sweep"],
  [/\b(impact|hit|boom)\b/, "fx", "impact"],
  [/\b(reverse|rev)\b/, "fx", "reverse"],
  [/\b(glitch)\b/, "fx", "glitch"],
  [/\b(noise)\b/, "texture", "noise"],
  [/\b(drone)\b/, "texture", "drone"],
  [/\b(ambience|ambient|atmos|room|tone|field)\b/, "texture", "ambience"],
];

/** Where an imported sound sits on the shelf: a family and a role. */
export function guessShelfPlace(
  name: string,
  type: "one-shot" | "loop",
  durationSeconds: number,
): { family: string; role: string } {
  if (type === "loop") return { family: "loop", role: "full-loop" };
  const words = name.toLowerCase();
  for (const [pattern, family, role] of ROLE_WORDS) {
    if (pattern.test(words)) return { family, role };
  }
  // Nothing in the name: a short hit is percussion, anything longer a texture.
  return durationSeconds < 1
    ? { family: "drums", role: "percussion" }
    : { family: "texture", role: "organic" };
}

/** Read everything an import records about one file. */
export async function analyseSound(
  file: { readonly name: string; arrayBuffer(): Promise<ArrayBuffer> },
  decode: AudioDecoder,
): Promise<SoundAnalysis> {
  const bytes = await file.arrayBuffer();
  // Read the header before decoding: a decoder may detach the buffer it is given.
  const format = wavFormat(bytes);
  let audio: DecodedAudio;
  try {
    audio = await decode(bytes.slice(0));
  } catch (error) {
    throw new UndecodableAudioError(
      error instanceof Error ? error.message : "The file could not be decoded",
    );
  }
  if (!(audio.duration > 0)) {
    throw new UndecodableAudioError("The file decoded to no audio");
  }
  const name = soundNameFromFile(file.name);
  const bpm = bpmFromFileName(file.name);
  const type = bpm !== null ? "loop" : "one-shot";
  return {
    name,
    type,
    ...guessShelfPlace(name, type, audio.duration),
    durationSeconds: audio.duration,
    sampleRate: format?.sampleRate ?? null,
    // A project's asset is mono or stereo; a multichannel file plays as stereo.
    channelCount: Math.min(2, format?.channelCount ?? audio.numberOfChannels),
    bpm,
    peaks: waveformPeaks(audio),
  };
}

/**
 * The browser's decoder. An `OfflineAudioContext` decodes without starting
 * audio output, so analysing a file needs no user gesture and plays nothing.
 */
export const webAudioDecoder: AudioDecoder = async (bytes) => {
  const context = new OfflineAudioContext(1, 1, 44_100);
  return context.decodeAudioData(bytes);
};
