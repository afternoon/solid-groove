import type { JSX } from "@solidjs/web";
import "./Toolbar.css";

export interface ToolbarProps {
  readonly selectionCount: number;
  onSelectAll(): void;
  onDelete(): void;
  /** Whether adding, clicking or dragging a note plays it. */
  readonly preview: boolean;
  onTogglePreview(): void;
  /** Time-only zoom, 0.5 to 2. */
  readonly zoom: number;
  onZoomIn(): void;
  onZoomOut(): void;
  readonly playing: boolean;
  onTogglePlay(): void;
}

/**
 * The roll's toolbar: Select all, Delete and the selection count on the left;
 * Preview sound, time zoom and Play on the right, Play being the one white
 * primary action. It has no Duplicate: that is Cmd/Ctrl+D, and the Transform
 * panel's Double.
 *
 * Presentational: every button calls back into the roll.
 */
export default function Toolbar(props: ToolbarProps): JSX.Element {
  return (
    <div class="pr-toolbar">
      <button type="button" class="pr-tool" onClick={() => props.onSelectAll()}>
        Select all
      </button>
      <button
        type="button"
        class="pr-tool"
        disabled={props.selectionCount === 0}
        onClick={() => props.onDelete()}
      >
        Delete
      </button>
      <span class="pr-count" aria-live="polite">
        {props.selectionCount === 0
          ? "None selected"
          : `${props.selectionCount} selected`}
      </span>
      <span class="pr-spacer" />
      <button
        type="button"
        class="pr-tool pr-preview"
        aria-pressed={props.preview ? "true" : "false"}
        onClick={() => props.onTogglePreview()}
      >
        Preview sound
      </button>
      <div class="pr-zoom">
        <span class="pr-zoom-label">Zoom</span>
        <button
          type="button"
          class="pr-tool pr-square"
          aria-label="Zoom out"
          disabled={props.zoom <= 0.5}
          onClick={() => props.onZoomOut()}
        >
          −
        </button>
        <span class="pr-zoom-value">{Math.round(props.zoom * 100)}%</span>
        <button
          type="button"
          class="pr-tool pr-square"
          aria-label="Zoom in"
          disabled={props.zoom >= 2}
          onClick={() => props.onZoomIn()}
        >
          +
        </button>
      </div>
      <button
        type="button"
        class="pr-play"
        aria-pressed={props.playing ? "true" : "false"}
        onClick={() => props.onTogglePlay()}
      >
        {props.playing ? "Stop" : "Play"}
      </button>
    </div>
  );
}
