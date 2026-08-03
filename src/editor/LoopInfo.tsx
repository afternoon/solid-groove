import { HiSolidArrowsRightLeft, HiSolidMusicalNote } from "solid-icons/hi";
import { type JSX, Show } from "solid-js";
import type { Asset, Clip } from "../domain/entities";
import { ticksToBars } from "../domain/time";
import "./LoopInfo.css";

export interface LoopInfoProps {
	/** The audio-loop clip to describe. */
	readonly clip: Clip;
	/** The clip's resolved asset, or `null`/`undefined` when it is missing. */
	readonly asset: Asset | null | undefined;
	/** The current song tempo, so the panel can report the live stretch amount. */
	readonly songTempo: number;
}

/** Rounds a possibly-fractional bar count for display without lying about it. */
function formatBars(lengthTicks: number): string {
	const bars = ticksToBars(lengthTicks);
	const rounded = Math.round(bars * 100) / 100;
	return `${rounded} ${rounded === 1 ? "bar" : "bars"}`;
}

/**
 * The pitch shift, in semitones, that resampling a loop from its source tempo
 * to the song tempo introduces. Positive means the loop plays higher. Exactly
 * `12 * log2(songTempo / sourceTempo)` — this is the honest audible cost of the
 * alpha's resampling stretch, surfaced rather than hidden.
 */
export function loopPitchShiftSemitones(
	sourceTempo: number,
	songTempo: number,
): number {
	if (sourceTempo <= 0 || songTempo <= 0) return 0;
	return 12 * Math.log2(songTempo / sourceTempo);
}

function formatSemitones(semitones: number): string {
	const rounded = Math.round(semitones * 10) / 10;
	if (Math.abs(rounded) < 0.05) return "no pitch change";
	const sign = rounded > 0 ? "+" : "";
	return `${sign}${rounded} semitone${Math.abs(rounded) === 1 ? "" : "s"}`;
}

/**
 * LOOP-006 / INS-02: the surface that distinguishes a tempo-labelled audio
 * loop from a pitched one-shot sample and documents the alpha's stretch
 * behaviour honestly.
 *
 * The alpha follows project tempo by *resampling* — it speeds the loop up or
 * slows it down like a tape, so its pitch moves with the tempo. It does not
 * pitch-preserve (no time-stretching), and this panel says so plainly, in the
 * UI, alongside the exact pitch shift at the current tempo. That honesty is an
 * acceptance criterion, not a nicety: a user reaching for a loop needs to know
 * why it sounds higher at a faster tempo.
 */
export default function LoopInfo(props: LoopInfoProps): JSX.Element {
	// Only audio-loop clips are described here; a note clip is a pitched-content
	// clip and renders nothing.
	return (
		<Show
			when={props.clip.content.kind === "audioLoop" ? props.clip.content : null}
		>
			{(content) => {
				const sourceTempo = content().sourceTempo;
				const semitones = loopPitchShiftSemitones(sourceTempo, props.songTempo);
				const stretched = Math.abs(semitones) >= 0.05;
				return (
					<section class="loop-info" aria-label="Audio loop">
						<div class="loop-info-header">
							<span class="loop-badge loop-badge-tempo">
								<HiSolidArrowsRightLeft size={14} aria-hidden="true" />
								Tempo-labelled loop
							</span>
							<Show
								when={props.asset}
								fallback={
									<span class="loop-asset loop-asset-missing">
										Loop audio is unavailable
									</span>
								}
							>
								{(asset) => <span class="loop-asset">{asset().name}</span>}
							</Show>
						</div>
						<dl class="loop-info-facts">
							<div class="loop-fact">
								<dt>Source tempo</dt>
								<dd>{sourceTempo} BPM</dd>
							</div>
							<div class="loop-fact">
								<dt>Length</dt>
								<dd>{formatBars(props.clip.lengthTicks)}</dd>
							</div>
							<div class="loop-fact">
								<dt>Playing at</dt>
								<dd>{props.songTempo} BPM</dd>
							</div>
						</dl>
						<p class="loop-stretch-note">
							<HiSolidMusicalNote
								size={14}
								aria-hidden="true"
								class="loop-stretch-icon"
							/>
							This alpha follows the project tempo by resampling the loop, so
							its pitch moves with the tempo — like speeding up or slowing down
							a tape. It does not preserve pitch.{" "}
							<Show
								when={stretched}
								fallback={
									<span class="loop-stretch-live">
										At {props.songTempo} BPM it plays at its source tempo, so
										there is no pitch change.
									</span>
								}
							>
								<span class="loop-stretch-live">
									At {props.songTempo} BPM it is shifted{" "}
									{formatSemitones(semitones)} from the source recording.
								</span>
							</Show>
						</p>
						<p class="loop-contrast-note">
							A pitched one-shot sample plays at a fixed pitch you choose and
							does not follow the tempo — this clip is a loop, so it does.
						</p>
					</section>
				);
			}}
		</Show>
	);
}
