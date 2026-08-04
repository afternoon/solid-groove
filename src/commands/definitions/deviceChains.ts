import { z } from "zod";
import {
	type ReturnId,
	returnIdSchema,
	type TrackId,
	trackIdSchema,
} from "../../domain/ids";

/**
 * Which insert chain a device command targets (PRD FX-01, LOOP-008).
 *
 * A device lives in exactly one of three kinds of chain — a track's inserts, a
 * return bus's chain, or the master chain — and the `chain` discriminant maps
 * one-to-one onto the `device_added` analytics `chain` parameter. It is shared
 * by every device command so the chain a device belongs to is expressed once.
 */
export const chainTargetSchema = z.discriminatedUnion("chain", [
	z.strictObject({ chain: z.literal("insert"), trackId: trackIdSchema }),
	z.strictObject({ chain: z.literal("return"), returnId: returnIdSchema }),
	z.strictObject({ chain: z.literal("master") }),
]);
export type DeviceChainTarget = z.infer<typeof chainTargetSchema>;

export const insertChain = (trackId: TrackId): DeviceChainTarget => ({
	chain: "insert",
	trackId,
});

export const returnChain = (returnId: ReturnId): DeviceChainTarget => ({
	chain: "return",
	returnId,
});

export const masterChain: DeviceChainTarget = { chain: "master" };
