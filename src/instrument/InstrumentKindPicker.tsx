import { type JSX, Show } from "@solidjs/web";
import { createSignal } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { changeInstrument, removeNotes } from "../commands";
import ConfirmDialog from "../components/ConfirmDialog";
import type { Instrument, Project } from "../domain/entities";
import { createFactoryContext, type DomainFactoryContext } from "../domain/factories";
import type { TrackId } from "../domain/ids";
import "./InstrumentPanel.css";
import {
  countPadTriggeredHits,
  createInstrumentOfKind,
  INSTRUMENT_KINDS,
  type InstrumentKind,
  instrumentKindSpec,
  type PadTriggeredHits,
  padTriggeredHits,
} from "./instrumentKinds";
import OptionGroup from "./OptionGroup";

/** Mints pad IDs for drum machines this picker creates. A module singleton. */
const defaultFactoryContext = createFactoryContext();

export interface InstrumentKindPickerProps {
  readonly trackId: TrackId;
  readonly project: Project;
  /** The track's current instrument, or null when it has none. */
  readonly instrument: Instrument | null;
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Defaults to the application singleton; injectable for tests. */
  readonly analytics?: Analytics;
  /** Overrides the pad-ID factory so tests are deterministic. */
  readonly factoryContext?: DomainFactoryContext;
}

/**
 * The instrument-kind switch at the head of a track's instrument panel (#224).
 *
 * Before this, a track kept whichever instrument it was born with: the command
 * layer could replace one (`instrument.change`) but nothing dispatched it, so
 * wanting a sampler on a synth track meant deleting the track. Switching keeps
 * the track's name, mixer settings, devices, sends, and clips, in one undoable
 * transaction that emits `instrument_changed` with the new type.
 *
 * Leaving a drum machine is the one lossy direction: a pad-triggered note may
 * only name a pad its own track owns, so those hits cannot survive the switch.
 * Rather than let the transaction be rejected whole — which would look like a
 * dead control — the picker confirms first, then deletes the hits in the *same*
 * transaction as the instrument change, so one undo brings both back. Following
 * the mixer's precedent, a track with nothing to lose switches with no ceremony.
 */
export default function InstrumentKindPicker(
  props: InstrumentKindPickerProps,
): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const factoryContext = () => props.factoryContext ?? defaultFactoryContext;
  const [pendingKind, setPendingKind] = createSignal<InstrumentKind | null>(null);

  /** The hits a switch away from the drum machine would strand. */
  const strandedHits = (kind: InstrumentKind): readonly PadTriggeredHits[] =>
    kind === "drumMachine" ? [] : padTriggeredHits(props.project, props.trackId);

  function select(kind: InstrumentKind): void {
    if (kind === props.instrument?.kind) return;
    const hits = strandedHits(kind);
    if (hits.length > 0) {
      setPendingKind(kind);
      return;
    }
    change(kind, hits);
  }

  function change(kind: InstrumentKind, hits: readonly PadTriggeredHits[]): void {
    const result = props.dispatch([
      ...hits.map((hit) => removeNotes(hit.clipId, hit.eventIds)),
      changeInstrument(props.trackId, createInstrumentOfKind(factoryContext(), kind)),
    ]);
    if (!result?.ok) return;
    const type = instrumentKindSpec(kind).analyticsType;
    analytics().log("instrument_changed", { instrument_type: type });
    analytics().logFeatureFirstUse(type);
  }

  function confirmPending(): void {
    const kind = pendingKind();
    if (!kind) return;
    setPendingKind(null);
    change(kind, strandedHits(kind));
  }

  const pendingLabel = () => {
    const kind = pendingKind();
    return kind ? instrumentKindSpec(kind).label : "";
  };
  const pendingHitCount = () => {
    const kind = pendingKind();
    return kind ? countPadTriggeredHits(strandedHits(kind)) : 0;
  };

  return (
    <section class="instrument-panel instrument-kind" aria-label="Instrument">
      <div class="instrument-panel-group">
        <h3 class="instrument-panel-heading">Instrument</h3>
        <OptionGroup
          legend="Instrument type"
          value={props.instrument?.kind ?? null}
          options={INSTRUMENT_KINDS.map((spec) => ({
            value: spec.kind,
            label: spec.label,
          }))}
          onSelect={select}
        />
      </div>
      <Show when={pendingKind()}>
        <ConfirmDialog
          title={`Change this track to a ${pendingLabel().toLowerCase()}?`}
          message={`${pendingHitCount()} drum ${pendingHitCount() === 1 ? "hit" : "hits"} in this track's clips can only play on a drum machine and will be deleted. Undo restores them.`}
          confirmLabel="Change instrument"
          onConfirm={confirmPending}
          onCancel={() => setPendingKind(null)}
        />
      </Show>
    </section>
  );
}
