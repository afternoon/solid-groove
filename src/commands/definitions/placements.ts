import { z } from "zod";
import { type Placement, placementSchema } from "../../domain/entities";
import { type PlacementId, placementIdSchema } from "../../domain/ids";
import {
	clipLabel,
	findPlacement,
	replacePlacement,
	withSong,
} from "../projectEdits";
import {
	applied,
	type CommandInput,
	defineCommand,
	eraseCommand,
	type RegisteredCommand,
	rejected,
} from "../types";

/**
 * Arrangement placement commands.
 *
 * A placement is the arrangement's reference to a clip, kept separate from the
 * clip's content (invariant 3) so the same clip can appear many times. Moving
 * a placement to another track is allowed only when that track already owns
 * the clip; the integrity check enforces it, so a cross-track drag has to
 * create a compatible clip first rather than silently re-parenting one.
 */

export const placementCreatePayloadSchema = z.strictObject({
	placement: placementSchema,
});
export type PlacementCreatePayload = z.infer<
	typeof placementCreatePayloadSchema
>;

export const placementDeletePayloadSchema = z.strictObject({
	placementId: placementIdSchema,
});
export type PlacementDeletePayload = z.infer<
	typeof placementDeletePayloadSchema
>;

export const placementChangesSchema = z
	.strictObject({
		trackId: placementSchema.shape.trackId.optional(),
		startTicks: placementSchema.shape.startTicks.optional(),
		durationTicks: placementSchema.shape.durationTicks.optional(),
		clipOffsetTicks: placementSchema.shape.clipOffsetTicks.optional(),
		looped: placementSchema.shape.looped.optional(),
	})
	.refine(
		(changes) => Object.values(changes).some((value) => value !== undefined),
		{ message: "An update must change at least one field" },
	);
export type PlacementChanges = z.infer<typeof placementChangesSchema>;

export const placementUpdatePayloadSchema = z.strictObject({
	placementId: placementIdSchema,
	changes: placementChangesSchema,
});
export type PlacementUpdatePayload = z.infer<
	typeof placementUpdatePayloadSchema
>;

export const placementCreateCommand = defineCommand<PlacementCreatePayload>({
	type: "placement.create",
	version: 1,
	schema: placementCreatePayloadSchema,
	summarize: (payload, project) =>
		`Place ${clipLabel(project, payload.placement.clipId)} at tick ${payload.placement.startTicks}`,
	apply(project, payload) {
		if (findPlacement(project, payload.placement.id)) {
			return rejected(`Placement ${payload.placement.id} already exists`);
		}
		return applied(
			withSong(project, {
				...project.song,
				placements: [...project.song.placements, payload.placement],
			}),
		);
	},
	invert: (payload) => [removePlacement(payload.placement.id)],
});

export const placementDeleteCommand = defineCommand<PlacementDeletePayload>({
	type: "placement.delete",
	version: 1,
	schema: placementDeletePayloadSchema,
	summarize(payload, project) {
		const placement = findPlacement(project, payload.placementId);
		return placement
			? `Remove ${clipLabel(project, placement.clipId)} from the arrangement`
			: "Remove a placement from the arrangement";
	},
	apply(project, payload) {
		const placement = findPlacement(project, payload.placementId);
		if (!placement) {
			return rejected(`Placement ${payload.placementId} does not exist`);
		}
		return applied(
			withSong(project, {
				...project.song,
				placements: project.song.placements.filter(
					(candidate) => candidate.id !== placement.id,
				),
			}),
		);
	},
	invert(payload, before) {
		const placement = findPlacement(before, payload.placementId);
		return placement ? [addPlacement(placement)] : [];
	},
});

export const placementUpdateCommand = defineCommand<PlacementUpdatePayload>({
	type: "placement.update",
	version: 1,
	schema: placementUpdatePayloadSchema,
	summarize(payload, project) {
		const placement = findPlacement(project, payload.placementId);
		const label = placement
			? clipLabel(project, placement.clipId)
			: "a placement";
		if (payload.changes.startTicks !== undefined) {
			return `Move ${label} to tick ${payload.changes.startTicks}`;
		}
		if (payload.changes.durationTicks !== undefined) {
			return `Resize ${label} to ${payload.changes.durationTicks} ticks`;
		}
		if (payload.changes.looped !== undefined) {
			return `${payload.changes.looped ? "Loop" : "Unloop"} ${label}`;
		}
		return `Edit ${label}`;
	},
	apply(project, payload) {
		const placement = findPlacement(project, payload.placementId);
		if (!placement) {
			return rejected(`Placement ${payload.placementId} does not exist`);
		}
		return applied(
			replacePlacement(project, {
				...placement,
				...(payload.changes.trackId !== undefined
					? { trackId: payload.changes.trackId }
					: {}),
				...(payload.changes.startTicks !== undefined
					? { startTicks: payload.changes.startTicks }
					: {}),
				...(payload.changes.durationTicks !== undefined
					? { durationTicks: payload.changes.durationTicks }
					: {}),
				...(payload.changes.clipOffsetTicks !== undefined
					? { clipOffsetTicks: payload.changes.clipOffsetTicks }
					: {}),
				...(payload.changes.looped !== undefined
					? { looped: payload.changes.looped }
					: {}),
			}),
		);
	},
	invert(payload, before) {
		const placement = findPlacement(before, payload.placementId);
		if (!placement) {
			return [];
		}
		return [
			updatePlacement(payload.placementId, {
				...(payload.changes.trackId !== undefined
					? { trackId: placement.trackId }
					: {}),
				...(payload.changes.startTicks !== undefined
					? { startTicks: placement.startTicks }
					: {}),
				...(payload.changes.durationTicks !== undefined
					? { durationTicks: placement.durationTicks }
					: {}),
				...(payload.changes.clipOffsetTicks !== undefined
					? { clipOffsetTicks: placement.clipOffsetTicks }
					: {}),
				...(payload.changes.looped !== undefined
					? { looped: placement.looped }
					: {}),
			}),
		];
	},
});

// --- Typed builders -------------------------------------------------------

export function addPlacement(
	placement: Placement,
): CommandInput<PlacementCreatePayload> {
	return { type: placementCreateCommand.type, payload: { placement } };
}

export function removePlacement(
	placementId: PlacementId,
): CommandInput<PlacementDeletePayload> {
	return { type: placementDeleteCommand.type, payload: { placementId } };
}

export function updatePlacement(
	placementId: PlacementId,
	changes: PlacementChanges,
): CommandInput<PlacementUpdatePayload> {
	return {
		type: placementUpdateCommand.type,
		payload: { placementId, changes },
	};
}

/** Registered, payload-erased commands from this module. */
export const placementCommands: readonly RegisteredCommand[] = [
	eraseCommand(placementCreateCommand),
	eraseCommand(placementDeleteCommand),
	eraseCommand(placementUpdateCommand),
];
