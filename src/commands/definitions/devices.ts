import { z } from "zod";
import { defaultDeviceParameters } from "../../domain/devices";
import { type Device, deviceSchema, type Project } from "../../domain/entities";
import { type DeviceId, deviceIdSchema } from "../../domain/ids";
import { MAX_TRACK_INSERTS } from "../../domain/parse";
import { byOrder, findTrack, renumber, withSong } from "../projectEdits";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";
import { chainTargetSchema, type DeviceChainTarget } from "./deviceChains";

/**
 * Device lifecycle commands for every insert chain — a track's inserts, a
 * return bus's chain, or the master chain (PRD FX-01, LOOP-008).
 *
 * A device is added, removed, reordered, duplicated, bypassed, and reset
 * through these commands, so every mutation shares the command layer's
 * validation, atomic transaction, generated inverse, and one-revision history.
 * Payloads carry explicit device IDs for anything they create, so replay,
 * redo, and an assistant preview reproduce the same graph. Only the eight-insert
 * ceiling is a command-level guard here (a friendlier message than the parse
 * failure); every other invariant is left to `checkProjectIntegrity`, which
 * `executeTransaction` runs on the working copy.
 */

// --- Generic chain read/write ---------------------------------------------

/** Reads the device array a chain target points at, or `undefined` if it is gone. */
function readChain(
	project: Project,
	target: DeviceChainTarget,
): readonly Device[] | undefined {
	switch (target.chain) {
		case "insert":
			return findTrack(project, target.trackId)?.devices;
		case "return":
			return project.song.returns.find((bus) => bus.id === target.returnId)
				?.devices;
		case "master":
			return project.song.master.devices;
	}
}

/** Writes a new device array into the chain the target names. */
function writeChain(
	project: Project,
	target: DeviceChainTarget,
	devices: readonly Device[],
): Project {
	switch (target.chain) {
		case "insert": {
			const track = findTrack(project, target.trackId);
			if (!track) return project;
			return withSong(project, {
				...project.song,
				tracks: project.song.tracks.map((candidate) =>
					candidate.id === track.id
						? { ...candidate, devices: [...devices] }
						: candidate,
				),
			});
		}
		case "return":
			return withSong(project, {
				...project.song,
				returns: project.song.returns.map((bus) =>
					bus.id === target.returnId ? { ...bus, devices: [...devices] } : bus,
				),
			});
		case "master":
			return withSong(project, {
				...project.song,
				master: { ...project.song.master, devices: [...devices] },
			});
	}
}

function chainMissingMessage(target: DeviceChainTarget): string {
	switch (target.chain) {
		case "insert":
			return `Track ${target.trackId} does not exist`;
		case "return":
			return `Return bus ${target.returnId} does not exist`;
		case "master":
			return "The master chain does not exist";
	}
}

// --- Payloads --------------------------------------------------------------

export const deviceAddPayloadSchema = z.strictObject({
	target: chainTargetSchema,
	device: deviceSchema,
});
export type DeviceAddPayload = z.infer<typeof deviceAddPayloadSchema>;

export const deviceRemovePayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
});
export type DeviceRemovePayload = z.infer<typeof deviceRemovePayloadSchema>;

export const deviceReorderPayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
	toIndex: z.int().min(0),
});
export type DeviceReorderPayload = z.infer<typeof deviceReorderPayloadSchema>;

export const deviceDuplicatePayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
	newDeviceId: deviceIdSchema,
});
export type DeviceDuplicatePayload = z.infer<
	typeof deviceDuplicatePayloadSchema
>;

export const deviceSetBypassPayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
	bypassed: z.boolean(),
});
export type DeviceSetBypassPayload = z.infer<
	typeof deviceSetBypassPayloadSchema
>;

export const deviceResetPayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
});
export type DeviceResetPayload = z.infer<typeof deviceResetPayloadSchema>;

// --- Commands --------------------------------------------------------------

export const deviceAddCommand = defineCommand<DeviceAddPayload>({
	type: "device.add",
	version: 1,
	schema: deviceAddPayloadSchema,
	summarize: (payload) => `Add ${payload.device.type} device`,
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		if (devices.some((device) => device.id === payload.device.id)) {
			return rejected(`Device ${payload.device.id} already exists`);
		}
		if (
			payload.target.chain === "insert" &&
			devices.length >= MAX_TRACK_INSERTS
		) {
			return rejected(
				`A track may have at most ${MAX_TRACK_INSERTS} insert devices`,
			);
		}
		const sorted = byOrder(devices);
		if (payload.device.order > sorted.length) {
			return rejected(
				`Cannot insert a device at position ${payload.device.order} of ${sorted.length}`,
			);
		}
		const next = renumber([
			...sorted.slice(0, payload.device.order),
			payload.device,
			...sorted.slice(payload.device.order),
		]);
		return applied(writeChain(project, payload.target, next));
	},
	invert: (payload) => [removeDevice(payload.target, payload.device.id)],
});

export const deviceRemoveCommand = defineCommand<DeviceRemovePayload>({
	type: "device.remove",
	version: 1,
	schema: deviceRemovePayloadSchema,
	summarize: () => "Remove device",
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		if (!devices.some((device) => device.id === payload.deviceId)) {
			return rejected(`Device ${payload.deviceId} does not exist`);
		}
		const next = renumber(
			byOrder(devices).filter((device) => device.id !== payload.deviceId),
		);
		return applied(writeChain(project, payload.target, next));
	},
	invert(payload, before) {
		const device = readChain(before, payload.target)?.find(
			(candidate) => candidate.id === payload.deviceId,
		);
		return device ? [addDevice(payload.target, device)] : [];
	},
});

export const deviceReorderCommand = defineCommand<DeviceReorderPayload>({
	type: "device.reorder",
	version: 1,
	schema: deviceReorderPayloadSchema,
	summarize: (payload) => `Move device to position ${payload.toIndex + 1}`,
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		const sorted = byOrder(devices);
		const from = sorted.findIndex((device) => device.id === payload.deviceId);
		if (from < 0) return rejected(`Device ${payload.deviceId} does not exist`);
		if (payload.toIndex >= sorted.length) {
			return rejected(
				`Cannot move a device to position ${payload.toIndex} of ${sorted.length}`,
			);
		}
		const moved = sorted[from];
		const without = sorted.filter((_, index) => index !== from);
		const next = renumber([
			...without.slice(0, payload.toIndex),
			moved,
			...without.slice(payload.toIndex),
		]);
		return applied(writeChain(project, payload.target, next));
	},
	invert(payload, before) {
		const device = readChain(before, payload.target)?.find(
			(candidate) => candidate.id === payload.deviceId,
		);
		return device
			? [reorderDevice(payload.target, payload.deviceId, device.order)]
			: [];
	},
});

export const deviceDuplicateCommand = defineCommand<DeviceDuplicatePayload>({
	type: "device.duplicate",
	version: 1,
	schema: deviceDuplicatePayloadSchema,
	summarize: () => "Duplicate device",
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		const source = devices.find((device) => device.id === payload.deviceId);
		if (!source) return rejected(`Device ${payload.deviceId} does not exist`);
		if (devices.some((device) => device.id === payload.newDeviceId)) {
			return rejected(`Device ${payload.newDeviceId} already exists`);
		}
		if (
			payload.target.chain === "insert" &&
			devices.length >= MAX_TRACK_INSERTS
		) {
			return rejected(
				`A track may have at most ${MAX_TRACK_INSERTS} insert devices`,
			);
		}
		// A deep, independent copy placed immediately after the source, carrying
		// the same parameters, bypass state, and preset provenance.
		const copy: Device = {
			...source,
			id: payload.newDeviceId,
			order: source.order + 1,
			parameters: { ...source.parameters },
			preset: source.preset ? { ...source.preset } : null,
		};
		const sorted = byOrder(devices);
		const at = sorted.findIndex((device) => device.id === source.id) + 1;
		const next = renumber([...sorted.slice(0, at), copy, ...sorted.slice(at)]);
		return applied(writeChain(project, payload.target, next));
	},
	invert: (payload) => [removeDevice(payload.target, payload.newDeviceId)],
});

export const deviceSetBypassCommand = defineCommand<DeviceSetBypassPayload>({
	type: "device.setBypass",
	version: 1,
	schema: deviceSetBypassPayloadSchema,
	summarize: (payload) =>
		payload.bypassed ? "Bypass device" : "Enable device",
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		if (!devices.some((device) => device.id === payload.deviceId)) {
			return rejected(`Device ${payload.deviceId} does not exist`);
		}
		const next = devices.map((device) =>
			device.id === payload.deviceId
				? { ...device, bypassed: payload.bypassed }
				: device,
		);
		return applied(writeChain(project, payload.target, next));
	},
	invert(payload, before) {
		const device = readChain(before, payload.target)?.find(
			(candidate) => candidate.id === payload.deviceId,
		);
		return device
			? [setDeviceBypass(payload.target, payload.deviceId, device.bypassed)]
			: [];
	},
});

export const deviceResetCommand = defineCommand<DeviceResetPayload>({
	type: "device.reset",
	version: 1,
	schema: deviceResetPayloadSchema,
	summarize: () => "Reset device",
	apply(project, payload) {
		const devices = readChain(project, payload.target);
		if (!devices) return rejected(chainMissingMessage(payload.target));
		const device = devices.find((entry) => entry.id === payload.deviceId);
		if (!device) return rejected(`Device ${payload.deviceId} does not exist`);
		// Reset restores factory parameter values but preserves the device's
		// place, bypass state, and preset provenance — it is a "back to default
		// tone", not a delete-and-recreate.
		const next = devices.map((entry) =>
			entry.id === device.id
				? { ...entry, parameters: defaultDeviceParameters(entry.type) }
				: entry,
		);
		return applied(writeChain(project, payload.target, next));
	},
	invert(payload, before) {
		const device = readChain(before, payload.target)?.find(
			(candidate) => candidate.id === payload.deviceId,
		);
		return device
			? [
					restoreDeviceParameters(
						payload.target,
						payload.deviceId,
						device.parameters,
					),
				]
			: [];
	},
});

/**
 * The inverse of a reset: it restores the exact parameter map the reset
 * discarded. Kept as its own command (rather than reusing `parameter.set` per
 * parameter) so one reset undoes as one history entry and one revision.
 */
export const deviceResetRestorePayloadSchema = z.strictObject({
	target: chainTargetSchema,
	deviceId: deviceIdSchema,
	parameters: z.record(z.string(), z.number()),
});
export type DeviceResetRestorePayload = z.infer<
	typeof deviceResetRestorePayloadSchema
>;

export const deviceResetRestoreCommand =
	defineCommand<DeviceResetRestorePayload>({
		type: "device.restoreParameters",
		version: 1,
		schema: deviceResetRestorePayloadSchema,
		summarize: () => "Restore device parameters",
		apply(project, payload) {
			const devices = readChain(project, payload.target);
			if (!devices) return rejected(chainMissingMessage(payload.target));
			const device = devices.find((entry) => entry.id === payload.deviceId);
			if (!device) return rejected(`Device ${payload.deviceId} does not exist`);
			const next = devices.map((entry) =>
				entry.id === device.id
					? { ...entry, parameters: { ...payload.parameters } }
					: entry,
			);
			return applied(writeChain(project, payload.target, next));
		},
		invert(payload, before) {
			const device = readChain(before, payload.target)?.find(
				(candidate) => candidate.id === payload.deviceId,
			);
			return device
				? [
						restoreDeviceParameters(
							payload.target,
							payload.deviceId,
							device.parameters,
						),
					]
				: [];
		},
	});

/** Overwrites a device's parameter map wholesale (the inverse of a reset). */
export function restoreDeviceParameters(
	target: DeviceChainTarget,
	deviceId: DeviceId,
	parameters: Readonly<Record<string, number>>,
): CommandInput<DeviceResetRestorePayload> {
	return {
		type: deviceResetRestoreCommand.type,
		payload: { target, deviceId, parameters: { ...parameters } },
	};
}

// --- Typed builders --------------------------------------------------------

export function addDevice(
	target: DeviceChainTarget,
	device: Device,
): CommandInput<DeviceAddPayload> {
	return { type: deviceAddCommand.type, payload: { target, device } };
}

export function removeDevice(
	target: DeviceChainTarget,
	deviceId: DeviceId,
): CommandInput<DeviceRemovePayload> {
	return { type: deviceRemoveCommand.type, payload: { target, deviceId } };
}

export function reorderDevice(
	target: DeviceChainTarget,
	deviceId: DeviceId,
	toIndex: number,
): CommandInput<DeviceReorderPayload> {
	return {
		type: deviceReorderCommand.type,
		payload: { target, deviceId, toIndex },
	};
}

export function duplicateDevice(
	target: DeviceChainTarget,
	deviceId: DeviceId,
	newDeviceId: DeviceId,
): CommandInput<DeviceDuplicatePayload> {
	return {
		type: deviceDuplicateCommand.type,
		payload: { target, deviceId, newDeviceId },
	};
}

export function setDeviceBypass(
	target: DeviceChainTarget,
	deviceId: DeviceId,
	bypassed: boolean,
): CommandInput<DeviceSetBypassPayload> {
	return {
		type: deviceSetBypassCommand.type,
		payload: { target, deviceId, bypassed },
	};
}

export function resetDevice(
	target: DeviceChainTarget,
	deviceId: DeviceId,
): CommandInput<DeviceResetPayload> {
	return { type: deviceResetCommand.type, payload: { target, deviceId } };
}

/** Registered, payload-erased commands from this module. */
export const deviceCommands: readonly RegisteredCommand[] = [
	eraseCommand(deviceAddCommand),
	eraseCommand(deviceRemoveCommand),
	eraseCommand(deviceReorderCommand),
	eraseCommand(deviceDuplicateCommand),
	eraseCommand(deviceSetBypassCommand),
	eraseCommand(deviceResetCommand),
	eraseCommand(deviceResetRestoreCommand),
];
