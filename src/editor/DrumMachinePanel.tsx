import { For, type JSX, Show } from "@solidjs/web";
import { type Analytics, analytics as defaultAnalytics } from "../analytics/analytics";
import type { RawCommandInput, TransactionResult } from "../commands";
import { setPadAsset, setPadChoke, setPadFlag, setPadParameter } from "../commands";
import type { Asset, DrumPad, Track } from "../domain/entities";
import type { AssetId, PadId } from "../domain/ids";
import { PAD_PITCH, TRACK_PAN, TRACK_VOLUME } from "../domain/parameters";
import "./DrumMachinePanel.css";

/** The choke-group options a pad can join (PRD INS-01). `none` clears it. */
const CHOKE_GROUPS = Array.from({ length: 8 }, (_, i) => i);

export interface DrumMachinePanelProps {
  readonly track: Track;
  /** The project's sample assets, offered as pad sources. */
  readonly assets: readonly Asset[];
  dispatch(
    commands: RawCommandInput | readonly RawCommandInput[],
  ): TransactionResult | undefined;
  /** Plays one pad immediately so the user hears their choice (audition). */
  audition?(padId: PadId): void;
  /** Defaults to the application's singleton; injectable for tests. */
  readonly analytics?: Analytics;
}

function pads(track: Track): readonly DrumPad[] {
  return track.instrument?.kind === "drumMachine" ? track.instrument.pads : [];
}

/**
 * The drum-machine instrument panel (PRD INS-01, LOOP-005): one named lane per
 * pad, each with sample selection, audition, pitch, level, pan, amp envelope,
 * mute/solo, and choke group. Every edit is a shared drum command dispatched
 * through the same command layer a keyboard shortcut or the assistant would use
 * — the panel never mutates project state directly (PRD section 9.6).
 */
export default function DrumMachinePanel(props: DrumMachinePanelProps): JSX.Element {
  const analytics = () => props.analytics ?? defaultAnalytics;

  /** Marks the drum machine as reached, once per account per browser. */
  function markFeatureUse(): void {
    analytics().logFeatureFirstUse("drum_machine");
  }

  function changePadAsset(pad: DrumPad, assetId: AssetId | null): void {
    markFeatureUse();
    props.dispatch(setPadAsset(props.track.id, pad.id, assetId));
    // A pad sample replacement is an instrument change (PRD OPS-02).
    analytics().log("instrument_changed", { instrument_type: "drum_machine" });
  }

  function setParameter(
    pad: DrumPad,
    parameterId: Parameters<typeof setPadParameter>[2],
    value: number,
  ): void {
    if (!Number.isFinite(value)) return;
    markFeatureUse();
    props.dispatch(setPadParameter(props.track.id, pad.id, parameterId, value));
  }

  function toggleFlag(pad: DrumPad, flag: "muted" | "soloed"): void {
    markFeatureUse();
    props.dispatch(setPadFlag(props.track.id, pad.id, flag, !pad.mixer[flag]));
  }

  function changeChoke(pad: DrumPad, value: number | null): void {
    markFeatureUse();
    props.dispatch(setPadChoke(props.track.id, pad.id, value));
  }

  function audition(pad: DrumPad): void {
    markFeatureUse();
    props.audition?.(pad.id);
  }

  function padParam(pad: DrumPad, key: string, fallback: number): number {
    const value = pad.parameters[key];
    return value === undefined ? fallback : value;
  }

  return (
    <section class="drum-machine" aria-label={`Drum machine: ${props.track.name}`}>
      <For each={pads(props.track)}>
        {(pad) => (
          <div class={["drum-pad", { muted: pad.mixer.muted }]}>
            <button
              type="button"
              class="pad-audition"
              onClick={() => audition(pad)}
              aria-label={`Audition ${pad.name}`}
              title={`Audition ${pad.name}`}
            >
              <span class="pad-name">{pad.name}</span>
            </button>

            <label class="pad-control pad-sample">
              <span class="pad-control-label">Sample</span>
              <select
                value={pad.assetId ?? ""}
                onChange={(event) =>
                  changePadAsset(
                    pad,
                    event.currentTarget.value === ""
                      ? null
                      : (event.currentTarget.value as AssetId),
                  )
                }
              >
                <option value="">— none —</option>
                <For each={props.assets}>
                  {(asset) => <option value={asset.id}>{asset.name}</option>}
                </For>
              </select>
            </label>

            <label class="pad-control">
              <span class="pad-control-label">Pitch</span>
              <input
                type="range"
                min={PAD_PITCH.min}
                max={PAD_PITCH.max}
                step={PAD_PITCH.step ?? 1}
                value={padParam(pad, "pitch", PAD_PITCH.defaultValue)}
                onInput={(event) =>
                  setParameter(pad, PAD_PITCH.id, event.currentTarget.valueAsNumber)
                }
              />
            </label>

            <label class="pad-control">
              <span class="pad-control-label">Level</span>
              <input
                type="range"
                min={TRACK_VOLUME.min}
                max={TRACK_VOLUME.max}
                step={0.5}
                value={pad.mixer.volume}
                onInput={(event) =>
                  setParameter(pad, TRACK_VOLUME.id, event.currentTarget.valueAsNumber)
                }
              />
            </label>

            <label class="pad-control">
              <span class="pad-control-label">Pan</span>
              <input
                type="range"
                min={TRACK_PAN.min}
                max={TRACK_PAN.max}
                step={0.01}
                value={pad.mixer.pan}
                onInput={(event) =>
                  setParameter(pad, TRACK_PAN.id, event.currentTarget.valueAsNumber)
                }
              />
            </label>

            <label class="pad-control pad-choke">
              <span class="pad-control-label">Choke</span>
              <select
                value={pad.chokeGroup === null ? "" : String(pad.chokeGroup)}
                onChange={(event) =>
                  changeChoke(
                    pad,
                    event.currentTarget.value === ""
                      ? null
                      : Number(event.currentTarget.value),
                  )
                }
              >
                <option value="">None</option>
                <For each={CHOKE_GROUPS}>
                  {(group) => <option value={String(group)}>{group + 1}</option>}
                </For>
              </select>
            </label>

            <div class="pad-flags">
              <button
                type="button"
                class={["pad-flag", { active: pad.mixer.muted }]}
                aria-pressed={pad.mixer.muted ? "true" : "false"}
                aria-label={`Mute ${pad.name}`}
                onClick={() => toggleFlag(pad, "muted")}
                title="Mute"
              >
                M
              </button>
              <button
                type="button"
                class={["pad-flag", { active: pad.mixer.soloed }]}
                aria-pressed={pad.mixer.soloed ? "true" : "false"}
                aria-label={`Solo ${pad.name}`}
                onClick={() => toggleFlag(pad, "soloed")}
                title="Solo"
              >
                S
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={pads(props.track).length === 0}>
        <p class="drum-machine-empty">This track has no drum pads yet.</p>
      </Show>
    </section>
  );
}
