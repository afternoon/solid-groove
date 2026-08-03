import { beforeAll, describe, expect, it, vi } from "vitest";
import { TICKS_PER_BAR, TICKS_PER_QUARTER } from "../domain/time";
import type { AudioProjectScope } from "./AudioRuntime";
import type {
	MetronomeVoice,
	TransportEngine,
	TransportState,
} from "./Transport";
import { installWebAudioGlobals } from "./testAudioContext";

// Transport.ts imports Tone at module scope; install the Web Audio globals
// before importing it so the import does not throw under Node.
installWebAudioGlobals();

let TransportModule: typeof import("./Transport");

beforeAll(async () => {
	TransportModule = await import("./Transport");
});

/**
 * A deterministic transport double that records every write and lets a test
 * fire the scheduled repeat callback at a chosen tick. No Tone, no wall clock.
 */
function fakeEngine(): TransportEngine & {
	fireRepeat(atTicks: number, time: number): void;
	scheduled: { intervalTicks: number; startTicks: number } | null;
	startCalls: number;
	pauseCalls: number;
	stopCalls: number;
} {
	let repeatCallback: ((time: number) => void) | null = null;
	const engine = {
		bpm: { value: 120 },
		ticks: 0,
		_state: "stopped" as TransportState,
		loop: false,
		loopStart: "0i",
		loopEnd: "0i",
		startCalls: 0,
		pauseCalls: 0,
		stopCalls: 0,
		scheduled: null as { intervalTicks: number; startTicks: number } | null,
		get state(): TransportState {
			return this._state;
		},
		start() {
			this.startCalls += 1;
			this._state = "started";
		},
		pause() {
			this.pauseCalls += 1;
			this._state = "paused";
		},
		stop() {
			this.stopCalls += 1;
			this._state = "stopped";
		},
		scheduleRepeat(
			callback: (time: number) => void,
			intervalTicks: number,
			startTicks: number,
		) {
			repeatCallback = callback;
			this.scheduled = { intervalTicks, startTicks };
			return 1;
		},
		clear() {
			repeatCallback = null;
			this.scheduled = null;
		},
		fireRepeat(atTicks: number, time: number) {
			this.ticks = atTicks;
			repeatCallback?.(time);
		},
	};
	return engine;
}

function fakeScope(): AudioProjectScope {
	return {
		ownerId: "test",
		register: (_type, _dispose) => ({ id: 1 }),
		release: () => Promise.resolve(),
		dispose: () => Promise.resolve(),
	};
}

describe("barAlignedLoop (PRD AUD-02)", () => {
	it("snaps the start down and the end up to whole bars", () => {
		const range = TransportModule.barAlignedLoop(
			TICKS_PER_BAR + 10,
			2 * TICKS_PER_BAR + 5,
		);
		expect(range.startTicks).toBe(TICKS_PER_BAR);
		expect(range.endTicks).toBe(3 * TICKS_PER_BAR);
	});

	it("always encloses at least one bar, even for an empty range", () => {
		const range = TransportModule.barAlignedLoop(100, 100);
		expect(range.endTicks - range.startTicks).toBe(TICKS_PER_BAR);
	});

	it("loopOfBars produces a bar-aligned range of the requested length", () => {
		const range = TransportModule.loopOfBars(2, 4);
		expect(range.startTicks).toBe(2 * TICKS_PER_BAR);
		expect(range.endTicks).toBe(6 * TICKS_PER_BAR);
	});
});

describe("clampTempo (PRD AUD-02)", () => {
	it("clamps to the supported 40-240 BPM range", () => {
		expect(TransportModule.clampTempo(20)).toBe(40);
		expect(TransportModule.clampTempo(300)).toBe(240);
		expect(TransportModule.clampTempo(128)).toBe(128);
		expect(TransportModule.clampTempo(Number.NaN)).toBe(40);
	});
});

describe("TransportController (PRD AUD-01/AUD-02)", () => {
	it("play/pause leaves the playhead in place; stop returns it to the start", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });

		transport.play();
		expect(engine.startCalls).toBe(1);
		expect(transport.isPlaying).toBe(true);

		engine.ticks = 5 * TICKS_PER_QUARTER;
		transport.pause();
		expect(engine.pauseCalls).toBe(1);
		// Pause does not move the playhead.
		expect(transport.positionTicks).toBe(5 * TICKS_PER_QUARTER);

		transport.stop();
		expect(engine.stopCalls).toBe(1);
		expect(transport.positionTicks).toBe(0);
	});

	it("stop returns to the loop start when looping is enabled", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });
		transport.setLoop(2 * TICKS_PER_BAR, 4 * TICKS_PER_BAR);
		transport.setLoopEnabled(true);
		engine.ticks = 3 * TICKS_PER_BAR;

		transport.stop();
		expect(transport.positionTicks).toBe(2 * TICKS_PER_BAR);
	});

	it("continueFromStop resumes at the position stop() rewound from", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });

		transport.play();
		engine.ticks = 6 * TICKS_PER_QUARTER;
		transport.stop();
		// Stop rewound the playhead, which is what makes Shift+Space distinct from
		// Space: the position it stopped at is remembered, not lost.
		expect(transport.positionTicks).toBe(0);

		transport.continueFromStop();
		expect(transport.positionTicks).toBe(6 * TICKS_PER_QUARTER);
		expect(transport.isPlaying).toBe(true);
		expect(engine.startCalls).toBe(2);
	});

	it("continueFromStop resumes in place after a pause, and is a no-op while playing", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });

		transport.play();
		engine.ticks = 3 * TICKS_PER_QUARTER;
		transport.pause();

		// Pause never moved the playhead, so there is nothing to restore.
		transport.continueFromStop();
		expect(transport.positionTicks).toBe(3 * TICKS_PER_QUARTER);
		expect(engine.startCalls).toBe(2);

		// Already running: continue neither restarts nor rewinds.
		engine.ticks = 9 * TICKS_PER_QUARTER;
		transport.continueFromStop();
		expect(engine.startCalls).toBe(2);
		expect(transport.positionTicks).toBe(9 * TICKS_PER_QUARTER);
	});

	it("seekTicks moves the playhead without changing the run state", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });
		transport.play();
		transport.seekTicks(3 * TICKS_PER_QUARTER);
		expect(transport.positionTicks).toBe(3 * TICKS_PER_QUARTER);
		// Still started — a seek is not a stop.
		expect(engine.stopCalls).toBe(0);
		expect(transport.isPlaying).toBe(true);
	});

	it("setTempo mirrors the (clamped) tempo without starting or stopping", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });
		transport.play();
		transport.setTempo(300);
		expect(engine.bpm.value).toBe(240);
		// No restart: the transport was never stopped or re-started.
		expect(engine.stopCalls).toBe(0);
		expect(engine.startCalls).toBe(1);
		expect(transport.isPlaying).toBe(true);
	});

	it("setLoop bar-aligns the range and writes it to the engine as tick notation", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });
		const range = transport.setLoop(TICKS_PER_BAR + 10, 2 * TICKS_PER_BAR + 5);
		expect(range.startTicks).toBe(TICKS_PER_BAR);
		expect(range.endTicks).toBe(3 * TICKS_PER_BAR);
		expect(engine.loopStart).toBe(`${TICKS_PER_BAR}i`);
		expect(engine.loopEnd).toBe(`${3 * TICKS_PER_BAR}i`);
	});

	it("toggleLoop enables and disables looping without touching the run state", () => {
		const engine = fakeEngine();
		const transport = new TransportModule.TransportController({ engine });
		transport.setLoop(0, TICKS_PER_BAR);
		transport.play();

		transport.toggleLoop();
		expect(engine.loop).toBe(true);
		transport.toggleLoop();
		expect(engine.loop).toBe(false);
		expect(engine.startCalls).toBe(1);
		expect(engine.stopCalls).toBe(0);
	});

	it("delegates the metronome to its Metronome without restarting the transport", () => {
		const engine = fakeEngine();
		const setEnabled = vi.fn();
		let enabled = false;
		const metronome = {
			get enabled() {
				return enabled;
			},
			setEnabled: (value: boolean) => {
				enabled = value;
				setEnabled(value);
			},
			dispose: () => {},
		};
		const transport = new TransportModule.TransportController({
			engine,
			metronome,
		});
		transport.play();
		transport.toggleMetronome();
		expect(setEnabled).toHaveBeenLastCalledWith(true);
		expect(transport.metronomeEnabled).toBe(true);
		transport.toggleMetronome();
		expect(setEnabled).toHaveBeenLastCalledWith(false);
		// The click toggle never stopped or restarted playback.
		expect(engine.startCalls).toBe(1);
		expect(engine.stopCalls).toBe(0);
	});
});

describe("TransportMetronome (PRD AUD-02)", () => {
	function fakeVoice(): MetronomeVoice & {
		clicks: { time: number; accent: boolean }[];
	} {
		const clicks: { time: number; accent: boolean }[] = [];
		return {
			clicks,
			click(time, accent) {
				clicks.push({ time, accent });
			},
			dispose() {},
		};
	}

	it("schedules a single quarter-note repeat from tick 0", () => {
		const engine = fakeEngine();
		const voice = fakeVoice();
		new TransportModule.TransportMetronome(
			engine,
			fakeScope(),
			// Destination is unused because we inject the voice.
			undefined as never,
			{ createVoice: () => voice },
		);
		expect(engine.scheduled).toEqual({
			intervalTicks: TICKS_PER_QUARTER,
			startTicks: 0,
		});
	});

	it("clicks only while enabled, accenting the bar downbeat", () => {
		const engine = fakeEngine();
		const voice = fakeVoice();
		const metronome = new TransportModule.TransportMetronome(
			engine,
			fakeScope(),
			undefined as never,
			{ createVoice: () => voice },
		);

		// Disabled: firing the repeat produces no click.
		engine.fireRepeat(0, 0.5);
		expect(voice.clicks).toHaveLength(0);

		metronome.setEnabled(true);
		engine.fireRepeat(0, 1); // bar downbeat
		engine.fireRepeat(TICKS_PER_QUARTER, 1.5); // beat 2
		engine.fireRepeat(TICKS_PER_BAR, 2); // next bar downbeat

		expect(voice.clicks).toEqual([
			{ time: 1, accent: true },
			{ time: 1.5, accent: false },
			{ time: 2, accent: true },
		]);
	});

	it("is idempotent to dispose and stops clicking afterwards", () => {
		const engine = fakeEngine();
		const voice = fakeVoice();
		const disposeSpy = vi.spyOn(voice, "dispose");
		const metronome = new TransportModule.TransportMetronome(
			engine,
			fakeScope(),
			undefined as never,
			{ createVoice: () => voice },
		);
		metronome.setEnabled(true);
		metronome.dispose();
		metronome.dispose();
		expect(disposeSpy).toHaveBeenCalledTimes(1);
		engine.fireRepeat(0, 1);
		expect(voice.clicks).toHaveLength(0);
	});
});
