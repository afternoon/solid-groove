import { type JSX, Show } from "@solidjs/web";
import { HiOutlineHeart, HiOutlineSparkles } from "solid-icons/hi";
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

/**
 * One compact sound row (LIB-010): play state, waveform, name, `pack · role`,
 * character tags and length. Clicking selects and auditions it. The heart is
 * inert until favourites land, and the sparkle button opens similar sounds.
 * The row is also a drag handle onto an instrument (#225), never the only way in.
 */
export default function SoundRow(props: {
  asset: LibraryAsset;
  selected: boolean;
  playing: boolean;
  error: string | null;
  /** The slot's track colour: the selected row's waveform is drawn in it. */
  color?: string;
  onSelect: () => void;
  onSimilar: () => void;
}): JSX.Element {
  return (
    <li
      class={["sound-row", { "sound-row-selected": props.selected }]}
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
            <Show when={props.asset.characters.length > 0}>
              {" · "}
              {props.asset.characters.slice(0, 2).join(", ")}
            </Show>
            <Show when={props.error}>
              {" · "}
              {LOAD_REASON_LABELS[props.error ?? ""] ?? "Could not load."}
            </Show>
          </span>
        </span>
        <span class="sound-row-length">{lengthLabel(props.asset)}</span>
      </button>
      <button
        type="button"
        class="sound-row-icon"
        aria-label={`Favourite ${props.asset.name}`}
        disabled
      >
        <HiOutlineHeart size={16} />
      </button>
      <button
        type="button"
        class="sound-row-icon"
        aria-label={`Sounds like ${props.asset.name}`}
        onClick={() => props.onSimilar()}
      >
        <HiOutlineSparkles size={16} />
      </button>
    </li>
  );
}
