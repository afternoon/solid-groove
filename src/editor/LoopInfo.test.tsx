import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Asset } from "../domain/entities";
import { createDrumMachineFixtureProject } from "../domain/fixtures";
import LoopInfo, { loopPitchShiftSemitones } from "./LoopInfo";

afterEach(() => cleanup());

/** The drum-machine fixture carries a two-bar audio loop authored at its
 * song tempo; grab that clip and its resolved asset. */
function loopFixture() {
	const project = createDrumMachineFixtureProject();
	const clip = project.clips.find((c) => c.content.kind === "audioLoop");
	if (!clip || clip.content.kind !== "audioLoop") {
		throw new Error("fixture has no audio loop");
	}
	const content = clip.content;
	const asset =
		project.song.assets.find((a) => a.id === content.assetId) ?? null;
	return { project, clip, asset, sourceTempo: content.sourceTempo };
}

describe("loopPitchShiftSemitones", () => {
	it("is zero when the song plays at the loop's source tempo", () => {
		expect(loopPitchShiftSemitones(120, 120)).toBe(0);
	});

	it("is +12 semitones at double the source tempo (an octave up)", () => {
		expect(loopPitchShiftSemitones(120, 240)).toBeCloseTo(12);
	});

	it("is -12 semitones at half the source tempo (an octave down)", () => {
		expect(loopPitchShiftSemitones(120, 60)).toBeCloseTo(-12);
	});
});

describe("LoopInfo", () => {
	it("labels the clip a tempo-labelled loop and shows its source tempo", () => {
		const { clip, asset, sourceTempo } = loopFixture();
		render(() => (
			<LoopInfo clip={clip} asset={asset} songTempo={sourceTempo} />
		));

		expect(screen.getByText(/tempo-labelled loop/i)).toBeInTheDocument();
		// "Source tempo" is a labelled fact; its value sits in the dd after it.
		const sourceTerm = screen.getByText("Source tempo");
		expect(sourceTerm.nextElementSibling).toHaveTextContent(
			`${sourceTempo} BPM`,
		);
	});

	it("documents the resampling stretch behaviour honestly", () => {
		const { clip, asset, sourceTempo } = loopFixture();
		render(() => (
			<LoopInfo clip={clip} asset={asset} songTempo={sourceTempo} />
		));

		// The honesty requirement: the UI must say it resamples and does not
		// preserve pitch, rather than implying a transparent time-stretch.
		expect(screen.getByText(/resampl/i)).toBeInTheDocument();
		expect(screen.getByText(/does not preserve pitch/i)).toBeInTheDocument();
	});

	it("reports no pitch change when playing at the source tempo", () => {
		const { clip, asset, sourceTempo } = loopFixture();
		render(() => (
			<LoopInfo clip={clip} asset={asset} songTempo={sourceTempo} />
		));

		expect(screen.getByText(/no pitch change/i)).toBeInTheDocument();
	});

	it("reports the live pitch shift when the song tempo differs from the source", () => {
		const { clip, asset, sourceTempo } = loopFixture();
		render(() => (
			<LoopInfo clip={clip} asset={asset} songTempo={sourceTempo * 2} />
		));

		// Double tempo => +12 semitones.
		expect(screen.getByText(/\+12 semitones/i)).toBeInTheDocument();
	});

	it("distinguishes a loop from a pitched one-shot in copy", () => {
		const { clip, asset, sourceTempo } = loopFixture();
		render(() => (
			<LoopInfo clip={clip} asset={asset} songTempo={sourceTempo} />
		));

		expect(screen.getByText(/pitched one-shot/i)).toBeInTheDocument();
	});

	it("surfaces a missing loop asset rather than rendering silence", () => {
		const { clip, sourceTempo } = loopFixture();
		render(() => <LoopInfo clip={clip} asset={null} songTempo={sourceTempo} />);

		expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
	});

	it("renders nothing for a note clip", () => {
		const project = createDrumMachineFixtureProject();
		const noteClip = project.clips.find((c) => c.content.kind === "notes");
		if (!noteClip) throw new Error("fixture has no note clip");
		const asset = project.song.assets[0] as Asset;
		const { container } = render(() => (
			<LoopInfo clip={noteClip} asset={asset} songTempo={120} />
		));

		expect(container.querySelector(".loop-info")).toBeNull();
	});
});
