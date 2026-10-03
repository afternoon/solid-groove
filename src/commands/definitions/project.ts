import { z } from "zod";
import { projectMetadataSchema } from "../../domain/entities";
import { CONTROL_PARTS, controlAddress, SONG_ENTITY } from "../controlAddress";
import { quoted } from "../projectEdits";
import {
  applied,
  type CommandInput,
  defineCommand,
  eraseCommand,
  type RegisteredCommand,
} from "../types";

/**
 * Project commands: edits to the project's own metadata rather than its song.
 *
 * `project.rename` changes `metadata.name` only. The name is validated by the
 * domain's own `displayName` rule (1-120 characters), so an empty or overlong
 * name fails the transaction rather than being repaired. The inverse restores
 * the exact previous name.
 */

export const projectRenamePayloadSchema = z.strictObject({
  name: projectMetadataSchema.shape.name,
});
export type ProjectRenamePayload = z.infer<typeof projectRenamePayloadSchema>;

export const projectRenameCommand = defineCommand<ProjectRenamePayload>({
  type: "project.rename",
  version: 1,
  schema: projectRenamePayloadSchema,
  touches: () => [controlAddress(SONG_ENTITY, CONTROL_PARTS.name)],
  summarize: (payload) => `Rename project to ${quoted(payload.name)}`,
  apply: (project, payload) =>
    applied({ ...project, metadata: { ...project.metadata, name: payload.name } }),
  invert: (_payload, before) => [renameProject(before.metadata.name)],
});

// --- Typed builders -------------------------------------------------------

export function renameProject(name: string): CommandInput<ProjectRenamePayload> {
  return { type: projectRenameCommand.type, payload: { name } };
}

/** Registered, payload-erased commands from this module. */
export const projectCommands: readonly RegisteredCommand[] = [
  eraseCommand(projectRenameCommand),
];
