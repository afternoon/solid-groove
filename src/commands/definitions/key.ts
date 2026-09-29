import type { z } from "zod";
import { type MusicalKey, musicalKeySchema } from "../../domain/musicalKey";
import { withSong } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
} from "../types";

/**
 * The song key command (ARR-010).
 *
 * The key is song state (`song.key`), so it changes only through `key.set`:
 * one revision and one history entry, with an exact inverse. The payload is
 * the whole key rather than a root or a scale on its own, so replay, redo and
 * an assistant preview land on the same key whatever the song held before.
 *
 * It does not repair a key. A chromatic key with a root other than C fails the
 * domain invariant and the transaction rolls back; the piano roll is what
 * resets the root when a producer chooses Chromatic.
 */

export const keySetPayloadSchema = musicalKeySchema;
export type KeySetPayload = z.infer<typeof keySetPayloadSchema>;

/** Root names for the summary, sharps only, C = 0. */
const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "C minor", "A harmonic minor", or "chromatic". */
function describeKey(key: MusicalKey): string {
  if (key.scale === "chromatic") return "chromatic";
  return `${ROOT_NAMES[key.root]} ${key.scale.replace(/_/g, " ")}`;
}

export const keySetCommand = defineCommand<KeySetPayload>({
  type: "key.set",
  version: 1,
  schema: keySetPayloadSchema,
  summarize: (payload) => `Set the key to ${describeKey(payload)}`,
  apply(project, payload) {
    return applied(
      withSong(project, {
        ...project.song,
        key: { root: payload.root, scale: payload.scale },
      }),
    );
  },
  invert: (_payload, before) => [setKey(before.song.key)],
});

// --- Typed builders -------------------------------------------------------

export function setKey(key: MusicalKey): CommandInput<KeySetPayload> {
  return { type: keySetCommand.type, payload: { root: key.root, scale: key.scale } };
}

/** Registered, payload-erased commands from this module. */
export const keyCommands: readonly RegisteredCommand[] = [eraseCommand(keySetCommand)];
