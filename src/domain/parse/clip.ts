import type { Clip, Track } from "../entities";
import { TICKS_PER_BAR } from "../time";
import { claimId, type DomainIssue, issue } from "./primitives";

/**
 * Clip-local integrity: everything a clip document can be judged on without its
 * owning track or the song's assets. Both `parseClip` and the aggregate path run
 * this, so the two entry points agree on what a valid clip is.
 *
 * Aggregate callers pass their `seenIds` set so event IDs are also unique across
 * the whole project.
 */
export function checkClipInvariants(
  clip: Clip,
  path: ReadonlyArray<string | number>,
  seenIds: Set<string> = new Set(),
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (clip.content.kind !== "notes") {
    return issues;
  }
  clip.content.events.forEach((event, index) => {
    const eventPath = [...path, "content", "events", index] as const;
    claimId(seenIds, event.id, [...eventPath, "id"], issues);
    if (event.startTicks >= clip.lengthTicks) {
      issues.push(
        issue(
          "invalid_musical_time",
          [...eventPath, "startTicks"],
          `Note ${event.id} starts at ${event.startTicks} which is outside its ${clip.lengthTicks}-tick clip`,
        ),
      );
    }
  });
  return issues;
}

/**
 * Clip integrity that depends on the clip's owner and the song's assets, and so
 * is only decidable in the aggregate path.
 */
export function checkClipOwnership(
  clip: Clip,
  owner: Track | undefined,
  assetIds: ReadonlySet<string>,
  path: ReadonlyArray<string | number>,
): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (clip.content.kind === "audioLoop") {
    if (!assetIds.has(clip.content.assetId)) {
      issues.push(
        issue(
          "dangling_reference",
          [...path, "content", "assetId"],
          `Clip ${clip.id} references missing asset ${clip.content.assetId}`,
        ),
      );
    }
    // INS-02: "Every loop declares source BPM and bar length." The source BPM
    // is range-checked by the clip content schema (SONG_TEMPO); the bar length
    // is checked here because a tempo-labelled loop is authored to a whole
    // number of bars — that is what lets its boundaries stay aligned when the
    // song tempo moves. A length that is not a multiple of one bar could never
    // tile the arrangement grid cleanly, so it is malformed input, not content
    // to repair.
    if (clip.lengthTicks % TICKS_PER_BAR !== 0) {
      issues.push(
        issue(
          "invalid_musical_time",
          [...path, "lengthTicks"],
          `Audio loop clip ${clip.id} has length ${clip.lengthTicks} ticks, which is not a whole number of bars (${TICKS_PER_BAR} ticks)`,
        ),
      );
    }
    // The authored start offset selects where inside the loop its first repeat
    // begins; an offset at or past the loop's own length would skip the entire
    // clip and leave nothing to play, so it is rejected rather than silently
    // wrapping.
    if (clip.content.startOffsetTicks >= clip.lengthTicks) {
      issues.push(
        issue(
          "invalid_musical_time",
          [...path, "content", "startOffsetTicks"],
          `Audio loop clip ${clip.id} start offset ${clip.content.startOffsetTicks} is not before its length ${clip.lengthTicks}`,
        ),
      );
    }
    return issues;
  }
  const padIds = new Set(
    owner?.instrument?.kind === "drumMachine"
      ? owner.instrument.pads.map((pad) => pad.id)
      : [],
  );
  clip.content.events.forEach((event, index) => {
    const eventPath = [...path, "content", "events", index] as const;
    if (event.trigger.kind === "pad" && !padIds.has(event.trigger.padId)) {
      issues.push(
        issue(
          "dangling_reference",
          [...eventPath, "trigger", "padId"],
          `Note ${event.id} triggers pad ${event.trigger.padId}, which its track does not own`,
        ),
      );
    }
  });
  return issues;
}
