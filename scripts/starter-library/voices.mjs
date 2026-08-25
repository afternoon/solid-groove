// The voice bank: one renderer per family of sound.
//
// Each voice takes a plain parameter object and a seeded RNG and returns mono
// float samples. Variation across the catalogue comes from parameters, not from
// forked copies of a renderer, so the "no more than 20% near-identical
// variations" rule (docs/sample-library.md section 6.4) can be reasoned about
// from the catalogue rather than from the code.

import {
  adAt,
  applyFades,
  bandpass,
  bitcrush,
  decayAt,
  delay,
  fm,
  fold,
  highpass,
  lowpass,
  metallic,
  mix,
  modal,
  normalizePeak,
  oscillate,
  pinkNoise,
  pluck,
  removeDcOffset,
  reverb,
  reverse,
  saturate,
  seconds,
  sweepAt,
  trimTail,
  white,
  whiteNoise,
} from "./dsp.mjs";
import { chordFrequencies, noteToFrequency } from "./music.mjs";

// A very short noise burst. Every percussive voice uses one for its attack —
// it is what makes a hit cut through a mix on small speakers.
function click(length, rng, { amount = 0.5, decay = 0.002, cutoff = 3000 } = {}) {
  const burst = whiteNoise(length, rng, (t) =>
    t < decay ? (1 - t / decay) * amount : 0,
  );
  return highpass(burst, cutoff);
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

function kick(
  {
    startHz = 130,
    endHz = 48,
    pitchTau = 0.03,
    decay = 0.45,
    curve = 1.2,
    drive = 1,
    clickAmount = 0.4,
    clickCutoff = 2000,
    bodyWaveform = "sine",
    noiseTail = 0,
  },
  rng,
) {
  const length = seconds(decay + 0.15);
  const body = oscillate(length, {
    waveform: bodyWaveform,
    frequencyAt: (t) => sweepAt(t, startHz, endHz, pitchTau),
    amplitudeAt: (t) => adAt(t, 0.001, decay, curve),
  });
  const layers = [
    { buffer: body, gain: 1 },
    {
      buffer: click(length, rng, { amount: clickAmount, cutoff: clickCutoff }),
      gain: 1,
    },
  ];
  if (noiseTail > 0) {
    const tail = lowpass(
      pinkNoise(length, rng, (t) => decayAt(t, decay * 0.7, 1.6)),
      400,
    );
    layers.push({ buffer: tail, gain: noiseTail });
  }
  return drive > 1 ? saturate(mix(layers), drive) : mix(layers);
}

function snare(
  {
    toneHz = 180,
    toneRatio = 1.48,
    toneDecay = 0.12,
    noiseDecay = 0.18,
    noiseHighpass = 800,
    noiseLowpass = 9000,
    noiseGain = 0.9,
    toneGain = 0.7,
    drive = 1,
    room = 0,
  },
  rng,
) {
  const length = seconds(Math.max(toneDecay, noiseDecay) + 0.2);
  const shellA = oscillate(length, {
    waveform: "triangle",
    frequencyAt: (t) => sweepAt(t, toneHz * 1.6, toneHz, 0.012),
    amplitudeAt: (t) => adAt(t, 0.0008, toneDecay, 1.4),
  });
  const shellB = oscillate(length, {
    waveform: "sine",
    frequencyAt: () => toneHz * toneRatio,
    amplitudeAt: (t) => adAt(t, 0.0008, toneDecay * 0.8, 1.6),
  });
  const rattle = lowpass(
    highpass(
      whiteNoise(length, rng, (t) => decayAt(t, noiseDecay, 1.3)),
      noiseHighpass,
    ),
    noiseLowpass,
  );
  const dry = mix([
    { buffer: shellA, gain: toneGain },
    { buffer: shellB, gain: toneGain * 0.5 },
    { buffer: rattle, gain: noiseGain },
  ]);
  const driven = drive > 1 ? saturate(dry, drive) : dry;
  return room > 0 ? reverb(driven, { time: 0.35, mix: room, damping: 0.5 }) : driven;
}

// Four offset noise bursts into a short room. The offsets, not the bursts, are
// what make a clap read as several hands rather than as one noise hit.
function clap(
  {
    spread = 0.011,
    bursts = 4,
    decay = 0.22,
    bandHz = 1400,
    q = 1.1,
    room = 0.25,
    jitter = 0.3,
  },
  rng,
) {
  const length = seconds(decay + 0.3);
  const layers = [];
  for (let i = 0; i < bursts; i++) {
    const isLast = i === bursts - 1;
    const burstDecay = isLast ? decay : 0.012;
    const burst = whiteNoise(length, rng, (t) =>
      decayAt(t, burstDecay, isLast ? 1.4 : 1),
    );
    const offset = seconds(spread * i * (1 + (white(rng) * jitter) / 2));
    layers.push({ buffer: burst, offset, gain: isLast ? 0.9 : 0.7 });
  }
  const shaped = bandpass(mix(layers), bandHz, q);
  return reverb(highpass(shaped, 400), {
    time: 0.28,
    mix: room,
    damping: 0.55,
  });
}

function rim({ toneHz = 420, decay = 0.05, metal = 0.5, drive = 1.4 }, _rng) {
  const length = seconds(decay + 0.08);
  const body = oscillate(length, {
    waveform: "triangle",
    frequencyAt: (t) => sweepAt(t, toneHz * 2.2, toneHz, 0.004),
    amplitudeAt: (t) => adAt(t, 0.0004, decay, 2),
  });
  const edge = metallic(length, {
    fundamental: toneHz * 0.6,
    amplitudeAt: (t) => decayAt(t, decay * 0.7, 2.2),
  });
  return saturate(
    highpass(
      mix([
        { buffer: body, gain: 1 },
        { buffer: edge, gain: metal },
      ]),
      300,
    ),
    drive,
  );
}

function hat(
  {
    decay = 0.05,
    fundamental = 40,
    ratios,
    highpassHz = 7000,
    bandHz = 0,
    noise = 0.25,
    drive = 1,
    curve = 2,
  },
  rng,
) {
  const length = seconds(decay + 0.06);
  const body = metallic(length, {
    fundamental,
    ratios,
    amplitudeAt: (t) => decayAt(t, decay, curve),
  });
  const air = whiteNoise(length, rng, (t) => decayAt(t, decay * 0.8, curve));
  let out = mix([
    { buffer: body, gain: 1 },
    { buffer: air, gain: noise },
  ]);
  out = highpass(out, highpassHz);
  if (bandHz > 0) out = bandpass(out, bandHz, 0.9);
  return drive > 1 ? saturate(out, drive) : out;
}

function cymbal(
  {
    decay = 1.8,
    fundamental = 38,
    ratios,
    highpassHz = 4500,
    shimmer = 0.5,
    room = 0.18,
  },
  rng,
) {
  const length = seconds(decay + 0.5);
  const body = metallic(length, {
    fundamental,
    ratios,
    amplitudeAt: (t) => decayAt(t, decay, 1.5),
  });
  const wash = highpass(
    whiteNoise(length, rng, (t) => decayAt(t, decay * 0.9, 1.2)),
    8000,
  );
  const out = highpass(
    mix([
      { buffer: body, gain: 1 },
      { buffer: wash, gain: shimmer },
    ]),
    highpassHz,
  );
  return reverb(out, { time: 1.1, mix: room, damping: 0.35 });
}

function tom(
  { note = "A1", decay = 0.5, bendRatio = 1.9, noise = 0.12, drive = 1 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.15);
  const body = oscillate(length, {
    waveform: "sine",
    frequencyAt: (t) => sweepAt(t, frequency * bendRatio, frequency, 0.045),
    amplitudeAt: (t) => adAt(t, 0.001, decay, 1.3),
  });
  const skin = bandpass(
    whiteNoise(length, rng, (t) => decayAt(t, 0.03, 1.5)),
    frequency * 6,
    1.2,
  );
  const out = mix([
    { buffer: body, gain: 1 },
    { buffer: skin, gain: noise },
  ]);
  return drive > 1 ? saturate(out, drive) : out;
}

// ---------------------------------------------------------------------------
// Percussion and struck objects
// ---------------------------------------------------------------------------

function shaker(
  { decay = 0.09, grains = 700, bandHz = 6500, q = 1.4, curve = 1.6 },
  rng,
) {
  const length = seconds(decay + 0.05);
  const out = new Float32Array(length);
  // Discrete grains rather than continuous noise: a shaker is many small
  // impacts, and the sparseness is audible.
  const density = grains / length;
  for (let i = 0; i < length; i++) {
    if (rng() < density) out[i] = white(rng);
  }
  const shaped = bandpass(out, bandHz, q);
  const enveloped = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    enveloped[i] = shaped[i] * adAt(i / 48000, 0.002, decay, curve);
  }
  return enveloped;
}

function membrane(
  { note = "D2", decay = 0.35, slap = 0.4, bendRatio = 1.35, tone = 1.6 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.15);
  const body = modal(length, {
    fundamental: frequency,
    partials: [
      { ratio: 1, gain: 1, decay: decay * 0.9 },
      { ratio: tone, gain: 0.45, decay: decay * 0.4 },
      { ratio: tone * 1.9, gain: 0.2, decay: decay * 0.2 },
    ],
  });
  const bend = oscillate(length, {
    waveform: "sine",
    frequencyAt: (t) => sweepAt(t, frequency * bendRatio, frequency, 0.02),
    amplitudeAt: (t) => adAt(t, 0.001, decay * 0.5, 1.5),
  });
  const hand = bandpass(
    whiteNoise(length, rng, (t) => decayAt(t, 0.018, 2)),
    frequency * 9,
    0.8,
  );
  return mix([
    { buffer: body, gain: 0.8 },
    { buffer: bend, gain: 0.5 },
    { buffer: hand, gain: slap },
  ]);
}

// One primitive covers wood, metal, glass, and stone: only the partial ratios,
// decays, and noise content change. Real struck objects differ in exactly those
// terms, so this stays honest rather than being four renamed copies.
const MATERIALS = {
  wood: {
    partials: [1, 2.57, 4.94, 7.2],
    decays: [1, 0.5, 0.28, 0.15],
    noise: 0.35,
    bright: 2200,
  },
  metal: {
    partials: [1, 2.76, 5.4, 8.93, 13.3],
    decays: [1, 0.85, 0.7, 0.5, 0.35],
    noise: 0.12,
    bright: 5200,
  },
  glass: {
    partials: [1, 2.32, 4.25, 6.63, 9.38],
    decays: [1, 0.72, 0.55, 0.4, 0.28],
    noise: 0.18,
    bright: 7000,
  },
  stone: {
    partials: [1, 1.83, 3.11, 4.62],
    decays: [1, 0.34, 0.2, 0.12],
    noise: 0.5,
    bright: 1600,
  },
  membrane: {
    partials: [1, 1.59, 2.14, 2.3, 2.65],
    decays: [1, 0.5, 0.35, 0.3, 0.2],
    noise: 0.4,
    bright: 1800,
  },
};

function struck(
  { material = "wood", note = "C4", decay = 0.4, brightness = 1, noise = 1 },
  rng,
) {
  const spec = MATERIALS[material];
  if (!spec) throw new Error(`unknown material: ${material}`);
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.2);
  const body = modal(length, {
    fundamental: frequency,
    partials: spec.partials.map((ratio, i) => ({
      ratio,
      gain: 1 / (i + 1) ** 0.8,
      decay: Math.max(0.005, decay * spec.decays[i]),
    })),
  });
  const impact = bandpass(
    whiteNoise(length, rng, (t) => decayAt(t, 0.008, 2.2)),
    spec.bright * brightness,
    0.7,
  );
  return mix([
    { buffer: body, gain: 1 },
    { buffer: impact, gain: spec.noise * noise },
  ]);
}

function bell({ note = "A5", decay = 2.2, index = 5, ratio = 1.41, strike = 0.3 }, rng) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.4);
  const body = fm(length, {
    carrier: frequency,
    ratio,
    indexAt: (t) => index * decayAt(t, decay * 0.35, 1.4),
    amplitudeAt: (t) => adAt(t, 0.002, decay, 0.8),
  });
  const attack = bandpass(
    whiteNoise(length, rng, (t) => decayAt(t, 0.006, 2.5)),
    frequency * 3,
    0.9,
  );
  return mix([
    { buffer: body, gain: 1 },
    { buffer: attack, gain: strike },
  ]);
}

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------

function sub(
  { note = "C1", decay = 0.9, curve = 0.7, drive = 1, click: clickAmount = 0.1 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.2);
  const body = oscillate(length, {
    waveform: "sine",
    frequencyAt: () => frequency,
    amplitudeAt: (t) => adAt(t, 0.004, decay, curve),
  });
  const layers = [{ buffer: body, gain: 1 }];
  if (clickAmount > 0) {
    layers.push({
      buffer: click(length, rng, { amount: clickAmount, cutoff: 1200 }),
      gain: 1,
    });
  }
  const out = mix(layers);
  return drive > 1 ? saturate(out, drive) : out;
}

// The long, tuned, pitch-glided bass drum used as a bass instrument. Named for
// what it does rather than for the drum machine it is associated with, per the
// naming rule in docs/sample-library.md section 11.
function tunedBass(
  { note = "F1", decay = 1.6, glideRatio = 1.6, glideTau = 0.05, drive = 1.6 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.25);
  const body = oscillate(length, {
    waveform: "sine",
    frequencyAt: (t) => sweepAt(t, frequency * glideRatio, frequency, glideTau),
    amplitudeAt: (t) => adAt(t, 0.002, decay, 0.75),
  });
  const attack = click(length, rng, { amount: 0.35, cutoff: 1500 });
  return saturate(
    mix([
      { buffer: body, gain: 1 },
      { buffer: attack, gain: 1 },
    ]),
    drive,
  );
}

// Detuned saws through a resonant filter: the reese is a beating-interference
// sound, so the detune amount matters more than the filter does.
function reese(
  {
    note = "F1",
    decay = 1.4,
    voices = 3,
    detuneCents = 14,
    cutoff = 900,
    q = 3,
    drive = 1.8,
    sweep = 0,
  },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.2);
  const layers = [];
  for (let v = 0; v < voices; v++) {
    const offset = (v - (voices - 1) / 2) * detuneCents;
    layers.push({
      buffer: oscillate(length, {
        waveform: "saw",
        frequencyAt: () => frequency * 2 ** (offset / 1200),
        amplitudeAt: (t) => adAt(t, 0.006, decay, 0.6),
        phase: rng(),
      }),
      gain: 1 / voices,
    });
  }
  const filtered = lowpass(
    mix(layers),
    sweep === 0 ? cutoff : (t) => cutoff * 2 ** (sweep * (t / decay)),
    q,
  );
  return saturate(filtered, drive);
}

function bassStab(
  { note = "A1", decay = 0.28, cutoff = 1600, q = 4, waveform = "saw", drive = 1.5 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.12);
  const body = oscillate(length, {
    waveform,
    frequencyAt: () => frequency,
    amplitudeAt: (t) => adAt(t, 0.002, decay, 1.4),
    phase: rng(),
  });
  const filtered = lowpass(body, (t) => cutoff * (0.35 + 0.65 * decayAt(t, decay, 1)), q);
  return saturate(filtered, drive);
}

// ---------------------------------------------------------------------------
// Tonal
// ---------------------------------------------------------------------------

function chord(
  {
    root = "C3",
    quality = "minor",
    waveform = "saw",
    decay = 1.1,
    attack = 0.01,
    cutoff = 2600,
    q = 0.9,
    detuneCents = 6,
    drive = 1,
  },
  rng,
) {
  const frequencies = chordFrequencies(root, quality);
  const length = seconds(decay + attack + 0.25);
  const layers = [];
  for (const frequency of frequencies) {
    for (const direction of [-1, 1]) {
      layers.push({
        buffer: oscillate(length, {
          waveform,
          frequencyAt: () => frequency * 2 ** ((direction * detuneCents) / 1200),
          amplitudeAt: (t) => adAt(t, attack, decay, 0.8),
          phase: rng(),
        }),
        gain: 1 / (frequencies.length * 2),
      });
    }
  }
  const filtered = lowpass(mix(layers), cutoff, q);
  return drive > 1 ? saturate(filtered, drive) : filtered;
}

function stab(
  { root = "C3", quality = "minor7", decay = 0.35, cutoff = 3200, q = 5, drive = 1.4 },
  rng,
) {
  const voiced = chord(
    {
      root,
      quality,
      waveform: "saw",
      decay,
      attack: 0.002,
      cutoff,
      q: 0.8,
      detuneCents: 9,
    },
    rng,
  );
  const swept = lowpass(
    voiced,
    (t) => cutoff * (0.25 + 0.75 * decayAt(t, decay * 0.6, 1)),
    q,
  );
  return saturate(swept, drive);
}

function pluckVoice(
  { note = "C4", decay = 0.9, damping = 0.35, blend = 1, brightness = 4000 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.1);
  const string = pluck(length, { frequency, decay, damping, blend, rng });
  const shaped = new Float32Array(length);
  for (let i = 0; i < length; i++)
    shaped[i] = string[i] * adAt(i / 48000, 0.002, decay, 0.7);
  return lowpass(shaped, brightness);
}

// Two-operator FM at a near-integer ratio: the standard recipe for tine-style
// electric-piano and bell-key colours.
function key(
  { note = "C3", decay = 1.4, ratio = 3, index = 3.2, tine = 0.35, chorus = 0 },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(decay + 0.3);
  const body = fm(length, {
    carrier: frequency,
    ratio,
    indexAt: (t) => index * decayAt(t, decay * 0.25, 1.2),
    amplitudeAt: (t) => adAt(t, 0.004, decay, 0.7),
  });
  const attack = bandpass(
    whiteNoise(length, rng, (t) => decayAt(t, 0.01, 2)),
    frequency * 8,
    0.9,
  );
  const dry = mix([
    { buffer: body, gain: 1 },
    { buffer: attack, gain: tine },
  ]);
  return chorus > 0
    ? delay(dry, { time: 0.011, feedback: 0.2, mix: chorus, repeats: 3 })
    : dry;
}

function organ(
  {
    root = "C3",
    quality = "major",
    decay = 0.9,
    drawbars = [1, 0.6, 0.35, 0.2],
    drive = 1.3,
  },
  rng,
) {
  const frequencies = chordFrequencies(root, quality);
  const length = seconds(decay + 0.2);
  const layers = [];
  for (const frequency of frequencies) {
    drawbars.forEach((level, index) => {
      const partial =
        frequency * (index === 0 ? 1 : index === 1 ? 2 : index === 2 ? 3 : 4);
      if (partial >= 20000) return;
      layers.push({
        buffer: oscillate(length, {
          waveform: "sine",
          frequencyAt: () => partial,
          amplitudeAt: (t) => adAt(t, 0.006, decay, 0.5),
          phase: rng(),
        }),
        gain: level / (frequencies.length * drawbars.length),
      });
    });
  }
  return saturate(mix(layers), drive);
}

// ---------------------------------------------------------------------------
// Transitions, textures, and effects
// ---------------------------------------------------------------------------

function impact(
  { decay = 1.6, lowHz = 45, boom = 1, crackle = 0.4, room = 0.45, drive = 1.6 },
  rng,
) {
  const length = seconds(decay);
  const low = oscillate(length, {
    waveform: "sine",
    frequencyAt: (t) => sweepAt(t, lowHz * 3, lowHz, 0.05),
    amplitudeAt: (t) => adAt(t, 0.001, decay * 0.6, 1.1),
  });
  const body = lowpass(
    whiteNoise(length, rng, (t) => decayAt(t, decay * 0.4, 1.6)),
    1200,
  );
  const debris = highpass(
    whiteNoise(length, rng, (t) => decayAt(t, decay * 0.25, 2.4)),
    3000,
  );
  const dry = saturate(
    mix([
      { buffer: low, gain: boom },
      { buffer: body, gain: 0.6 },
      { buffer: debris, gain: crackle },
    ]),
    drive,
  );
  return reverb(dry, { time: decay, mix: room, damping: 0.4 });
}

// One primitive for risers and downers. `direction` flips the filter and pitch
// contours; everything else is shared, which keeps a build and its mirrored
// fall genuinely matched.
function sweepFx(
  {
    duration = 2,
    direction = "up",
    startHz = 200,
    endHz = 9000,
    q = 3,
    noiseKind = "white",
    tone = 0,
    toneStart = 120,
    toneEnd = 1200,
    drive = 1,
    room = 0.2,
  },
  rng,
) {
  const length = seconds(duration);
  const rising = direction === "up";
  const shape = (t) => {
    const progress = Math.min(1, t / duration);
    // Exponential travel: a linear filter sweep sounds like it stalls at the
    // top, because pitch perception is logarithmic.
    const curved = rising ? progress ** 2 : 1 - (1 - progress) ** 2;
    return startHz * (endHz / startHz) ** (rising ? curved : 1 - curved);
  };
  const envelope = (t) => {
    const progress = Math.min(1, t / duration);
    return rising ? progress ** 1.5 : (1 - progress) ** 1.2;
  };
  const source =
    noiseKind === "pink"
      ? pinkNoise(length, rng, envelope)
      : whiteNoise(length, rng, envelope);
  const layers = [{ buffer: bandpass(source, shape, q), gain: 1 }];
  if (tone > 0) {
    const toneShape = (t) => {
      const progress = Math.min(1, t / duration);
      const curved = rising ? progress ** 2 : 1 - (1 - progress) ** 2;
      return toneStart * (toneEnd / toneStart) ** (rising ? curved : 1 - curved);
    };
    layers.push({
      buffer: oscillate(length, {
        waveform: "saw",
        frequencyAt: toneShape,
        amplitudeAt: envelope,
      }),
      gain: tone,
    });
  }
  const dry = mix(layers);
  const driven = drive > 1 ? saturate(dry, drive) : dry;
  return reverb(driven, { time: 1.4, mix: room, damping: 0.4 });
}

function drone(
  {
    note = "C2",
    duration = 6,
    partials = 6,
    detuneCents = 7,
    cutoff = 1800,
    movement = 0.35,
    noise = 0.12,
    room = 0.4,
  },
  rng,
) {
  const frequency = noteToFrequency(note);
  const length = seconds(duration);
  const layers = [];
  for (let p = 1; p <= partials; p++) {
    const drift = (rng() * 2 - 1) * detuneCents;
    // Each partial breathes at its own slow rate, so the texture evolves
    // instead of sitting still.
    const rate = 0.03 + rng() * 0.12;
    const phase = rng();
    layers.push({
      buffer: oscillate(length, {
        waveform: p % 3 === 0 ? "triangle" : "sine",
        frequencyAt: () => frequency * p * 2 ** (drift / 1200),
        amplitudeAt: (t) => {
          const fade = Math.min(1, t / 0.6) * Math.min(1, (duration - t) / 1.2);
          const breathe =
            1 -
            movement +
            movement * (0.5 + 0.5 * Math.sin(2 * Math.PI * (rate * t + phase)));
          return fade * breathe;
        },
        phase,
      }),
      gain: 1 / (p * partials ** 0.5),
    });
  }
  if (noise > 0) {
    layers.push({
      buffer: bandpass(
        pinkNoise(
          length,
          rng,
          (t) => Math.min(1, t / 1) * Math.min(1, (duration - t) / 1.5),
        ),
        frequency * 4,
        0.6,
      ),
      gain: noise,
    });
  }
  return reverb(lowpass(mix(layers), cutoff), {
    time: 2.4,
    mix: room,
    damping: 0.3,
  });
}

function ambience(
  { duration = 8, cutoff = 2400, lowCut = 90, density = 0.35, room = 0.6 },
  rng,
) {
  const length = seconds(duration);
  const bed = pinkNoise(length, rng, (t) => {
    const fade = Math.min(1, t / 1.5) * Math.min(1, (duration - t) / 2);
    // A slow multi-rate wander stops a noise bed reading as hiss.
    const wander =
      0.6 +
      0.4 * Math.sin(2 * Math.PI * 0.037 * t) * Math.sin(2 * Math.PI * 0.011 * t + 1.3);
    return fade * wander;
  });
  const layers = [{ buffer: highpass(lowpass(bed, cutoff), lowCut), gain: 1 }];
  // Sparse resonant events give the bed a sense of place rather than of tape.
  const events = Math.max(1, Math.round(duration * density));
  for (let e = 0; e < events; e++) {
    const note = 200 + rng() * 2200;
    const eventDecay = 0.6 + rng() * 2.2;
    const buffer = modal(seconds(eventDecay + 0.4), {
      fundamental: note,
      partials: [
        { ratio: 1, gain: 1, decay: eventDecay },
        { ratio: 2.41, gain: 0.35, decay: eventDecay * 0.6 },
        { ratio: 4.17, gain: 0.15, decay: eventDecay * 0.35 },
      ],
    });
    layers.push({
      buffer,
      offset: seconds(rng() * (duration - 1)),
      gain: 0.18 + rng() * 0.18,
    });
  }
  return reverb(mix(layers), {
    time: 3.2,
    mix: room,
    damping: 0.25,
    predelay: 0.04,
  });
}

function noiseTexture(
  {
    duration = 2.5,
    bandHz = 900,
    q = 2.5,
    rate = 7,
    depth = 0.8,
    kind = "white",
    crush = 0,
    drive = 1,
  },
  rng,
) {
  const length = seconds(duration);
  // A gated/pulsed noise band: the rhythmic-noise family the techno and
  // dubstep palettes lean on.
  const envelope = (t) => {
    const fade = Math.min(1, t / 0.02) * Math.min(1, (duration - t) / 0.05);
    const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t);
    return fade * (1 - depth + depth * pulse ** 2);
  };
  const source =
    kind === "pink"
      ? pinkNoise(length, rng, envelope)
      : whiteNoise(length, rng, envelope);
  let out = bandpass(source, bandHz, q);
  if (crush > 0) out = bitcrush(out, Math.max(2, 12 - crush), 1 + crush);
  return drive > 1 ? saturate(out, drive) : out;
}

function glitch(
  {
    duration = 0.5,
    slices = 9,
    bits = 5,
    downsample = 6,
    bandHz = 2200,
    fold: foldAmount = 0,
  },
  rng,
) {
  const length = seconds(duration);
  const out = new Float32Array(length);
  // Stitch together short, unrelated fragments — pitched blips, noise, and
  // silence — the way a buffer error actually sounds.
  let cursor = 0;
  for (let s = 0; s < slices && cursor < length; s++) {
    const sliceLength = Math.min(length - cursor, seconds(0.01 + rng() * 0.07));
    const choice = rng();
    const fragment = new Float32Array(sliceLength);
    if (choice < 0.45) {
      const frequency = 120 * 2 ** Math.floor(rng() * 6);
      for (let i = 0; i < sliceLength; i++) {
        fragment[i] = Math.sin((2 * Math.PI * frequency * i) / 48000) * 0.8;
      }
    } else if (choice < 0.85) {
      for (let i = 0; i < sliceLength; i++) fragment[i] = white(rng) * 0.7;
    }
    applyFades(fragment, 0.0008, 0.0008);
    out.set(fragment, cursor);
    cursor += sliceLength;
  }
  let processed = bitcrush(bandpass(out, bandHz, 1.2), bits, downsample);
  if (foldAmount > 0) processed = fold(processed, foldAmount);
  return processed;
}

// A reversed swell into a short transient. Built by rendering the source and
// reversing it, so the pre-roll genuinely matches the hit it precedes.
function reverseFx({ source = "impact", duration = 1.6, tail = 0.06, params = {} }, rng) {
  const RENDERERS = { impact, cymbal, snare, struck, chord, noiseTexture };
  const render = RENDERERS[source];
  if (!render) throw new Error(`unknown reverse source: ${source}`);
  const forward = render({ ...params, decay: duration, duration }, rng);
  const reversed = reverse(forward);
  const punctuation = seconds(tail);
  const out = new Float32Array(reversed.length + punctuation);
  out.set(reversed, 0);
  const hit = highpass(
    whiteNoise(punctuation, rng, (t) => decayAt(t, tail, 2)),
    900,
  );
  for (let i = 0; i < punctuation; i++) out[reversed.length + i] += hit[i] * 0.5;
  return out;
}

export const VOICES = {
  kick,
  snare,
  clap,
  rim,
  hat,
  cymbal,
  tom,
  shaker,
  membrane,
  struck,
  bell,
  sub,
  tunedBass,
  reese,
  bassStab,
  chord,
  stab,
  pluck: pluckVoice,
  key,
  organ,
  impact,
  sweepFx,
  drone,
  ambience,
  noiseTexture,
  glitch,
  reverseFx,
};

/**
 * Render one catalogue entry to finished master samples.
 *
 * The conditioning chain is the section 10 preparation standard applied
 * uniformly: no DC offset, no accidental clicks at the boundaries, no
 * accidental trailing silence, and headroom below full scale — without
 * flattening the collection to one loudness.
 */
export function renderVoice(entry, rng) {
  const render = VOICES[entry.voice];
  if (!render) throw new Error(`unknown voice: ${entry.voice}`);
  const raw = render(entry.params ?? {}, rng);
  const trimmed = trimTail(removeDcOffset(raw));
  // Fades run *before* normalization. The attack fade is only ~19 samples,
  // but a very short hit peaks inside that window, so fading afterwards
  // quietly pulled the file below the peak the manifest goes on to declare.
  const faded = applyFades(trimmed, 0.0004, entry.releaseFadeSeconds ?? 0.004);
  return normalizePeak(faded, entry.peakDbfs ?? -1.5);
}
