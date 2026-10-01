import { type JSX, Show } from "@solidjs/web";
import { HiOutlineHeart } from "solid-icons/hi";
import { PlayIcon, StopIcon } from "../components/icons";
import { ariaBool } from "../shared/aria";
import { writeLibrarySampleDrag } from "./assetDrag";
import { LOAD_REASON_LABELS } from "./loadReasons";
import MiniWaveform from "./MiniWaveform";
import type { LibraryAsset } from "./manifest";
import { roleLabel } from "./shelf";
import "./SoundsView.css";

/** "0.42 s" for a one-shot, "120 BPM · 4 bars" for a loop. */
export function lengthLabel(asset: LibraryAsset): string {
  if (asset.type === "loop") {
    const bars = asset.bars ? `${asset.bars} bar${asset.bars === 1 ? "" : "s"}` : null;
    return [asset.bpm ? `${asset.bpm} BPM` : null, bars].filter(Boolean).join(" · ");
  }
  return asset.durationSeconds === null ? "" : `${asset.durationSeconds.toFixed(2)} s`;
}

/** The similar-sounds mark: two overlapping circles, as the reference draws it. */
export function SimilarIcon(props: { size?: number }): JSX.Element {
  return (
    <svg
      width={props.size ?? 15}
      height={props.size ?? 15}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <circle cx="6" cy="8" r="4" />
      <circle cx="10" cy="8" r="4" />
    </svg>
  );
}

/**
 * One compact sound row (LIB-010): play state, waveform, name over
 * `pack · role`, character tags in their own column, and length. Clicking
 * selects and auditions it. The heart is inert until favourites land, and the
 * two circles open similar sounds. The row is also a drag handle onto an
 * instrument (#225), never the only way in.
 */
export default function SoundRow(props: {
  asset: LibraryAsset;
  selected: boolean;
  playing: boolean;
  error: string | null;
  /** The slot's track colour: the selected row's waveform is drawn in it. */
  color?: string;
  /** How close a similar-sounds result is, 0-100: a meter takes the tags' place. */
  match?: number;
  onSelect: () => void;
  onSimilar: () => void;
}): JSX.Element {
  return (
    <li
      class={[
        "sound-row",
        {
          "sound-row-selected": props.selected,
          "sound-row-loop": props.asset.type === "loop",
        },
      ]}
      style={props.selected && props.color ? { "--waveform-fill": props.color } : {}}
      draggable="true"
      onDragStart={(event) => {
        if (!writeLibrarySampleDrag(event.dataTransfer, props.asset)) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="button"
        class="sound-row-main"
        aria-label={`Audition ${props.asset.name}`}
        aria-pressed={ariaBool(props.selected)}
        onClick={() => props.onSelect()}
      >
        <span class="sound-row-play" aria-hidden="true">
          <Show when={props.playing} fallback={<PlayIcon size={12} />}>
            <StopIcon size={12} />
          </Show>
        </span>
        <span class="sound-row-wave">
          <MiniWaveform peaks={props.asset.peaks} />
        </span>
        <span class="sound-row-text">
          <b class="sound-row-name">{props.asset.name}</b>
          <span class="sound-row-meta">
            {props.asset.packName} · {roleLabel(props.asset.role)}
            <Show when={props.error}>
              {" · "}
              {LOAD_REASON_LABELS[props.error ?? ""] ?? "Could not load."}
            </Show>
          </span>
        </span>
        <Show
          when={props.match !== undefined}
          fallback={
            <span class="sound-row-tags">
              {props.asset.characters.slice(0, 2).join(" · ")}
            </span>
          }
        >
          {/* The space keeps "100%" a word of its own in the row's text. */}{" "}
          <span class="similar-match" title={`${props.match}% match`}>
            <span class="similar-meter">
              <span class="similar-meter-fill" style={{ width: `${props.match}%` }} />
            </span>
            <span>{props.match}%</span>
          </span>
        </Show>
        <span class="sound-row-length">{lengthLabel(props.asset)}</span>
      </button>
      <button
        type="button"
        class="sound-row-icon"
        aria-label={`Favourite ${props.asset.name}`}
        disabled
      >
        <HiOutlineHeart size={15} />
      </button>
      <button
        type="button"
        class="sound-row-icon"
        aria-label={`Sounds like ${props.asset.name}`}
        onClick={() => props.onSimilar()}
      >
        <SimilarIcon />
      </button>
    </li>
  );
}
