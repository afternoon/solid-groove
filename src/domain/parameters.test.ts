import { describe, expect, it } from "vitest";
import {
	clampParameterValue,
	coerceParameterValue,
	defineParameter,
	getParameterDefinition,
	isAutomatable,
	isParameterValueInRange,
	MASTER_VOLUME,
	NOTE_VELOCITY,
	parameterDefinitions,
	parameterSchemaFor,
	requireParameterDefinition,
	SONG_TEMPO,
	TRACK_PAN,
	TRACK_VOLUME,
} from "./parameters";

describe("parameter definitions", () => {
	it("declares range, unit, default, clamping policy, and automation once", () => {
		expect(TRACK_VOLUME).toMatchObject({
			id: "track.volume",
			unit: "decibels",
			min: -60,
			max: 6,
			defaultValue: 0,
			clampPolicy: "clamp",
			automatable: true,
		});
		expect(SONG_TEMPO.unit).toBe("bpm");
		expect(SONG_TEMPO.automatable).toBe(false);
		expect(NOTE_VELOCITY.automatable).toBe(false);
		expect(MASTER_VOLUME.automatable).toBe(true);
	});

	it("keeps the registry to the parameters the foundation slice needs", () => {
		expect([...parameterDefinitions().keys()].sort()).toEqual([
			"master.volume",
			"note.probability",
			"note.velocity",
			"return.pan",
			"return.volume",
			"song.tempo",
			"track.pan",
			"track.sendLevel",
			"track.volume",
		]);
	});

	it("every registered definition has a default inside its own range", () => {
		for (const definition of parameterDefinitions().values()) {
			expect(isParameterValueInRange(definition, definition.defaultValue)).toBe(
				true,
			);
			expect(definition.min).toBeLessThan(definition.max);
		}
	});

	it("rejects definitions with an impossible range, default, or step", () => {
		expect(() =>
			defineParameter({
				id: "bad.range",
				label: "Bad",
				unit: "normalized",
				min: 1,
				max: 0,
				defaultValue: 0,
				automatable: false,
			}),
		).toThrow(/min < max/);
		expect(() =>
			defineParameter({
				id: "bad.default",
				label: "Bad",
				unit: "normalized",
				min: 0,
				max: 1,
				defaultValue: 2,
				automatable: false,
			}),
		).toThrow(/outside its range/);
		expect(() =>
			defineParameter({
				id: "bad.step",
				label: "Bad",
				unit: "normalized",
				min: 0,
				max: 1,
				defaultValue: 0,
				step: 0,
				automatable: false,
			}),
		).toThrow(/step must be a positive number/);
	});

	it("clamps out-of-range values and refuses non-finite ones", () => {
		expect(clampParameterValue(TRACK_VOLUME, 40)).toBe(6);
		expect(clampParameterValue(TRACK_VOLUME, -400)).toBe(-60);
		expect(clampParameterValue(TRACK_PAN, -1.5)).toBe(-1);
		expect(() => clampParameterValue(TRACK_PAN, Number.NaN)).toThrow(
			/non-finite/,
		);
	});

	it("quantizes to the declared step", () => {
		const stepped = defineParameter({
			id: "test.stepped",
			label: "Stepped",
			unit: "normalized",
			min: 0,
			max: 1,
			defaultValue: 0,
			step: 0.25,
			automatable: false,
		});
		expect(clampParameterValue(stepped, 0.3)).toBe(0.25);
		expect(clampParameterValue(stepped, 0.4)).toBe(0.5);
		expect(clampParameterValue(stepped, 9)).toBe(1);
	});

	it("applies the clamping policy when coercing command input", () => {
		expect(coerceParameterValue(TRACK_VOLUME, 40)).toEqual({
			ok: true,
			value: 6,
		});
		expect(coerceParameterValue(TRACK_VOLUME, Number.NaN)).toEqual({
			ok: false,
			reason: 'Parameter "track.volume" requires a finite number',
		});

		const strict = defineParameter({
			id: "test.strict",
			label: "Strict",
			unit: "normalized",
			min: 0,
			max: 1,
			defaultValue: 0,
			clampPolicy: "reject",
			automatable: false,
		});
		expect(coerceParameterValue(strict, 2).ok).toBe(false);
		expect(coerceParameterValue(strict, 0.5)).toEqual({ ok: true, value: 0.5 });
	});

	it("answers automation capability from the one definition", () => {
		expect(isAutomatable("track.volume")).toBe(true);
		expect(isAutomatable("song.tempo")).toBe(false);
		expect(isAutomatable("device.unregistered")).toBe(false);
		expect(getParameterDefinition("device.unregistered")).toBeUndefined();
		expect(() => requireParameterDefinition("device.unregistered")).toThrow(
			/Unknown parameter/,
		);
	});

	it("builds a runtime value schema from the definition", () => {
		const schema = parameterSchemaFor("track.pan");
		expect(schema.safeParse(0.5).success).toBe(true);
		expect(schema.safeParse(1.5).success).toBe(false);
		expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
	});
});
