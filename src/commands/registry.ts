import { clipCommands } from "./definitions/clips";
import { deviceCommands } from "./definitions/devices";
import { drumCommands } from "./definitions/drum";
import { instrumentCommands } from "./definitions/instruments";
import { noteCommands } from "./definitions/notes";
import { packCommands } from "./definitions/packs";
import { parameterCommands } from "./definitions/parameters";
import { placementCommands } from "./definitions/placements";
import { trackCommands } from "./definitions/tracks";
import { transformCommands } from "./definitions/transforms";
import type { RegisteredCommand } from "./types";

/**
 * The command registry (PRD section 9.6).
 *
 * One registry serves pointer UI, keyboard shortcuts, tests, and — once
 * `AI-001` lands — assistant tool calls, so every mutation path shares the
 * same validation, inverse, and summary. A command that is not registered here
 * cannot change a project.
 */

/**
 * Each module erases its own commands' payload types (see `eraseCommand`), so
 * one heterogeneous registry needs no `any` and no cast here.
 */
const ALL_DEFINITIONS: readonly RegisteredCommand[] = [
	...noteCommands,
	...transformCommands,
	...clipCommands,
	...trackCommands,
	...placementCommands,
	...parameterCommands,
	...drumCommands,
	...instrumentCommands,
	...packCommands,
	...deviceCommands,
];

function buildRegistry(
	definitions: readonly RegisteredCommand[],
): ReadonlyMap<string, RegisteredCommand> {
	const registry = new Map<string, RegisteredCommand>();
	for (const definition of definitions) {
		if (registry.has(definition.type)) {
			throw new TypeError(`Command "${definition.type}" is already registered`);
		}
		registry.set(definition.type, definition);
	}
	return registry;
}

const REGISTRY = buildRegistry(ALL_DEFINITIONS);

/** Every registered command type, in registration order. */
export const COMMAND_TYPES: readonly string[] = [...REGISTRY.keys()];

export function commandRegistry(): ReadonlyMap<string, RegisteredCommand> {
	return REGISTRY;
}

export function findCommand(type: string): RegisteredCommand | undefined {
	return REGISTRY.get(type);
}

export function requireCommand(type: string): RegisteredCommand {
	const command = REGISTRY.get(type);
	if (!command) {
		throw new TypeError(`Unknown command "${type}"`);
	}
	return command;
}

export function isRegisteredCommand(type: string): boolean {
	return REGISTRY.has(type);
}
