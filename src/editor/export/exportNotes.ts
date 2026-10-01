import { formatBytes } from "./stemSelection";

/**
 * The words in the Export footer's one-line message slot (EXP-004). Pure, so
 * the dialog and its tests share one source for the copy.
 */

/** The in-browser budget for one ZIP, as the dialog says it. */
const LIMIT_TEXT = "2 GiB";

export interface StemsNoteInput {
  /** How many tracks are on. */
  readonly tracks: number;
  /** How many ZIPs the selection comes as. */
  readonly zips: number;
  /** What all of them weigh together. */
  readonly bytes: number;
}

/** What the slot says before a stems export: why Export is off, or how the stems split. */
export function stemsNote({ tracks, zips, bytes }: StemsNoteInput): string {
  if (tracks === 0) return "Turn on at least one track to export stems.";
  if (zips > 1) {
    return (
      `${formatBytes(bytes)} is over the ${LIMIT_TEXT} browser limit, so stems come as ` +
      `${zips} ZIPs in track order, each downloaded when ready.`
    );
  }
  return `Stems over ${LIMIT_TEXT} come as several ZIPs in track order. These fit in one.`;
}
