import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import {
	CommandHistory,
	type Gesture,
	type GestureOptions,
	type RawCommandInput,
} from "../commands";
import type { Project } from "../domain/entities";
import {
	createDrumMachineFixtureProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import type { TrackId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import Mixer from "./Mixer";

afterEach(() => cleanup());

/**
 * A harness that drives the mixer against a real {@link CommandHistory}, so a
 * dispatched command actually mutates the project the mixer re-renders from and
 * a gesture actually collapses into one history entry — the two behaviors the
 * acceptance criteria turn on.
 */
function renderMixer(initial: Project = createSliceFixtureProject()) {
	const history = new CommandHistory(initial);
	const [project, setProject] = createSignal(history.project);

	const dispatch = (commands: RawCommandInput | readonly RawCommandInput[]) => {
		const result = history.execute(commands);
		setProject(history.project);
		return result;
	};

	const beginGesture = (options?: GestureOptions): Gesture => {
		const gesture = history.beginGesture(options);
		return {
			get active() {
				return gesture.active;
			},
			apply(commands) {
				const result = gesture.apply(commands);
				setProject(history.project);
				return result;
			},
			commit(summary) {
				const entry = gesture.commit(summary);
				setProject(history.project);
				return entry;
			},
			cancel() {
				gesture.cancel();
				setProject(history.project);
			},
		};
	};

	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	analytics.setAccountType("anonymous");

	// Track selection is the host's state (`EditorView` holds it in the shared
	// selection model); the harness plays that host, recording what the mixer
	// asks for and feeding the answer back in.
	const selected: TrackId[] = [];
	const [selectedTrackId, setSelectedTrackId] = createSignal<TrackId | null>(
		null,
	);

	render(() => (
		<Mixer
			project={project()}
			dispatch={dispatch}
			beginGesture={beginGesture}
			trackLevelDb={() => null}
			isPlaying={() => false}
			analytics={analytics}
			requestFrame={() => 0}
			cancelFrame={() => {}}
			selectedTrackId={selectedTrackId()}
			onSelectTrack={(trackId) => {
				selected.push(trackId);
				setSelectedTrackId(trackId);
			}}
		/>
	));

	return { history, project, transport, selected };
}

describe("Mixer track management (TRK-01)", () => {
	it("adds an instrument track and emits track_added + the mixer feature key", () => {
		const { history, transport } = renderMixer();
		const before = history.project.song.tracks.length;

		fireEvent.click(screen.getByRole("button", { name: "Add synth track" }));

		expect(history.project.song.tracks.length).toBe(before + 1);
		const added = transport.events.filter((e) => e.name === "track_added");
		expect(added).toHaveLength(1);
		expect(added[0]?.params.track_type).toBe("instrument");
		const firstUse = transport.events.filter(
			(e) => e.name === "feature_first_use",
		);
		expect(firstUse).toHaveLength(1);
		expect(firstUse[0]?.params.feature).toBe("mixer");
	});

	it("emits the mixer feature key at most once across several adds", () => {
		const { transport } = renderMixer();
		fireEvent.click(screen.getByRole("button", { name: "Add synth track" }));
		fireEvent.click(screen.getByRole("button", { name: "Add sampler track" }));
		expect(
			transport.events.filter((e) => e.name === "feature_first_use"),
		).toHaveLength(1);
		// But a track_added fires for each add.
		expect(
			transport.events.filter((e) => e.name === "track_added"),
		).toHaveLength(2);
	});

	it("creates a track of the instrument the user asked for (#223)", () => {
		const { history, transport } = renderMixer();

		for (const [button, kind, analyticsType] of [
			["Add sampler track", "sampler", "sampler"],
			["Add drum machine track", "drumMachine", "drum_machine"],
			["Add synth track", "synth", "synth"],
		] as const) {
			fireEvent.click(screen.getByRole("button", { name: button }));
			const added = history.project.song.tracks.at(-1);
			expect(added?.instrument?.kind, button).toBe(kind);
			expect(
				transport.events.filter((e) => e.name === "track_added").at(-1)?.params
					.instrument_type,
			).toBe(analyticsType);
		}
	});

	it("gives a new track an empty one-bar clip to program, in one transaction", () => {
		const { history } = renderMixer();
		const revisionBefore = history.project.metadata.revision;

		fireEvent.click(screen.getByRole("button", { name: "Add sampler track" }));

		const track = history.project.song.tracks.at(-1);
		const clip = history.project.clips.find((c) => c.trackId === track?.id);
		expect(clip?.content).toEqual({ kind: "notes", events: [] });
		expect(clip?.lengthTicks).toBe(TICKS_PER_BAR);
		const placement = history.project.song.placements.find(
			(p) => p.clipId === clip?.id,
		);
		expect(placement?.startTicks).toBe(0);
		expect(placement?.durationTicks).toBe(TICKS_PER_BAR);

		// Track, clip and placement arrive together: one revision, one undo.
		expect(history.project.metadata.revision).toBe(revisionBefore + 1);
		history.undo();
		expect(history.project.song.tracks).toHaveLength(1);
		expect(history.project.clips.some((c) => c.id === clip?.id)).toBe(false);
	});

	it("opens a new drum machine with a kit of empty pads", () => {
		const { history } = renderMixer();

		fireEvent.click(
			screen.getByRole("button", { name: "Add drum machine track" }),
		);

		const instrument = history.project.song.tracks.at(-1)?.instrument;
		expect(instrument?.kind === "drumMachine" && instrument.pads).toMatchObject(
			[
				{ name: "BD", assetId: null },
				{ name: "SD", assetId: null },
				{ name: "HH", assetId: null },
				{ name: "CP", assetId: null },
			],
		);
	});

	it("names each new track for its instrument, without repeating a name", () => {
		const { history } = renderMixer();

		fireEvent.click(screen.getByRole("button", { name: "Add sampler track" }));
		fireEvent.click(screen.getByRole("button", { name: "Add sampler track" }));

		expect(history.project.song.tracks.map((track) => track.name)).toEqual([
			"BD",
			"Sampler",
			"Sampler 2",
		]);
	});

	it("reports the duplicated track's own instrument on track_added", () => {
		const { transport } = renderMixer(createDrumMachineFixtureProject());

		fireEvent.click(screen.getAllByRole("button", { name: /^Duplicate / })[0]);

		expect(
			transport.events.filter((e) => e.name === "track_added").at(-1)?.params
				.instrument_type,
		).toBe("drum_machine");
	});

	it("selects the track it just added, so the editor follows it (#228)", () => {
		const { history, selected } = renderMixer();

		fireEvent.click(screen.getByRole("button", { name: "Add sampler track" }));

		const added = history.project.song.tracks.at(-1);
		expect(selected).toEqual([added?.id]);
	});

	it("renames a track through a command", () => {
		const { history } = renderMixer();
		const input = screen.getByLabelText("Track name") as HTMLInputElement;
		input.value = "Kick drum";
		fireEvent.change(input);
		expect(history.project.song.tracks[0].name).toBe("Kick drum");
	});

	it("reorders tracks while preserving clip ownership and routing", () => {
		const { history } = renderMixer(createDrumMachineFixtureProject());
		const [first, second] = history.project.song.tracks;
		const firstClips = history.project.clips
			.filter((c) => c.trackId === first.id)
			.map((c) => c.id);

		fireEvent.click(
			screen.getByRole("button", { name: `Move ${first.name} right` }),
		);

		const reordered = history.project.song.tracks;
		// The moved track keeps its id, its clips, and its sends.
		const movedNow = reordered.find((t) => t.id === first.id);
		expect(movedNow?.order).toBe(1);
		expect(
			history.project.clips
				.filter((c) => c.trackId === first.id)
				.map((c) => c.id),
		).toEqual(firstClips);
		expect(movedNow?.sendConfig).toEqual(first.sendConfig);
		expect(reordered.find((t) => t.id === second.id)?.order).toBe(0);
	});

	it("deletes an empty track immediately, warns on a track with clips", () => {
		const { history } = renderMixer(createDrumMachineFixtureProject());
		const trackWithClips = history.project.song.tracks[0];

		fireEvent.click(
			screen.getByRole("button", { name: `Delete ${trackWithClips.name}` }),
		);
		// A confirmation dialog appears rather than deleting outright.
		expect(screen.getByRole("alertdialog")).toBeInTheDocument();
		expect(history.project.song.tracks).toHaveLength(2);

		fireEvent.click(screen.getByRole("button", { name: "Delete track" }));
		expect(
			history.project.song.tracks.some((t) => t.id === trackWithClips.id),
		).toBe(false);
	});

	it("duplicates a track deeply, with fresh clip IDs and a track_added event", () => {
		const { history, transport } = renderMixer(
			createDrumMachineFixtureProject(),
		);
		const source = history.project.song.tracks[0];
		const sourceClipIds = new Set(
			history.project.clips
				.filter((c) => c.trackId === source.id)
				.map((c) => c.id),
		);

		fireEvent.click(
			screen.getByRole("button", { name: `Duplicate ${source.name}` }),
		);

		expect(history.project.song.tracks).toHaveLength(3);
		const copy = history.project.song.tracks.find(
			(t) => t.name === `${source.name} copy`,
		);
		expect(copy).toBeDefined();
		if (!copy) return;
		const copyClips = history.project.clips.filter(
			(c) => c.trackId === copy.id,
		);
		expect(copyClips.length).toBeGreaterThan(0);
		for (const clip of copyClips) {
			expect(sourceClipIds.has(clip.id)).toBe(false);
		}
		expect(
			transport.events.filter((e) => e.name === "track_added"),
		).toHaveLength(1);
	});
});

describe("Mixer controls (TRK-02)", () => {
	it("toggles mute and solo through commands, keyboard accessible", () => {
		const { history } = renderMixer();
		const track = history.project.song.tracks[0];

		const mute = screen.getByRole("button", { name: `Mute ${track.name}` });
		expect(mute).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(mute);
		expect(history.project.song.tracks[0].mixer.muted).toBe(true);

		const solo = screen.getByRole("button", { name: `Solo ${track.name}` });
		fireEvent.click(solo);
		expect(history.project.song.tracks[0].mixer.soloed).toBe(true);
	});

	it("a fader drag commits as exactly one history entry, not one per move", () => {
		const { history } = renderMixer();
		const startRevision = history.project.metadata.revision;
		const fader = screen.getByLabelText(
			`Volume for ${history.project.song.tracks[0].name}`,
		) as HTMLInputElement;

		// A range input streams `input` while the pointer moves and fires one
		// `change` on release — the gesture opens on the first and closes on it.
		for (const position of [0.6, 0.55, 0.5, 0.45]) {
			fader.value = String(position);
			fireEvent.input(fader);
		}
		fireEvent.change(fader);

		// One drag = one revision bump, regardless of how many input events fired.
		expect(history.project.metadata.revision).toBe(startRevision + 1);
		expect(history.entries).toHaveLength(1);
	});

	it("a pan drag commits as exactly one history entry", () => {
		const { history } = renderMixer();
		const startRevision = history.project.metadata.revision;
		const pan = screen.getByLabelText(
			`Pan for ${history.project.song.tracks[0].name}`,
		) as HTMLInputElement;

		for (const value of [0.2, 0.4, 0.6]) {
			pan.value = String(value);
			fireEvent.input(pan);
		}
		fireEvent.change(pan);

		expect(history.project.metadata.revision).toBe(startRevision + 1);
		expect(history.entries).toHaveLength(1);
	});

	it("shows a human-readable dB value and a pan readout", () => {
		const { history } = renderMixer();
		const track = history.project.song.tracks[0];
		// Default volume 0 dB, default pan centre.
		expect(screen.getByText("0.0 dB")).toBeInTheDocument();
		expect(screen.getAllByText("C").length).toBeGreaterThan(0);
		// The fader carries the readable value for assistive tech.
		const fader = screen.getByLabelText(`Volume for ${track.name}`);
		expect(fader).toHaveAttribute("aria-valuetext", "0.0 dB");
	});

	it("builds volume and pan from the shared fill slider, one id per control", () => {
		const { history } = renderMixer(createDrumMachineFixtureProject());
		const trackCount = history.project.song.tracks.length;

		// The design language has exactly one continuous control (mock 06c), so a
		// mixer strip must not grow a second, differently-behaving slider.
		const sliders = Array.from(
			document.querySelectorAll<HTMLInputElement>(".fill-slider-input"),
		);
		expect(sliders).toHaveLength(trackCount * 2);
		// Volume and pan appear once per track, so their ids have to be per-track:
		// a duplicated id would point every strip's <label> at the same input.
		const ids = sliders.map((input) => input.id);
		expect(new Set(ids).size).toBe(ids.length);

		// The fader travels in perceptual fader positions, not raw decibels.
		const fader = screen.getByLabelText(
			`Volume for ${history.project.song.tracks[0].name}`,
		) as HTMLInputElement;
		expect(fader.min).toBe("0");
		expect(fader.max).toBe("1");
	});

	it("lays pan out horizontally and fills it out from centre", () => {
		const { history } = renderMixer();
		const track = history.project.song.tracks[0];
		const pan = screen.getByLabelText(
			`Pan for ${track.name}`,
		) as HTMLInputElement;
		const fader = screen.getByLabelText(`Volume for ${track.name}`);

		// Pan's range is the stereo field, so it moves the way the field reads —
		// left-to-right — while the fader stays vertical.
		expect(pan).toHaveAttribute("aria-orientation", "horizontal");
		expect(fader).toHaveAttribute("aria-orientation", "vertical");

		const slider = pan.closest(".fill-slider");
		const fill = slider?.querySelector<HTMLElement>(".fill-slider-fill");
		expect(slider?.classList.contains("horizontal")).toBe(true);
		expect(slider?.classList.contains("bipolar")).toBe(true);

		// Centre pans paint at the centre, not half a track of accent.
		expect(fill?.style.left).toBe("50%");
		expect(fill?.style.width).toBe("0%");

		// Panned left, the fill runs from the value back to the centre; panned
		// right, from the centre out to the value.
		pan.value = "-0.5";
		fireEvent.change(pan);
		expect(fill?.style.left).toBe("25%");
		expect(fill?.style.width).toBe("25%");

		pan.value = "1";
		fireEvent.change(pan);
		expect(fill?.style.left).toBe("50%");
		expect(fill?.style.width).toBe("50%");
	});

	it("lands a value from a change that had no preceding input", () => {
		const { history } = renderMixer();
		const pan = screen.getByLabelText(
			`Pan for ${history.project.song.tracks[0].name}`,
		) as HTMLInputElement;

		pan.value = "-0.5";
		fireEvent.change(pan);

		expect(history.project.song.tracks[0].mixer.pan).toBeCloseTo(-0.5);
	});

	it("renders a level meter per track", () => {
		const { history } = renderMixer(createDrumMachineFixtureProject());
		const meters = screen.getAllByRole("meter");
		expect(meters).toHaveLength(history.project.song.tracks.length);
	});
});

describe("Mixer track selection (#228)", () => {
	it("selects a track from its strip, and marks the selected one", () => {
		const { history, selected } = renderMixer(
			createDrumMachineFixtureProject(),
		);
		const [drums, breakTrack] = history.project.song.tracks;

		const select = (name: string) =>
			screen.getByRole("button", { name: `Edit ${name}` });
		expect(select(drums.name)).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(select(breakTrack.name));

		expect(selected).toEqual([breakTrack.id]);
		expect(select(breakTrack.name)).toHaveAttribute("aria-pressed", "true");
		expect(select(drums.name)).toHaveAttribute("aria-pressed", "false");
		expect(
			select(breakTrack.name).closest(".mixer-strip")?.classList,
		).toContain("selected");
	});

	it("selects a track when any of its controls is pressed", () => {
		const { history, selected } = renderMixer(
			createDrumMachineFixtureProject(),
		);
		const breakTrack = history.project.song.tracks[1];

		// A fader drag selects before it moves, so the panel you are about to
		// adjust is already the one on screen.
		fireEvent.pointerDown(
			screen.getByLabelText(`Volume for ${breakTrack.name}`),
		);

		expect(selected).toEqual([breakTrack.id]);
	});

	it("counts selecting a track as mixer use, with no event of its own", () => {
		const { history, transport } = renderMixer(
			createDrumMachineFixtureProject(),
		);
		const breakTrack = history.project.song.tracks[1];

		fireEvent.click(
			screen.getByRole("button", { name: `Edit ${breakTrack.name}` }),
		);

		const events = transport.events.filter(
			(event) => event.name === "feature_first_use",
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.params.feature).toBe("mixer");
		// Selection is not a tracked action of its own: nothing else is logged.
		expect(transport.events).toHaveLength(1);
	});
});
