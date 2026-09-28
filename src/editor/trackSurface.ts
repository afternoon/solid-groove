import type { RawCommandInput, TransactionResult } from "../commands";
import { setTrackFlag } from "../commands";
import type { Track } from "../domain/entities";

/** Flips a track's mute or solo, through the command layer. */
export function toggleTrackFlag(
  dispatch: (
    commands: RawCommandInput | readonly RawCommandInput[],
  ) => TransactionResult | undefined,
  track: Track,
  flag: "muted" | "soloed",
): void {
  dispatch(setTrackFlag(track.id, flag, !track.mixer[flag]));
}
