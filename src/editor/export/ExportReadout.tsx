import type { JSX } from "@solidjs/web";

/**
 * A readout of the Release design (EXP-004): a small uppercase label over its
 * value. The title row and the footer both set their facts this way, so the
 * shape lives once.
 */
export interface ExportReadoutProps {
  readonly label: string;
  readonly children: JSX.Element;
  /** A fixed width, so a value that changes never moves its neighbours. */
  readonly widthPx?: number;
}

export default function ExportReadout(props: ExportReadoutProps): JSX.Element {
  return (
    <div
      class="export-readout"
      style={props.widthPx ? { width: `${props.widthPx}px` } : undefined}
    >
      <span class="export-label">{props.label}</span>
      <b class="export-value">{props.children}</b>
    </div>
  );
}
