/**
 * The project context a turn sends, cut from the assistant projection
 * (`src/projection/assistantContextProjection.ts`) down to ADR 0007's
 * allowlist. The projection carries the project's ID and a fingerprint for
 * the app's own use; neither is on the list, so neither leaves.
 */
import type { AssistantContext } from "../projection/assistantContextProjection";
import type { AssistantContextPayload } from "./protocol";

export function assistantContextPayload(
  context: AssistantContext,
): AssistantContextPayload {
  return {
    projectName: context.projectName,
    tempo: context.tempo,
    timeSignature: {
      numerator: context.timeSignature.numerator,
      denominator: context.timeSignature.denominator,
    } as AssistantContextPayload["timeSignature"],
    totalTicks: context.totalTicks,
    tracks: context.tracks.map((track) => ({ ...track })),
    sections: context.sections.map((section) => ({ ...section })),
    selection: context.selection
      ? {
          description: context.selection.description,
          countByKind: { ...context.selection.countByKind } as Record<string, number>,
        }
      : null,
  };
}
