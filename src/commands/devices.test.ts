import { beforeEach, describe, expect, it } from "vitest";
import {
	createDevice,
	createSeededIdFactory,
	type DeviceId,
	MAX_TRACK_INSERTS,
	type Project,
} from "../domain";
import {
	addDevice,
	duplicateDevice,
	insertChain,
	masterChain,
	removeDevice,
	reorderDevice,
	resetDevice,
	returnChain,
	setDeviceBypass,
	setParameter,
} from ".";
import { executeCommand } from "./execute";
import { findTrack } from "./projectEdits";
import {
	type CommandTestProject,
	createCommandTestProject,
} from "./testProjects";

const ids = createSeededIdFactory("devices-command-test");
const newDeviceId = (): DeviceId => ids("device");

function apply(
	project: Project,
	command: Parameters<typeof executeCommand>[1],
): Project {
	const result = executeCommand(project, command);
	if (!result.ok) {
		throw new Error(`Expected success: ${result.issues[0].message}`);
	}
	return result.project;
}

function trackDevices(project: Project, fixture: CommandTestProject) {
	return findTrack(project, fixture.trackAId)?.devices ?? [];
}

describe("device.add across chains", () => {
	let fixture: CommandTestProject;
	beforeEach(() => {
		fixture = createCommandTestProject();
	});

	it("adds a device to a track's insert chain with a stable id and contiguous order", () => {
		const id = newDeviceId();
		const next = apply(
			fixture.project,
			addDevice(insertChain(fixture.trackAId), createDevice(id, "reverb", 2)),
		);
		const devices = trackDevices(next, fixture);
		expect(devices.map((d) => d.order)).toEqual([0, 1, 2]);
		expect(devices.find((d) => d.id === id)?.type).toBe("reverb");
	});

	it("adds a device to a return bus chain", () => {
		const id = newDeviceId();
		const next = apply(
			fixture.project,
			addDevice(returnChain(fixture.returnId), createDevice(id, "delay", 0)),
		);
		const bus = next.song.returns.find((b) => b.id === fixture.returnId);
		expect(bus?.devices.map((d) => d.id)).toEqual([id]);
	});

	it("adds a device to the master chain", () => {
		const id = newDeviceId();
		const next = apply(
			fixture.project,
			addDevice(masterChain, createDevice(id, "compressor", 0)),
		);
		expect(next.song.master.devices.map((d) => d.id)).toEqual([id]);
	});

	it("rejects a duplicate device id rather than corrupting the chain", () => {
		const result = executeCommand(
			fixture.project,
			addDevice(
				insertChain(fixture.trackAId),
				createDevice(fixture.deviceId, "reverb", 0),
			),
		);
		expect(result.ok).toBe(false);
	});
});

describe("device.remove and device.reorder renumber contiguously", () => {
	it("removes a device and closes the order gap", () => {
		const fixture = createCommandTestProject();
		const next = apply(
			fixture.project,
			removeDevice(insertChain(fixture.trackAId), fixture.deviceId),
		);
		const devices = trackDevices(next, fixture);
		expect(devices.some((d) => d.id === fixture.deviceId)).toBe(false);
		expect(devices.map((d) => d.order)).toEqual(
			devices.map((_, index) => index),
		);
	});

	it("reorders a device and keeps every order 0..n-1", () => {
		const fixture = createCommandTestProject();
		const next = apply(
			fixture.project,
			reorderDevice(insertChain(fixture.trackAId), fixture.deviceId, 1),
		);
		const devices = trackDevices(next, fixture);
		// The first device now sits last, and orders stay serial.
		expect(devices.map((d) => d.order)).toEqual(
			devices.map((_, index) => index),
		);
		const moved = devices.find((d) => d.id === fixture.deviceId);
		expect(moved?.order).toBe(1);
	});
});

describe("insert ceiling (FX-01)", () => {
	// Sized from `MAX_TRACK_INSERTS` rather than a literal: the ceiling is a
	// declared product number (PRD FX-01, "up to sixteen serial insert devices
	// per track"), and a test that hard-codes it silently goes stale the moment
	// the ceiling moves — which is exactly what happened when it went 8 -> 16.
	it("accepts inserts up to the ceiling but rejects one past it", () => {
		let project = createCommandTestProject().project;
		const trackId = project.song.tracks[0].id;
		const startingInserts = findTrack(project, trackId)?.devices.length ?? 0;
		expect(startingInserts).toBeLessThan(MAX_TRACK_INSERTS);

		// Fill the chain exactly to the ceiling.
		for (let order = startingInserts; order < MAX_TRACK_INSERTS; order++) {
			project = apply(
				project,
				addDevice(
					insertChain(trackId),
					createDevice(newDeviceId(), "filter", order),
				),
			);
		}
		expect(findTrack(project, trackId)?.devices.length).toBe(MAX_TRACK_INSERTS);

		const overCeiling = executeCommand(
			project,
			addDevice(
				insertChain(trackId),
				createDevice(newDeviceId(), "filter", MAX_TRACK_INSERTS),
			),
		);
		expect(overCeiling.ok).toBe(false);
	});
});

describe("device.duplicate", () => {
	it("places an independent copy right after the source with a fresh id", () => {
		const fixture = createCommandTestProject();
		const sourceId = newDeviceId();
		const copyId = newDeviceId();
		// A real delay device with a distinct feedback value to copy.
		let project = apply(
			fixture.project,
			addDevice(
				insertChain(fixture.trackAId),
				createDevice(sourceId, "delay", 2),
			),
		);
		project = apply(
			project,
			setParameter(
				{
					scope: "trackDevice",
					trackId: fixture.trackAId,
					deviceId: sourceId,
					parameterId: "feedback",
				},
				0.6,
			),
		);
		const next = apply(
			project,
			duplicateDevice(insertChain(fixture.trackAId), sourceId, copyId),
		);
		const devices = trackDevices(next, fixture);
		const sourceIndex = devices.findIndex((d) => d.id === sourceId);
		const copyIndex = devices.findIndex((d) => d.id === copyId);
		expect(copyIndex).toBe(sourceIndex + 1);
		expect(devices[copyIndex].parameters).toEqual(
			devices[sourceIndex].parameters,
		);
		expect(devices[copyIndex].parameters).not.toBe(
			devices[sourceIndex].parameters,
		);
		expect(devices.map((d) => d.order)).toEqual(
			devices.map((_, index) => index),
		);
	});
});

describe("device.setBypass and device.reset", () => {
	it("bypasses a device without touching its parameters", () => {
		const fixture = createCommandTestProject();
		const next = apply(
			fixture.project,
			setDeviceBypass(insertChain(fixture.trackAId), fixture.deviceId, true),
		);
		const device = trackDevices(next, fixture).find(
			(d) => d.id === fixture.deviceId,
		);
		expect(device?.bypassed).toBe(true);
		expect(device?.parameters).toEqual({ time: 0.25 });
	});

	it("reset restores factory parameters but keeps position, bypass, and preset", () => {
		const fixture = createCommandTestProject();
		// Registered type so reset has real defaults to restore to.
		const id = newDeviceId();
		let project = apply(
			fixture.project,
			addDevice(insertChain(fixture.trackAId), createDevice(id, "delay", 2)),
		);
		project = apply(
			project,
			setParameter(
				{
					scope: "trackDevice",
					trackId: fixture.trackAId,
					deviceId: id,
					parameterId: "feedback",
				},
				0.9,
			),
		);
		project = apply(
			project,
			setDeviceBypass(insertChain(fixture.trackAId), id, true),
		);
		const reset = apply(
			project,
			resetDevice(insertChain(fixture.trackAId), id),
		);
		const device = trackDevices(reset, fixture).find((d) => d.id === id);
		expect(device?.parameters.feedback).toBe(0.4); // default, not 0.9
		expect(device?.bypassed).toBe(true); // preserved
	});
});

describe("unrelated graphs keep identity (structural sharing)", () => {
	it("adding a device to track A leaves track B's object referentially identical", () => {
		const fixture = createCommandTestProject();
		const before = fixture.project.song.tracks.find(
			(t) => t.id === fixture.trackBId,
		);
		const next = apply(
			fixture.project,
			addDevice(
				insertChain(fixture.trackAId),
				createDevice(newDeviceId(), "reverb", 2),
			),
		);
		const after = next.song.tracks.find((t) => t.id === fixture.trackBId);
		expect(after).toBe(before);
	});
});

describe("device parameter safety (FX-02)", () => {
	it("rejects an unsafe delay feedback at unity rather than clamping it", () => {
		const fixture = createCommandTestProject();
		const id = newDeviceId();
		const project = apply(
			fixture.project,
			addDevice(insertChain(fixture.trackAId), createDevice(id, "delay", 2)),
		);
		const result = executeCommand(
			project,
			setParameter(
				{
					scope: "trackDevice",
					trackId: fixture.trackAId,
					deviceId: id,
					parameterId: "feedback",
				},
				1,
			),
		);
		expect(result.ok).toBe(false);
	});

	it("keeps an extreme-but-finite feedback setting", () => {
		const fixture = createCommandTestProject();
		const id = newDeviceId();
		let project = apply(
			fixture.project,
			addDevice(insertChain(fixture.trackAId), createDevice(id, "delay", 2)),
		);
		project = apply(
			project,
			setParameter(
				{
					scope: "trackDevice",
					trackId: fixture.trackAId,
					deviceId: id,
					parameterId: "feedback",
				},
				0.99,
			),
		);
		const device = trackDevices(project, fixture).find((d) => d.id === id);
		expect(device?.parameters.feedback).toBe(0.99);
	});
});
