import { createEffect, createMemo, createSignal, For, type JSX, on } from "solid-js";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import { bucketOf } from "../analytics/buckets";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Clip, Project } from "../domain/entities";
import { createFactoryContext } from "../domain/factories";
import type { EventId } from "../domain/ids";
import {
  buildTransform,
  canTransform,
  DEFAULT_TRANSFORM_OPTIONS,
  resolveTransformScope,
  TRANSFORM_KINDS,
  TRANSFORM_LABELS,
  type TransformKind,
  type TransformOptions,
  transformedEventCount,
} from "./transformModel";
import "./TransformPanel.css";

/** Mints event IDs for the copies `notes.duplicate` creates (see StepEditor). */
const factoryContext = createFactoryContext();

export interface TransformPanelProps {
  readonly clip: Clip;
  readonly project: Project;
  /** The editor's current note selection; empty means "the whole clip". */
  readonly selectedIds: readonly EventId[];
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Which editor hosts the panel, for `clip_edited`'s `editor` parameter. */
  readonly editor: "step" | "piano_roll";
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

/**
 * The CLP-04 musical-transformation panel: transpose, velocity scale, quantize,
 * duplicate, clear, and seeded rhythmic variation for the current selection.
 *
 * Every button dispatches one of the six already-registered `notes.*` commands
 * (`src/commands/definitions/transforms.ts`) — the same ones the assistant
 * calls, with the same validation, generated inverse, and summary. The panel
 * adds no mutation path of its own (PRD section 9.6), which is what gives it
 * two properties the CLP-04 criteria turn on: one transformation is one
 * transaction (so undo is atomic and redo exact, `vary` included, its
 * randomness coming from the payload's seed rather than `Math.random`), and a
 * boundary case is a rejection rather than a clamp — surfaced to the user
 * instead of silently applying a partial result.
 */
export default function TransformPanel(props: TransformPanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;
  const [options, setOptions] = createSignal<TransformOptions>(DEFAULT_TRANSFORM_OPTIONS);
  const [error, setError] = createSignal<string | null>(null);

  const scope = createMemo(() => resolveTransformScope(props.clip, props.selectedIds));
  const enabled = createMemo(() => canTransform(scope()));

  // A refusal describes the clip as it was when the user clicked. Once the clip
  // changes underneath — another transformation, an undo, a remote edit — the
  // message may no longer be true, so it is dropped rather than left to mislead.
  createEffect(
    on(
      () => props.clip,
      () => setError(null),
      { defer: true },
    ),
  );

  function scopeLabel(): string {
    const { count, isWholeClip } = scope();
    if (count === 0) return "no notes";
    const noun = count === 1 ? "note" : "notes";
    return isWholeClip ? `all ${count} ${noun}` : `${count} selected ${noun}`;
  }

  function applyTransform(kind: TransformKind): void {
    const current = scope();
    if (!canTransform(current)) return;
    const command = buildTransform(kind, {
      project: props.project,
      clip: props.clip,
      scope: current,
      ids: factoryContext.ids,
      options: options(),
    });
    const count = transformedEventCount(kind, current, props.clip);
    // `feature_first_use` is marked before the dispatch: reaching for a
    // transformation is the feature being used, whether or not the command
    // accepts this particular payload.
    analytics().logFeatureFirstUse(
      props.editor === "step" ? "step_editor" : "piano_roll",
    );
    const result = props.dispatch(command as RawCommandInput);
    if (result && !result.ok) {
      // A rejected transformation changed nothing, so it is not an edit and
      // emits no `clip_edited`.
      setError(rejectionMessage(kind));
      return;
    }
    setError(null);
    analytics().log("clip_edited", {
      editor: props.editor,
      event_count_bucket: bucketOf("event_count", count),
    });
  }

  return (
    <section class="transform-panel" aria-label="Musical transformations">
      <div class="transform-row">
        <For each={TRANSFORM_KINDS}>
          {(kind) => (
            <button
              type="button"
              class="transform-button"
              onClick={() => applyTransform(kind)}
              disabled={!enabled()}
              aria-label={`${TRANSFORM_LABELS[kind]} ${
                kind === "clear" ? "clip" : scopeLabel()
              }`}
            >
              {TRANSFORM_LABELS[kind]}
            </button>
          )}
        </For>
      </div>
      <div class="transform-row transform-options">
        <NumberOption
          label="Semitones"
          step={1}
          value={options().semitones}
          onValue={(value) => setOptions((c) => ({ ...c, semitones: Math.round(value) }))}
        />
        <NumberOption
          label="Velocity x"
          step={0.05}
          value={options().velocityFactor}
          onValue={(value) =>
            value > 0 && setOptions((c) => ({ ...c, velocityFactor: value }))
          }
        />
        <label class="transform-option">
          <span>Vary seed</span>
          <input
            type="text"
            value={options().seed}
            onInput={(event) => {
              const seed = event.currentTarget.value;
              if (seed.length > 0) setOptions((c) => ({ ...c, seed }));
            }}
          />
        </label>
      </div>
      <p class="transform-scope" aria-live="polite">
        Applies to {scopeLabel()}
      </p>
      {/* A rejection is shown, not swallowed: the command refuses to clamp a
			    note out of range, so the user needs to know why nothing moved. */}
      <p class="transform-error" role="alert">
        {error() ?? ""}
      </p>
    </section>
  );
}

/**
 * Why a transformation was refused, in the user's terms.
 *
 * The command layer's own issue text names entity IDs and raw tick counts —
 * right for a log or an assistant, wrong for a person looking at a grid. The
 * refusals are few and known, so each gets a sentence that says what to change.
 */
function rejectionMessage(kind: TransformKind): string {
  switch (kind) {
    case "transpose":
      return "That would move a note outside the playable pitch range. Try fewer semitones.";
    case "duplicate":
      return "The copies would not fit inside this clip. Make the clip longer first.";
    default:
      return "That transformation could not be applied to this clip.";
  }
}

/** One labelled numeric option. Non-numeric input is ignored, never coerced. */
function NumberOption(props: {
  readonly label: string;
  readonly step: number;
  readonly value: number;
  onValue(value: number): void;
}): JSX.Element {
  return (
    <label class="transform-option">
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step}
        value={props.value}
        onInput={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) props.onValue(value);
        }}
      />
    </label>
  );
}
