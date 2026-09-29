import { TRACK_COLORS } from "../domain/factories";

/**
 * A project's preview colour until it has cover art (#532): a deterministic
 * pick from the track palette keyed on its ID, so a project keeps its colour
 * between visits and devices without storing anything.
 */
export function projectSwatchColor(projectId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < projectId.length; i++) {
    hash = Math.imul(hash ^ projectId.charCodeAt(i), 16777619);
  }
  return TRACK_COLORS[(hash >>> 0) % TRACK_COLORS.length];
}
