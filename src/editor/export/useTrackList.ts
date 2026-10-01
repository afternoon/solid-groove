import { createMemo, createSignal } from "solid-js";
import type { Project } from "../../domain/entities";
import type { TrackId } from "../../domain/ids";
import type { ShortcutHandlers } from "../../shortcuts";
import type { ShortcutContext } from "../../shortcuts/types";
import { deriveTrackLaneRows, songLengthBars, type TrackLaneView } from "./trackLanes";
import type { ClickModifiers } from "./trackListSelection";
import {
  applyPickAction,
  clickRow,
  EMPTY_TRACK_LIST,
  isIncluded,
  type ListCommand,
  type PickAction,
  runListCommand,
  type TrackListState,
} from "./trackListSelection";

/**
 * The Export dialog's track list as reactive state (EXP-004): the pure
 * `trackListSelection` model held in a signal, the rows the lanes draw, and the
 * registry's list keys turned into handlers. The dialog owns one of these;
 * nothing here knows a key, only which registered action runs which command.
 */

const DIALOG: readonly ShortcutContext[] = ["dialog"];
const DIALOG_LIST: readonly ShortcutContext[] = ["dialog", "export_tracks"];

export interface UseTrackListOptions {
  readonly project: () => Project;
  /** Whether the list can be changed: stems chosen, and no export running. */
  readonly editable: () => boolean;
  /** Stereo mix: a row is in it unless its track is muted, whatever was picked. */
  readonly stereo: () => boolean;
}

export function useTrackList(options: UseTrackListOptions) {
  const rows = createMemo(() => deriveTrackLaneRows(options.project()));
  const bars = createMemo(() => songLengthBars(rows()));
  const [state, setState] = createSignal<TrackListState>(EMPTY_TRACK_LIST);
  const [focused, setFocused] = createSignal(false);

  const views = createMemo((): TrackLaneView[] => {
    const current = state();
    const mix = options.stereo();
    return rows().map((row) => ({
      ...row,
      included: mix ? !row.muted : isIncluded(current, row),
      picked: current.picked.has(row.id),
    }));
  });
  /** The tracks a stem export includes, in track order; returns always ride along. */
  const trackIds = createMemo(() => {
    const current = state();
    return rows()
      .filter((row) => !row.fixed && isIncluded(current, row))
      .map((row) => row.id as TrackId);
  });

  /** Applies one command; whether it was the list's to take (Escape's question). */
  function run(command: ListCommand): boolean {
    if (!options.editable()) return false;
    const result = runListCommand(state(), rows(), command);
    if (result.handled) setState(result.state);
    return result.handled;
  }
  const command = (name: ListCommand) => ({ run: () => void run(name) });

  const handlers = (): ShortcutHandlers => ({
    "export.focus_previous": command("focus_prev"),
    "export.focus_next": command("focus_next"),
    "export.extend_previous": command("extend_prev"),
    "export.extend_next": command("extend_next"),
    "export.toggle_focused": command("flip"),
    "export.pick_all": command("pick_all"),
  });

  return {
    rows: views,
    bars,
    trackIds,
    /** The row the keyboard is on: the first until one is chosen, as a listbox starts. */
    focusId: () => state().focus ?? rows()[0]?.id ?? null,
    handlers,
    /** The list's keys are live only while it is editable and has focus. */
    contexts: (): readonly ShortcutContext[] =>
      options.editable() && focused() ? DIALOG_LIST : DIALOG,
    run,
    setFocused,
    click(index: number, modifiers: ClickModifiers): void {
      const row = rows()[index];
      if (row) setState(clickRow(state(), rows(), row.id, modifiers));
    },
    pick(action: PickAction): void {
      setState(applyPickAction(state(), rows(), action));
    },
  };
}

export type TrackList = ReturnType<typeof useTrackList>;
