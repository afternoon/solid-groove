import { z } from "zod";
import {
	type PackDependency,
	packDependencySchema,
} from "../../domain/entities";
import type { PackId } from "../../domain/ids";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";

/**
 * Pack-shelf commands (LIB-08).
 *
 * The shelf (`metadata.addedPacks`) is the "packs the user has added to this
 * project" list, distinct from the *derived* `packDependencies` ("packs the
 * project uses"). It is the one piece of pack state a command maintains rather
 * than derives, because adding a pack the user has not yet drawn a sound from
 * has to survive a reload — deriving the shelf from usage would make that pack
 * vanish.
 *
 * Two rules make these commands safe against the derived list:
 *
 * - `pack.add` shelves a pack at a version. If the pack is already shelved at
 *   the same version it is a no-op error (nothing to undo); at a *different*
 *   version it is refused, because a project shelves one version per pack.
 * - `pack.remove` refuses to unshelve a pack the project still uses, so a used
 *   pack is never silently dropped from the panel while its sounds play. The
 *   caller resolves the assets first (or the pack surfaces as a missing-pack
 *   state via `resolvePackAvailability`); the command does not do it for them.
 *
 * Neither command touches `song.assets`, so neither changes `packDependencies`.
 */

export const packAddPayloadSchema = z.strictObject({
	pack: packDependencySchema,
});
export type PackAddPayload = z.infer<typeof packAddPayloadSchema>;

export const packRemovePayloadSchema = z.strictObject({
	pack: packDependencySchema,
});
export type PackRemovePayload = z.infer<typeof packRemovePayloadSchema>;

function shelfIndexOf(
	shelf: readonly PackDependency[],
	packId: PackId,
): number {
	return shelf.findIndex((entry) => entry.packId === packId);
}

export const packAddCommand = defineCommand<PackAddPayload>({
	type: "pack.add",
	version: 1,
	schema: packAddPayloadSchema,
	summarize: (payload) => `Add pack ${payload.pack.packId} to project`,
	apply(project, payload) {
		const shelf = project.metadata.addedPacks;
		const existingIndex = shelfIndexOf(shelf, payload.pack.packId);
		if (existingIndex >= 0) {
			const existing = shelf[existingIndex];
			if (existing.version === payload.pack.version) {
				return rejected(
					`Pack ${payload.pack.packId} is already on the project's shelf`,
				);
			}
			return rejected(
				`Pack ${payload.pack.packId} is already on the shelf at version ${existing.version}; a project shelves one version per pack`,
			);
		}
		return applied({
			...project,
			metadata: {
				...project.metadata,
				addedPacks: [...shelf, payload.pack],
			},
		});
	},
	invert: (payload) => [removePack(payload.pack)],
});

export const packRemoveCommand = defineCommand<PackRemovePayload>({
	type: "pack.remove",
	version: 1,
	schema: packRemovePayloadSchema,
	summarize: (payload) => `Remove pack ${payload.pack.packId} from project`,
	apply(project, payload) {
		const shelf = project.metadata.addedPacks;
		const index = shelfIndexOf(shelf, payload.pack.packId);
		if (index < 0 || shelf[index].version !== payload.pack.version) {
			return rejected(
				`Pack ${payload.pack.packId} at version ${payload.pack.version} is not on the project's shelf`,
			);
		}
		// A used pack must stay shelved: removing it would leave the project
		// depending on a pack that is no longer on the shelf, which is exactly the
		// drift `checkProjectIntegrity` rejects. Refuse with a named reason rather
		// than silently dropping it.
		const stillUsed = project.metadata.packDependencies.some(
			(dependency) => dependency.packId === payload.pack.packId,
		);
		if (stillUsed) {
			return rejected(
				`Pack ${payload.pack.packId} is in use by this project and cannot be removed from the shelf while its sounds are loaded`,
			);
		}
		return applied({
			...project,
			metadata: {
				...project.metadata,
				addedPacks: shelf.filter((_, position) => position !== index),
			},
		});
	},
	invert: (payload) => [addPack(payload.pack)],
});

// --- Typed builders -------------------------------------------------------

export function addPack(pack: PackDependency): CommandInput<PackAddPayload> {
	return { type: packAddCommand.type, payload: { pack } };
}

export function removePack(
	pack: PackDependency,
): CommandInput<PackRemovePayload> {
	return { type: packRemoveCommand.type, payload: { pack } };
}

/** Registered, payload-erased commands from this module. */
export const packCommands: readonly RegisteredCommand[] = [
	eraseCommand(packAddCommand),
	eraseCommand(packRemoveCommand),
];
