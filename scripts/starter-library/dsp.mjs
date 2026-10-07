// Deterministic DSP primitives for the synthesized starter library.
//
// Everything here is a pure function of its arguments plus an explicitly
// passed RNG. Nothing reads `Math.random()`, `Date.now()`, or global state, so
// rendering the catalogue twice produces byte-identical WAV files and stable
// SHA-256 asset keys (docs/sample-library.md sections 9 and 10).

export const SAMPLE_RATE = 48000;

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

// mulberry32: small, fast, well-distributed, and trivially reproducible across
// runs and platforms. Seeds come from the catalogue so each asset's noise is
// stable but different from its neighbours'.
export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministically derive a numeric seed from a string so an asset ID alone
// fixes its noise.
export function seedFromString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Bipolar white noise in [-1, 1). */
export function white(rng) {
  return rng() * 2 - 1;
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

export function seconds(count) {
  return Math.max(1, Math.round(count * SAMPLE_RATE));
}

export function silence(length) {
  return new Float32Array(length);
}

/** Add `source` into `target` at `offset`, scaled by `gain`. Clips nothing. */
export function mixInto(target, source, offset = 0, gain = 1) {
  const start = Math.max(0, Math.round(offset));
  const count = Math.min(source.length, target.length - start);
  for (let i = 0; i < count; i++) target[start + i] += source[i] * gain;
  return target;
}

/** Sum equal-length buffers with per-buffer gains. */
export function mix(layers) {
  const length = layers.reduce((max, l) => Math.max(max, l.buffer.length), 0);
  const out = new Float32Array(length);
  for (const layer of layers) {
    mixInto(out, layer.buffer, layer.offset ?? 0, layer.gain ?? 1);
  }
  return out;
}

export function reverse(buffer) {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[buffer.length - 1 - i];
  return out;
}

export function gain(buffer, amount) {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] * amount;
  return out;
}

/** Peak magnitude, or 0 for an empty/silent buffer. */
export function peak(buffer) {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const value = Math.abs(buffer[i]);
    if (value > max) max = value;
  }
  return max;
}

export function rms(buffer) {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/**
 * Exponential-ish decay envelope value at time `t`.
 *
 * `curve` > 1 bends the contour towards a sharper initial drop, which is what
 * makes a synthesized kick or tom read as percussive rather than as a fading
 * sine.
 */
export function decayAt(t, decay, curve = 1) {
  if (decay <= 0) return 0;
  const linear = Math.max(0, 1 - t / decay);
  return curve === 1 ? linear ** 2 : linear ** (2 * curve);
}

/** Attack/decay envelope. `attack` is a short linear ramp that kills clicks. */
export function adAt(t, attack, decay, curve = 1) {
  if (t < attack) return attack <= 0 ? 1 : t / attack;
  return decayAt(t - attack, decay, curve);
}

/** Exponential parameter sweep from `from` to `to` with time constant `tau`. */
export function sweepAt(t, from, to, tau) {
  if (tau <= 0) return to;
  return to + (from - to) * Math.exp(-t / tau);
}

/** Short raised-cosine fades that remove boundary clicks without softening transients. */
export function applyFades(buffer, attackSeconds = 0.0005, releaseSeconds = 0.004) {
  const attack = Math.min(Math.floor(attackSeconds * SAMPLE_RATE), buffer.length);
  const release = Math.min(
    Math.floor(releaseSeconds * SAMPLE_RATE),
    buffer.length - attack,
  );
  for (let i = 0; i < attack; i++) {
    buffer[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / attack);
  }
  for (let i = 0; i < release; i++) {
    const index = buffer.length - 1 - i;
    buffer[index] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / release);
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------

// Band-limited saw/square built by additive synthesis. Naive ramp/step shapes
// alias badly at the frequencies these one-shots use, and aliasing reads as
// cheap digital grit rather than as the intended tone.
function harmonicCount(frequency) {
  return Math.max(1, Math.floor(SAMPLE_RATE / 2 / Math.max(frequency, 1)) - 1);
}

export function sine(phase) {
  return Math.sin(2 * Math.PI * phase);
}

export function triangle(phase) {
  const x = phase - Math.floor(phase);
  return 4 * Math.abs(x - 0.5) - 1;
}

export function saw(phase, frequency) {
  const limit = Math.min(harmonicCount(frequency), 64);
  let sum = 0;
  for (let h = 1; h <= limit; h++) sum += Math.sin(2 * Math.PI * h * phase) / h;
  return (2 / Math.PI) * sum;
}

export function square(phase, frequency) {
  const limit = Math.min(harmonicCount(frequency), 64);
  let sum = 0;
  for (let h = 1; h <= limit; h += 2) sum += Math.sin(2 * Math.PI * h * phase) / h;
  return (4 / Math.PI) * sum;
}

const WAVEFORMS = { sine, triangle, saw, square };

/**
 * Render an oscillator whose frequency and amplitude are supplied per sample.
 * Phase is integrated rather than computed from `t`, so frequency sweeps stay
 * continuous and click-free.
 */
export function oscillate(
  length,
  { waveform = "sine", frequencyAt, amplitudeAt, phase = 0 },
) {
  const shape = WAVEFORMS[waveform];
  if (!shape) throw new Error(`unknown waveform: ${waveform}`);
  const out = new Float32Array(length);
  let running = phase;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const frequency = frequencyAt(t, i);
    const value =
      waveform === "saw" || waveform === "square"
        ? shape(running, frequency)
        : shape(running);
    out[i] = value * amplitudeAt(t, i);
    running += frequency / SAMPLE_RATE;
    if (running > 1) running -= Math.floor(running);
  }
  return out;
}

/**
 * Two-operator FM. The modulator has its own decaying index, which is what
 * gives bells, metallic percussion, and growl tones their moving spectrum.
 */
export function fm(length, { carrier, ratio, indexAt, amplitudeAt }) {
  const out = new Float32Array(length);
  let carrierPhase = 0;
  let modulatorPhase = 0;
  const modulator = carrier * ratio;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const modulation = Math.sin(2 * Math.PI * modulatorPhase) * indexAt(t);
    out[i] = Math.sin(2 * Math.PI * carrierPhase + modulation) * amplitudeAt(t);
    carrierPhase += carrier / SAMPLE_RATE;
    modulatorPhase += modulator / SAMPLE_RATE;
    if (carrierPhase > 1) carrierPhase -= Math.floor(carrierPhase);
    if (modulatorPhase > 1) modulatorPhase -= Math.floor(modulatorPhase);
  }
  return out;
}

/**
 * Modal (resonant partial) synthesis: a bank of decaying sines at explicit
 * inharmonic ratios. This is the workhorse for struck-object sounds — bells,
 * glass, wood, metal, stone — where a plain oscillator sounds synthetic.
 */
export function modal(length, { fundamental, partials, amplitudeAt = () => 1 }) {
  const out = new Float32Array(length);
  for (const partial of partials) {
    const frequency = fundamental * partial.ratio;
    if (frequency >= SAMPLE_RATE / 2) continue;
    const step = (2 * Math.PI * frequency) / SAMPLE_RATE;
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      out[i] += Math.sin(step * i) * partial.gain * Math.exp(-t / partial.decay);
    }
  }
  for (let i = 0; i < length; i++) out[i] *= amplitudeAt(i / SAMPLE_RATE);
  return out;
}

/**
 * Karplus-Strong plucked string / struck bar. `damping` controls how fast the
 * high partials disappear; `blend` below 1 makes the tone progressively noisier
 * and less pitched, which is how the wood and stone hits are built.
 */
export function pluck(length, { frequency, decay, damping = 0.5, blend = 1, rng }) {
  const delay = Math.max(2, Math.round(SAMPLE_RATE / frequency));
  const line = new Float32Array(delay);
  for (let i = 0; i < delay; i++) line[i] = white(rng);
  const out = new Float32Array(length);
  const feedback = 10 ** (-3 / (decay * frequency));
  let index = 0;
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const current = line[index];
    out[i] = current;
    const filtered = current * (1 - damping) + previous * damping;
    previous = filtered;
    const sign = blend >= 1 || rng() < blend ? 1 : -1;
    line[index] = filtered * feedback * sign;
    index = (index + 1) % delay;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Noise sources
// ---------------------------------------------------------------------------

export function whiteNoise(length, rng, amplitudeAt = () => 1) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = white(rng) * amplitudeAt(i / SAMPLE_RATE);
  return out;
}

/** Paul Kellet's pink-noise approximation: cheap, stable, and close enough. */
export function pinkNoise(length, rng, amplitudeAt = () => 1) {
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = white(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    out[i] = pink * 0.11 * amplitudeAt(i / SAMPLE_RATE);
  }
  return out;
}

/**
 * The classic six-square-oscillator metallic source behind 606/808/909 hats and
 * cymbals. Inharmonic ratios are what stop it sounding like a chord.
 */
export function metallic(length, { fundamental = 40, ratios, amplitudeAt }) {
  const set = ratios ?? [2, 3, 4.16, 5.43, 6.79, 8.21];
  const out = new Float32Array(length);
  const phases = new Float32Array(set.length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let s = 0; s < set.length; s++) {
      const frequency = fundamental * set[s];
      if (frequency >= SAMPLE_RATE / 2) continue;
      sum += phases[s] < 0.5 ? 1 : -1;
      phases[s] += frequency / SAMPLE_RATE;
      if (phases[s] > 1) phases[s] -= Math.floor(phases[s]);
    }
    out[i] = (sum / set.length) * amplitudeAt(i / SAMPLE_RATE);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

// RBJ biquads. `cutoffAt` is per-sample so filter sweeps (risers, downers,
// resonant zaps) come from the same primitive as static filtering.
function biquad(buffer, kind, cutoffAt, q) {
  const out = new Float32Array(buffer.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < buffer.length; i++) {
    const cutoff = Math.min(Math.max(cutoffAt(i / SAMPLE_RATE), 10), SAMPLE_RATE * 0.48);
    const w0 = (2 * Math.PI * cutoff) / SAMPLE_RATE;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0;
    let b1;
    let b2;
    if (kind === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    } else if (kind === "highpass") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    const x0 = buffer[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

function asCutoffFn(cutoff) {
  return typeof cutoff === "function" ? cutoff : () => cutoff;
}

export function lowpass(buffer, cutoff, q = Math.SQRT1_2) {
  return biquad(buffer, "lowpass", asCutoffFn(cutoff), q);
}

export function highpass(buffer, cutoff, q = Math.SQRT1_2) {
  return biquad(buffer, "highpass", asCutoffFn(cutoff), q);
}

export function bandpass(buffer, cutoff, q = 1) {
  return biquad(buffer, "bandpass", asCutoffFn(cutoff), q);
}

/** Remove DC offset — required by docs/sample-library.md section 10. */
export function removeDcOffset(buffer) {
  const out = new Float32Array(buffer.length);
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buffer.length; i++) {
    const y = buffer[i] - x1 + 0.995 * y1;
    x1 = buffer[i];
    y1 = y;
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saturation and destruction
// ---------------------------------------------------------------------------

export function saturate(buffer, drive) {
  const out = new Float32Array(buffer.length);
  const normalize = Math.tanh(drive);
  for (let i = 0; i < buffer.length; i++) {
    out[i] = Math.tanh(buffer[i] * drive) / (normalize || 1);
  }
  return out;
}

export function fold(buffer, amount) {
  const out = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let value = buffer[i] * amount;
    for (let pass = 0; pass < 4; pass++) {
      if (value > 1) value = 2 - value;
      else if (value < -1) value = -2 - value;
      else break;
    }
    out[i] = value;
  }
  return out;
}

export function bitcrush(buffer, bits, downsample = 1) {
  const out = new Float32Array(buffer.length);
  const levels = 2 ** (bits - 1);
  let held = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (i % downsample === 0) held = Math.round(buffer[i] * levels) / levels;
    out[i] = held;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

/**
 * Schroeder reverb: four parallel combs into two series allpasses. Small and
 * unglamorous, but it is only used to give impacts, ambience, and drones a
 * sense of size — the product's real reverbs are runtime devices.
 */
export function reverb(
  buffer,
  { time = 1.2, mix: wet = 0.3, damping = 0.4, predelay = 0 } = {},
) {
  const combDelays = [1557, 1617, 1491, 1422];
  const allpassDelays = [225, 556];
  const tail = Math.round(time * SAMPLE_RATE);
  const offset = Math.round(predelay * SAMPLE_RATE);
  const length = buffer.length + tail + offset;
  const input = new Float32Array(length);
  for (let i = 0; i < buffer.length; i++) input[i + offset] = buffer[i];

  let wetSignal = new Float32Array(length);
  for (const delay of combDelays) {
    const line = new Float32Array(delay);
    const feedback = 10 ** ((-3 * delay) / (time * SAMPLE_RATE));
    let index = 0;
    let store = 0;
    for (let i = 0; i < length; i++) {
      const delayed = line[index];
      wetSignal[i] += delayed / combDelays.length;
      store = delayed * (1 - damping) + store * damping;
      line[index] = input[i] + store * feedback;
      index = (index + 1) % delay;
    }
  }
  for (const delay of allpassDelays) {
    const line = new Float32Array(delay);
    const next = new Float32Array(length);
    let index = 0;
    for (let i = 0; i < length; i++) {
      const delayed = line[index];
      const value = -wetSignal[i] + delayed;
      line[index] = wetSignal[i] + delayed * 0.5;
      next[i] = value;
      index = (index + 1) % delay;
    }
    wetSignal = next;
  }

  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = input[i] * (1 - wet) + wetSignal[i] * wet;
  }
  return out;
}

/** Feedback delay, used for dub-style tails and rhythmic transition effects. */
export function delay(
  buffer,
  { time = 0.25, feedback = 0.4, mix: wet = 0.3, repeats = 8 } = {},
) {
  const step = Math.round(time * SAMPLE_RATE);
  const length = buffer.length + step * repeats;
  const out = new Float32Array(length);
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] * (1 - wet);
  let amount = wet;
  for (let repeat = 1; repeat <= repeats; repeat++) {
    mixInto(out, buffer, step * repeat, amount);
    amount *= feedback;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output conditioning
// ---------------------------------------------------------------------------

/**
 * Scale to a target peak.
 *
 * Deliberately *not* loudness normalization: docs/sample-library.md section 10
 * rejects brick-walling the collection. This only sets a sane audition level
 * and guarantees headroom, leaving each sound's own dynamics intact.
 */
export function normalizePeak(buffer, targetDbfs = -1) {
  const current = peak(buffer);
  if (current === 0) return buffer;
  const target = 10 ** (targetDbfs / 20);
  return gain(buffer, target / current);
}

/** Trim trailing near-silence so tails are intentional rather than accidental. */
export function trimTail(buffer, thresholdDbfs = -72, minimumSeconds = 0.02) {
  const threshold = 10 ** (thresholdDbfs / 20);
  let end = buffer.length;
  while (end > 0 && Math.abs(buffer[end - 1]) < threshold) end--;
  const minimum = seconds(minimumSeconds);
  const length = Math.max(minimum, Math.min(buffer.length, end + seconds(0.005)));
  return buffer.subarray(0, length).slice();
}

export function dbfs(amplitude) {
  return amplitude <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(amplitude);
}

// ---------------------------------------------------------------------------
// Loudness (ITU-R BS.1770-4)
// ---------------------------------------------------------------------------

/** BS.1770 gating block length and hop: 400 ms blocks, 75% overlap. */
export const LOUDNESS_BLOCK_SECONDS = 0.4;
const LOUDNESS_HOP_SECONDS = 0.1;
/** BS.1770 absolute gate, in LUFS. */
const ABSOLUTE_GATE_LUFS = -70;
/** BS.1770 relative gate, in LU below the absolute-gated loudness. */
const RELATIVE_GATE_LU = 10;

/**
 * The two K-weighting biquads (a high shelf modelling the head, then the RLB
 * high-pass), designed for any sample rate. These are the analogue prototypes
 * libebur128 and pyloudnorm use; at 48 kHz they reproduce BS.1770's published
 * coefficients to better than 1e-8.
 */
function kWeightingStages(sampleRate) {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };

  const highK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const highQ = 0.5003270373238773;
  const highA0 = 1 + highK / highQ + highK * highK;
  const highPass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (highK * highK - 1)) / highA0,
    a2: (1 - highK / highQ + highK * highK) / highA0,
  };
  return [shelf, highPass];
}

function applyBiquad(input, { b0, b1, b2, a1, a2 }) {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/** K-weight one channel (BS.1770 section 2.1). Exported for its tests. */
export function kWeight(channel, sampleRate = SAMPLE_RATE) {
  const [shelf, highPass] = kWeightingStages(sampleRate);
  return applyBiquad(applyBiquad(channel, shelf), highPass);
}

function blockLoudness(meanSquare) {
  return -0.691 + 10 * Math.log10(meanSquare);
}

/**
 * Integrated loudness in LUFS, per ITU-R BS.1770-4: K-weighting, 400 ms blocks
 * at 75% overlap, the -70 LUFS absolute gate, then the relative gate 10 LU
 * below the loudness of the blocks that passed it. Every channel is weighted
 * 1.0 — the library only holds mono and stereo (L/R), and BS.1770 gives
 * neither a surround weight — and a mono file is measured as one channel, not
 * as a dual-mono pair, so a mono master reads 3 LU quieter than the same
 * signal copied to both sides. That matches how the sampler plays it.
 *
 * **One deliberate extension.** BS.1770 is defined over programme material,
 * and many one-shots (a hat, a rim, a short kick) are shorter than one 400 ms
 * block, so the standard yields no measurement at all for them. A sound
 * shorter than one block is measured as a single block of its own length,
 * still under both gates. That is the honest reading for an audition level —
 * how loud the hit is while it sounds — but it is not a BS.1770 figure, and
 * the docs say so (sample-library section 10).
 *
 * @param {Float32Array | Float32Array[]} samples  Mono, or one array per channel.
 * @returns {number | null}  LUFS, or `null` when every block is gated out
 *   (silence, or material below -70 LUFS throughout).
 */
export function integratedLoudness(samples, sampleRate = SAMPLE_RATE) {
  const channels = ArrayBuffer.isView(samples) ? [samples] : samples;
  const frames = channels[0]?.length ?? 0;
  if (frames === 0) return null;
  const weighted = channels.map((channel) => kWeight(channel, sampleRate));

  const blockFrames = Math.round(LOUDNESS_BLOCK_SECONDS * sampleRate);
  const hopFrames = Math.round(LOUDNESS_HOP_SECONDS * sampleRate);
  const starts = [];
  if (frames < blockFrames) {
    starts.push(0);
  } else {
    for (let start = 0; start + blockFrames <= frames; start += hopFrames) {
      starts.push(start);
    }
  }
  const length = Math.min(blockFrames, frames);

  // One mean square per block, summed across channels (all weights 1.0).
  const blocks = starts.map((start) => {
    let sum = 0;
    for (const channel of weighted) {
      let channelSum = 0;
      for (let i = start; i < start + length; i++) channelSum += channel[i] * channel[i];
      sum += channelSum / length;
    }
    return sum;
  });

  const meanOf = (values) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const absolute = blocks.filter(
    (meanSquare) => meanSquare > 0 && blockLoudness(meanSquare) > ABSOLUTE_GATE_LUFS,
  );
  if (absolute.length === 0) return null;
  const relativeGate = blockLoudness(meanOf(absolute)) - RELATIVE_GATE_LU;
  const gated = absolute.filter((meanSquare) => blockLoudness(meanSquare) > relativeGate);
  return blockLoudness(meanOf(gated));
}

// ---------------------------------------------------------------------------
// Pitch (tuning audit)
// ---------------------------------------------------------------------------

/**
 * YIN's aperiodicity (its cumulative-mean-normalized difference at the chosen
 * lag) at or above which a frame is not periodic enough to trust. 0.1 is the
 * strict end of the range the YIN paper discusses: a harmonic tone sits far
 * below it, while an inharmonic bell or a modal struck bar — whose partials
 * share no common period — sits above it, and is reported undetectable rather
 * than given a pitch it does not have.
 */
export const PITCH_MAX_APERIODICITY = 0.1;
/** Fewest confident frames a settled pitch is read from. */
const PITCH_MIN_FRAMES = 3;
/** Most analysis frames per sound, spread over the span analysed. */
const PITCH_MAX_FRAMES = 24;
/** Analysis starts this long after the peak, past the attack transient. */
const PITCH_SKIP_SECONDS = 0.02;
/** And covers at most this much of the sound: a pitch is settled well before. */
const PITCH_SPAN_SECONDS = 3;
/** How far either side of the declared root the lag search reaches, in octaves. */
const PITCH_SEARCH_OCTAVES = 1.1;
/**
 * A settled stretch whose two halves differ by more than this many cents is
 * still gliding (a tom or a tuned bass whose pitch envelope has not finished
 * falling), so it has no single pitch to judge.
 */
export const PITCH_GLIDE_CENTS = 20;

/**
 * A dip this much deeper than the chosen one, at a lag that is not a whole
 * multiple of it, is the true period, and the chosen one was a fraction of it.
 */
const SUBHARMONIC_DEPTH_RATIO = 0.5;
/** How close to a whole number a lag ratio must be to count as a multiple. */
const SUBHARMONIC_MULTIPLE_TOLERANCE = 0.1;

/**
 * The subharmonic check on YIN's first-dip choice. When an upper harmonic
 * dominates the fundamental (a 3rd harmonic 12 dB over it, say), the signal
 * nearly repeats at a fraction of its period — 2/3 of it for the 3rd — and that
 * dip can fall under the threshold before the true period's does, reading a
 * fifth sharp. At the true period every partial lines up, so its dip is far
 * deeper. Walking the later dips, one at a lag that is not a whole multiple of
 * the current choice (a whole multiple is the same period again) and at most
 * half as aperiodic replaces it.
 */
function subharmonicCheck(normalized, dips) {
  let best = dips[0];
  for (const lag of dips.slice(1)) {
    const ratio = lag / best;
    const multiple = Math.abs(ratio - Math.round(ratio)) < SUBHARMONIC_MULTIPLE_TOLERANCE;
    if (!multiple && normalized[lag] < normalized[best] * SUBHARMONIC_DEPTH_RATIO) {
      best = lag;
    }
  }
  return best;
}

/** One YIN estimate (de Cheveigné and Kawahara, 2002) at `start`. */
function yinFrame(signal, start, windowFrames, minLag, maxLag) {
  const difference = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let j = 0; j < windowFrames; j++) {
      const delta = signal[start + j] - signal[start + j + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }
  const normalized = new Float64Array(maxLag + 2);
  normalized[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    running += difference[lag];
    normalized[lag] = running > 0 ? (difference[lag] * lag) / running : 1;
  }
  // Every dip under the threshold, each followed to its floor. YIN takes the
  // first, subject to the subharmonic check; failing any dip, the global
  // minimum (whose aperiodicity then marks the frame untrusted).
  const dips = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] >= PITCH_MAX_APERIODICITY) continue;
    while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag++;
    dips.push(lag);
    while (lag + 1 <= maxLag && normalized[lag + 1] < PITCH_MAX_APERIODICITY) lag++;
  }
  let best = dips.length > 0 ? subharmonicCheck(normalized, dips) : -1;
  if (best < 0) {
    let lowest = Number.POSITIVE_INFINITY;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (normalized[lag] < lowest) {
        lowest = normalized[lag];
        best = lag;
      }
    }
  }
  // Parabolic interpolation around the chosen lag, for sub-sample precision.
  const before = normalized[best - 1];
  const at = normalized[best];
  const after = normalized[best + 1];
  const curvature = before - 2 * at + after;
  const offset = curvature > 0 ? (0.5 * (before - after)) / curvature : 0;
  return { lag: best + offset, aperiodicity: at };
}

/** Cents of `hz` above `referenceHz`, folded to the nearest octave: (-600, 600]. */
function foldedCents(hz, referenceHz) {
  const cents = 1200 * Math.log2(hz / referenceHz);
  const folded = cents - 1200 * Math.round(cents / 1200);
  return folded <= -600 ? folded + 1200 : folded;
}

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Measure how far a sound's settled pitch sits from the root it declares.
 *
 * YIN runs over up to 24 frames from just after the peak, searching lags within
 * 1.1 octaves of the declared root. Only frames under `PITCH_MAX_APERIODICITY`
 * count, and the pitch is read from the later half of those — the settled
 * pitch, after any designed pitch drop — so a tom is judged where it rings,
 * not where its envelope starts. The result is folded to the nearest octave:
 * tuning is the cents correction a sampler applies, and a periodicity detector
 * cannot tell a note from its octave reliably enough to judge the octave the
 * catalogue declares.
 *
 * @param {Float32Array | Float32Array[]} samples  Mono, or one array per channel (summed).
 * @returns {{ status: "detected" | "undetectable" | "gliding", cents: number | null }}
 *   `cents` is the settled pitch's offset from the root, rounded to a cent,
 *   when `status` is `"detected"`; otherwise `null`. An unpitched, inharmonic,
 *   or too-short sound is `"undetectable"`, and one whose pitch is still
 *   moving is `"gliding"`. Neither is a tuning fault.
 */
export function measureTuning(samples, rootHz, sampleRate = SAMPLE_RATE) {
  const channels = ArrayBuffer.isView(samples) ? [samples] : samples;
  const frames = channels[0]?.length ?? 0;
  const signal = new Float32Array(frames);
  for (const channel of channels) {
    for (let i = 0; i < frames; i++) signal[i] += channel[i] / channels.length;
  }

  const minLag = Math.max(
    2,
    Math.floor(sampleRate / (rootHz * 2 ** PITCH_SEARCH_OCTAVES)),
  );
  const maxLag = Math.ceil(sampleRate / (rootHz / 2 ** PITCH_SEARCH_OCTAVES));
  const windowFrames = Math.max(1024, maxLag);

  let peakIndex = 0;
  for (let i = 0; i < frames; i++) {
    if (Math.abs(signal[i]) > Math.abs(signal[peakIndex])) peakIndex = i;
  }
  const first = peakIndex + Math.round(PITCH_SKIP_SECONDS * sampleRate);
  const last = Math.min(
    frames - windowFrames - maxLag - 2,
    peakIndex + Math.round(PITCH_SPAN_SECONDS * sampleRate),
  );
  const undetectable = { status: "undetectable", cents: null };
  if (last < first) return undetectable;
  const hop = Math.max(
    Math.floor(windowFrames / 2),
    Math.ceil((last - first) / (PITCH_MAX_FRAMES - 1)),
  );

  const confident = [];
  for (let start = first; start <= last; start += hop) {
    const { lag, aperiodicity } = yinFrame(signal, start, windowFrames, minLag, maxLag);
    if (aperiodicity < PITCH_MAX_APERIODICITY) {
      confident.push(foldedCents(sampleRate / lag, rootHz));
    }
  }
  if (confident.length < PITCH_MIN_FRAMES) return undetectable;

  // The later half is the settled pitch. Unwrap it around its first frame so a
  // pitch sitting near the ±600 fold does not read as a jump.
  const settled = confident.slice(
    Math.min(Math.floor(confident.length / 2), confident.length - PITCH_MIN_FRAMES),
  );
  const unwrapped = settled.map(
    (cents) => cents - 1200 * Math.round((cents - settled[0]) / 1200),
  );
  const half = Math.floor(unwrapped.length / 2);
  const drift = Math.abs(
    medianOf(unwrapped.slice(0, half || 1)) - medianOf(unwrapped.slice(half)),
  );
  if (drift > PITCH_GLIDE_CENTS) return { status: "gliding", cents: null };

  const cents = foldedCents(rootHz * 2 ** (medianOf(unwrapped) / 1200), rootHz);
  // `+ 0` turns a rounded -0 into 0, so the manifest never records "-0".
  return { status: "detected", cents: Math.round(cents) + 0 };
}
