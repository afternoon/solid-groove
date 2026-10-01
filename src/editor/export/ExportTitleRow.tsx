import type { JSX } from "@solidjs/web";
import ExportReadout from "./ExportReadout";
import type { ExportFacts } from "./exportFacts";

/**
 * The title row of the Release design (EXP-004): an EXPORT eyebrow over the
 * song's name in large type, then Length, Tempo, Tracks and Quality as
 * readouts. The close control is the dialog shell's, pinned at its far right.
 */
export default function ExportTitleRow(props: {
  readonly facts: ExportFacts;
}): JSX.Element {
  return (
    <div class="export-head">
      <div class="export-title">
        <span class="export-label export-eyebrow">Export</span>
        <h2 title={props.facts.name}>{props.facts.name}</h2>
      </div>
      <ExportReadout label="Length">{props.facts.length}</ExportReadout>
      <ExportReadout label="Tempo">{props.facts.tempo}</ExportReadout>
      <ExportReadout label="Tracks">{props.facts.tracks}</ExportReadout>
      <ExportReadout label="Quality">{props.facts.quality}</ExportReadout>
    </div>
  );
}
