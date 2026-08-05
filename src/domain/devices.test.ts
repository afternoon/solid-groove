import { describe, expect, it } from "vitest";
import {
	createDevice,
	DELAY_DIVISIONS,
	defaultDeviceParameters,
	delayDivision,
	deviceParameters,
	deviceTypeDefinition,
	deviceTypes,
	isRegisteredDeviceType,
} from "./devices";
import { createSeededIdFactory } from "./ids";
import {
	bareParameterId,
	coerceParameterValue,
	getParameterDefinition,
	isParameterValueInRange,
} from "./parameters";

const deviceId = createSeededIdFactory("devices-test")("device");

describe("device type registry", () => {
	it("registers the six alpha core device types", () => {
		expect(deviceTypes().map((d) => d.type)).toEqual([
			"filter",
			"overdrive",
			"saturator",
			"compressor",
			"delay",
			"reverb",
		]);
	});

	it("recognizes a registered type and rejects an unknown one", () => {
		expect(isRegisteredDeviceType("delay")).toBe(true);
		expect(isRegisteredDeviceType("bitcrusher")).toBe(false);
		expect(deviceTypeDefinition("bitcrusher")).toBeUndefined();
		expect(deviceParameters("bitcrusher")).toEqual([]);
	});

	it("registers each device parameter under its `type.id` namespace", () => {
		for (const definition of deviceTypes()) {
			for (const parameter of definition.parameters) {
				expect(parameter.id.startsWith(`${definition.type}.`)).toBe(true);
				// The global parameter registry knows it, so `parameter.set` and
				// `parse.ts` resolve it without any per-device code.
				expect(getParameterDefinition(parameter.id)).toBe(parameter);
			}
		}
	});

	it("gives every device type a finite in-range default value per parameter", () => {
		for (const definition of deviceTypes()) {
			for (const parameter of definition.parameters) {
				expect(Number.isFinite(parameter.defaultValue)).toBe(true);
				expect(isParameterValueInRange(parameter, parameter.defaultValue)).toBe(
					true,
				);
			}
		}
	});
});

describe("FX-01 required controls", () => {
	function parameterIds(type: string): string[] {
		return deviceParameters(type).map((p) => bareParameterId(p.id));
	}

	it("gives the delay synced and free timing, feedback, filtering, stereo, and wet/dry", () => {
		expect(parameterIds("delay")).toEqual(
			expect.arrayContaining([
				"sync",
				"division",
				"time",
				"feedback",
				"filter",
				"spread",
				"wet",
			]),
		);
	});

	it("gives the reverb decay, size, pre-delay, filtering, and wet/dry", () => {
		expect(parameterIds("reverb")).toEqual(
			expect.arrayContaining(["decay", "size", "predelay", "filter", "wet"]),
		);
	});

	it("gives the compressor threshold, ratio, attack, release, makeup, and a parallel wet/dry", () => {
		expect(parameterIds("compressor")).toEqual(
			expect.arrayContaining([
				"threshold",
				"ratio",
				"attack",
				"release",
				"makeup",
				"wet",
			]),
		);
	});

	it("treats delay sync and division as discrete, non-automatable modes", () => {
		for (const id of ["delay.sync", "delay.division"]) {
			const definition = getParameterDefinition(id);
			if (!definition) throw new Error(`${id} not registered`);
			expect(definition.step).toBe(1);
			expect(definition.automatable).toBe(false);
			// A discrete mode is refused outright rather than folded to an
			// adjacent one, so an out-of-range index can never mean a different
			// division than the caller asked for.
			expect(definition.clampPolicy).toBe("reject");
			expect(coerceParameterValue(definition, definition.max + 1).ok).toBe(
				false,
			);
		}
	});

	it("resolves every stored division index to a finite fraction of a whole note", () => {
		const division = getParameterDefinition("delay.division");
		if (!division) throw new Error("delay.division not registered");
		expect(division.max).toBe(DELAY_DIVISIONS.length - 1);
		for (let i = division.min; i <= division.max; i++) {
			expect(delayDivision(i)).toBe(DELAY_DIVISIONS[i]);
			expect(delayDivision(i).wholeNotes).toBeGreaterThan(0);
		}
		// Out-of-range indexes still resolve to a real division rather than
		// throwing, so a hostile stored value cannot break the audio graph.
		expect(delayDivision(-5)).toBe(DELAY_DIVISIONS[0]);
		expect(delayDivision(99)).toBe(DELAY_DIVISIONS[DELAY_DIVISIONS.length - 1]);
	});
});

describe("extreme-but-finite ranges (FX-02)", () => {
	it("caps delay feedback below unity and rejects a runaway value", () => {
		const feedback = getParameterDefinition("delay.feedback");
		if (!feedback) throw new Error("delay.feedback not registered");
		expect(feedback.max).toBeLessThan(1);
		// A near-unity tail is creative and accepted...
		expect(coerceParameterValue(feedback, 0.99).ok).toBe(true);
		// ...but self-reinforcing feedback at or above 1 is refused, not clamped
		// silently toward a safe sound.
		expect(coerceParameterValue(feedback, 1).ok).toBe(false);
		expect(coerceParameterValue(feedback, Number.POSITIVE_INFINITY).ok).toBe(
			false,
		);
	});

	it("reaches an obviously destructive drive while staying finite", () => {
		const drive = getParameterDefinition("saturator.drive");
		if (!drive) throw new Error("saturator.drive not registered");
		expect(Number.isFinite(drive.max)).toBe(true);
		expect(drive.max).toBeGreaterThanOrEqual(24);
		expect(coerceParameterValue(drive, drive.max).ok).toBe(true);
	});

	it("rejects a non-finite value for every device parameter", () => {
		for (const definition of deviceTypes()) {
			for (const parameter of definition.parameters) {
				expect(coerceParameterValue(parameter, Number.NaN).ok).toBe(false);
			}
		}
	});
});

describe("device factory", () => {
	it("builds a fully-defaulted, unbypassed device", () => {
		const device = createDevice(deviceId, "compressor", 0);
		expect(device).toMatchObject({
			id: deviceId,
			type: "compressor",
			order: 0,
			bypassed: false,
			preset: null,
		});
		expect(device.parameters).toEqual(defaultDeviceParameters("compressor"));
	});

	it("defaults every parameter of the type by its bare id", () => {
		const defaults = defaultDeviceParameters("delay");
		for (const parameter of deviceParameters("delay")) {
			expect(defaults[bareParameterId(parameter.id)]).toBe(
				parameter.defaultValue,
			);
		}
	});
});
