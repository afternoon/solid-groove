import { For, type JSX, Show } from "@solidjs/web";
import type { NamedEntity } from "../domain/packs";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import type { UserSoundAvailability } from "../userLibrary/userPacks";
import "./MissingSounds.css";

/**
 * The project's personal sounds that are gone from the producer's library
 * (#282): a sound deleted from its pack, or a whole pack deleted. Each one is
 * named with the tracks and clips it leaves silent, so the producer knows what
 * to fix. The project itself is never changed: nothing is removed or
 * substituted, and the sound comes back if it is restored.
 */
export interface MissingSoundsProps {
  readonly report: UserSoundAvailability;
  /** The name of one of the producer's packs, or `null` when it is gone. */
  packName(packId: string): string | null;
}

interface MissingLine {
  readonly key: string;
  readonly sound: string;
  readonly where: string;
  readonly tracks: readonly NamedEntity<string>[];
  readonly clips: readonly NamedEntity<string>[];
}

function lines(props: MissingSoundsProps): MissingLine[] {
  const deleted = props.report.missingAssets.map((entry) => ({
    key: entry.assetId,
    sound: entry.name,
    where: `was deleted from ${props.packName(entry.packId) ?? "its pack"}`,
    tracks: entry.tracks,
    clips: entry.clips,
  }));
  const packGone = props.report.missingPacks.flatMap((entry) =>
    entry.assets.map((asset) => ({
      key: asset.id,
      sound: asset.name,
      where: "was in a pack that has been deleted",
      tracks: entry.tracks,
      clips: entry.clips,
    })),
  );
  return [...deleted, ...packGone];
}

const names = (entities: readonly NamedEntity<string>[]) =>
  entities.map((entity) => entity.name).join(", ");

export default function MissingSounds(props: MissingSoundsProps): JSX.Element {
  const missing = () => lines(props);
  return (
    <section class="missing-sounds" aria-label="Missing sounds">
      <p class="missing-sounds-title">
        {missing().length === 1
          ? "A sound this project uses is missing from your library."
          : `${missing().length} sounds this project uses are missing from your library.`}
      </p>
      <ul class="missing-sounds-list">
        <For each={missing()} keyed={(line) => line.key}>
          {(line) => (
            <li>
              <b class={MASK_CONTENT}>{line().sound}</b> {line().where}.
              <Show when={line().tracks.length > 0}>
                {" "}
                {line().tracks.length === 1 ? "Track" : "Tracks"}:{" "}
                <span class={MASK_CONTENT}>{names(line().tracks)}</span>.
              </Show>
              <Show when={line().clips.length > 0}>
                {" "}
                {line().clips.length === 1 ? "Clip" : "Clips"}:{" "}
                <span class={MASK_CONTENT}>{names(line().clips)}</span>.
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
