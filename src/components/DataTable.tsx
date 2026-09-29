import { For, type JSX } from "@solidjs/web";
import "./DataTable.css";

export interface DataTableColumn {
  /** The column's name: the visible header, and what assistive tech reads. */
  readonly label: string;
  /** A CSS width for a fixed column; columns without one share what is left. */
  readonly width?: string;
  /** Keep the name for assistive tech but draw nothing (an icon-only column). */
  readonly hideLabel?: boolean;
}

export interface DataTableProps {
  readonly label: string;
  readonly columns: readonly DataTableColumn[];
  /** Extra classes for the `<table>` and for its header row. */
  readonly class?: string;
  readonly headClass?: string;
  /** Hide the header row from assistive tech, for a table whose every cell already names itself. */
  readonly headHidden?: boolean;
  /** The body rows: `<tr>`s of `<td>`s, one per column. */
  readonly children: JSX.Element;
}

/**
 * The one dense table (#447 drum-pad table, #532 project list): a hairline
 * between rows, a small uppercase header, a fixed layout so every row lands on
 * the same columns. It owns the chrome and the header; rows stay the caller's,
 * because what a row does (select, rename in place) is not table business.
 */
export default function DataTable(props: DataTableProps): JSX.Element {
  return (
    <table class={["data-table", props.class]} aria-label={props.label}>
      <colgroup>
        <For each={props.columns}>
          {(column) => <col style={column.width ? { width: column.width } : undefined} />}
        </For>
      </colgroup>
      <thead>
        <tr class={props.headClass} aria-hidden={props.headHidden ? "true" : undefined}>
          <For each={props.columns}>
            {(column) => (
              <th scope="col">
                <span class={{ "visually-hidden": !!column.hideLabel }}>
                  {column.label}
                </span>
              </th>
            )}
          </For>
        </tr>
      </thead>
      <tbody>{props.children}</tbody>
    </table>
  );
}
