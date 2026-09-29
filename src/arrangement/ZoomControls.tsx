import type { JSX } from "@solidjs/web";
import {
  HiSolidArrowsPointingOut,
  HiSolidMagnifyingGlassMinus,
  HiSolidMagnifyingGlassPlus,
  HiSolidViewfinderCircle,
} from "solid-icons/hi";
import { detectPlatform, type ShortcutActionId, shortcutLabel } from "../shortcuts";

/**
 * The arrangement's zoom, as one segmented group of icon buttons floating over
 * its bottom-right corner (PRD 9.3 accessibility: a named DOM action beside
 * each canvas gesture, so pixels are never the only way to drive the surface).
 *
 * Top to bottom: zoom to arrangement, zoom to selection (disabled with nothing
 * selected), zoom in, zoom out. There is no visible text; each button's name is
 * its `aria-label` and its tooltip adds the key, read from the shortcut
 * registry so the two cannot disagree. Scroll to playhead is keyboard-only
 * (`view.scroll_to_playhead`).
 */
export interface ZoomControlsProps {
  readonly onZoomToArrangement: () => void;
  readonly onZoomToSelection: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Zoom-to-selection is meaningless with nothing selected. */
  readonly hasSelection: boolean;
}

interface ZoomButtonProps {
  readonly name: string;
  readonly action: ShortcutActionId;
  readonly icon: JSX.Element;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

function ZoomButton(props: ZoomButtonProps) {
  const platform = detectPlatform();
  return (
    <button
      type="button"
      class="arrangement-zoom-button"
      aria-label={props.name}
      title={`${props.name} (${shortcutLabel(props.action, platform)})`}
      disabled={props.disabled}
      onClick={() => props.onClick()}
    >
      {props.icon}
    </button>
  );
}

export function ZoomControls(props: ZoomControlsProps) {
  return (
    <fieldset class="arrangement-zoom" aria-label="Zoom">
      <ZoomButton
        name="Zoom to arrangement"
        action="view.zoom_to_arrangement"
        icon={<HiSolidArrowsPointingOut size={18} />}
        onClick={props.onZoomToArrangement}
      />
      <ZoomButton
        name="Zoom to selection"
        action="view.zoom_to_selection"
        icon={<HiSolidViewfinderCircle size={18} />}
        disabled={!props.hasSelection}
        onClick={props.onZoomToSelection}
      />
      <ZoomButton
        name="Zoom in"
        action="view.zoom_in"
        icon={<HiSolidMagnifyingGlassPlus size={18} />}
        onClick={props.onZoomIn}
      />
      <ZoomButton
        name="Zoom out"
        action="view.zoom_out"
        icon={<HiSolidMagnifyingGlassMinus size={18} />}
        onClick={props.onZoomOut}
      />
    </fieldset>
  );
}
