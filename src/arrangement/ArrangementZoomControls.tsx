import type { JSX } from "@solidjs/web";
import { detectPlatform, type ShortcutActionId, shortcutLabel } from "../shortcuts";

/**
 * The arrangement's named DOM actions (PRD 9.3 accessibility): a segmented,
 * icon-only group floating over the view's bottom-right corner, top to bottom
 * zoom to arrangement, zoom to selection, zoom in, zoom out. Real buttons, so
 * canvas pixels are never the sole way to drive the surface; each names its
 * shortcut from the registry in its tooltip (#494).
 */
export interface ArrangementZoomControlsProps {
  readonly onZoomToArrangement: () => void;
  readonly onZoomToSelection: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Zoom-to-selection is meaningless with nothing selected. */
  readonly hasSelection: boolean;
}

interface ZoomButton {
  readonly label: string;
  readonly shortcut: ShortcutActionId;
  readonly icon: JSX.Element;
}

const svgProps = {
  viewBox: "0 0 16 16",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.5,
  "aria-hidden": "true",
} as const;

const ICONS = {
  arrangement: (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button carries the name
    <svg {...svgProps}>
      <path d="M3 3v10M13 3v10M3.5 8h9M3.5 8l2.5-2.5M3.5 8 6 10.5M12.5 8 10 5.5M12.5 8 10 10.5" />
    </svg>
  ),
  selection: (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button carries the name
    <svg {...svgProps}>
      <rect x="2" y="3" width="12" height="10" stroke-dasharray="2 2" />
      <rect x="5.5" y="6" width="5" height="4" />
    </svg>
  ),
  in: (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button carries the name
    <svg {...svgProps}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  out: (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button carries the name
    <svg {...svgProps}>
      <path d="M3 8h10" />
    </svg>
  ),
} as const;

export function ArrangementZoomControls(props: ArrangementZoomControlsProps) {
  const platform = detectPlatform();
  const handlers = {
    arrangement: () => props.onZoomToArrangement(),
    selection: () => props.onZoomToSelection(),
    in: () => props.onZoomIn(),
    out: () => props.onZoomOut(),
  } as const;
  const buttons: readonly (ZoomButton & { key: keyof typeof handlers })[] = [
    {
      key: "arrangement",
      label: "Zoom to arrangement",
      shortcut: "view.zoom_to_arrangement",
      icon: ICONS.arrangement,
    },
    {
      key: "selection",
      label: "Zoom to selection",
      shortcut: "view.zoom_to_selection",
      icon: ICONS.selection,
    },
    {
      key: "in",
      label: "Zoom in",
      shortcut: "view.zoom_in",
      icon: ICONS.in,
    },
    {
      key: "out",
      label: "Zoom out",
      shortcut: "view.zoom_out",
      icon: ICONS.out,
    },
  ];

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset drags in a legend and default box styling for a four-button strip
    <div class="arrangement-zoom" role="group" aria-label="Zoom">
      {buttons.map((button) => (
        <button
          type="button"
          class="arrangement-zoom-button"
          aria-label={button.label}
          title={`${button.label} (${shortcutLabel(button.shortcut, platform)})`}
          disabled={button.key === "selection" && !props.hasSelection}
          onClick={handlers[button.key]}
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
