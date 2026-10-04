import type { Project } from "../domain/entities";
import { type ControlAddress, uniqueControls } from "./controlAddress";
import { requireCommand } from "./registry";
import type { RawCommandInput } from "./types";

/**
 * The on-screen controls a command changes (`UI-004`, #850).
 *
 * The one place an address is derived from a command: it looks the command up
 * in the registry, validates its payload the way execution does, and asks the
 * definition's own `touches`. A proposal line links to these, a preview
 * outlines them, and an applied change keeps them outlined, so every surface
 * that marks a change agrees on what changed.
 *
 * `project` is the state the command applies to. Only a delete reads it, to
 * name the list the deleted entity was in (a deleted placement reveals its
 * track's lane), since the payload alone carries just the ID that is going.
 *
 * Throws for an unregistered type or an invalid payload — the same commands
 * `executeTransaction` would refuse — rather than guessing at an address.
 */
export function controlsTouchedBy(
  command: RawCommandInput,
  project: Project,
): readonly ControlAddress[] {
  const definition = requireCommand(command.type);
  const parsed = definition.parsePayload(command.payload);
  if (!parsed.ok) {
    throw new TypeError(
      `Cannot address an invalid ${command.type} payload: ${parsed.message}`,
    );
  }
  return uniqueControls(definition.touches(parsed.payload, project));
}
