// Generates the built-in drum samples used by starter/mock projects.
//
// Sample audio is gitignored (see .gitignore "big fat blobs"), so instead of
// committing binaries we synthesize them here. This runs automatically before
// `dev` and `build` (see package.json predev/prebuild), and can be run
// directly with `bun run samples`.
//
// The files are only (re)written if missing, so it's cheap to run repeatedly.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"public",
	"samples",
	"house",
	"drums",
	"bd",
);

// Encode mono float samples in [-1, 1] as a 16-bit PCM WAV file.
function encodeWav(samples) {
	const dataSize = samples.length * 2;
	const buffer = Buffer.alloc(44 + dataSize);
	let o = 0;
	const str = (s) => {
		buffer.write(s, o);
		o += s.length;
	};
	const u32 = (n) => {
		buffer.writeUInt32LE(n, o);
		o += 4;
	};
	const u16 = (n) => {
		buffer.writeUInt16LE(n, o);
		o += 2;
	};
	str("RIFF");
	u32(36 + dataSize);
	str("WAVE");
	str("fmt ");
	u32(16); // PCM chunk size
	u16(1); // audio format: PCM
	u16(1); // channels: mono
	u32(SR); // sample rate
	u32(SR * 2); // byte rate
	u16(2); // block align
	u16(16); // bits per sample
	str("data");
	u32(dataSize);
	for (const sample of samples) {
		const s = Math.max(-1, Math.min(1, sample));
		buffer.writeInt16LE(Math.round(s * 32767), o);
		o += 2;
	}
	return buffer;
}

// 909-style kick: a sine with a fast downward pitch sweep, quick amplitude
// decay, and a short transient click at the attack.
function kick() {
	const n = Math.floor(SR * 0.5);
	const out = new Float32Array(n);
	const fHigh = 130;
	const fLow = 45;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const pitchEnv = Math.exp(-t * 30);
		const freq = fLow + (fHigh - fLow) * pitchEnv;
		const amp = Math.exp(-t * 8);
		let s = Math.sin(2 * Math.PI * freq * t) * amp;
		if (t < 0.004) s += (Math.random() * 2 - 1) * (1 - t / 0.004) * 0.6;
		out[i] = s * 0.9;
	}
	return out;
}

// 909-style open hi-hat: high-passed white noise with a medium decay.
function openHat() {
	const n = Math.floor(SR * 0.35);
	const out = new Float32Array(n);
	let smoothed = 0;
	for (let i = 0; i < n; i++) {
		const t = i / SR;
		const white = Math.random() * 2 - 1;
		smoothed = smoothed * 0.5 + white * 0.5;
		const highPassed = white - smoothed;
		out[i] = highPassed * Math.exp(-t * 12) * 0.5;
	}
	return out;
}

const files = [
	{ name: "909-bd.wav", render: kick },
	{ name: "909-oh.wav", render: openHat },
];

mkdirSync(OUT_DIR, { recursive: true });
let wrote = 0;
for (const { name, render } of files) {
	const path = join(OUT_DIR, name);
	if (existsSync(path)) continue;
	writeFileSync(path, encodeWav(render()));
	wrote++;
	console.log(`generated ${path}`);
}
if (wrote === 0) console.log("samples already present, nothing to do");
