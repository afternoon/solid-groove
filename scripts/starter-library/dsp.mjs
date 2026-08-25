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
