import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { CommandHistory } from "../commands";
import type { Clip, Project } from "../domain/entities";
import {
	createDenseStepFixtureProject,
	createDrumMachineFixtureProject,
	createSliceFixtureProject,
} from "../domain/fixtures";
import type { EventId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { memoryStorage } from "../testing/storage";
import StepEditor from "./StepEditor";

afterEach(() => cleanup());

/**
 * Renders `StepEditor` over a real `CommandHistory` for the given project's
 * first clip, so paint/erase strokes flow through the same command/gesture
 * kernel the editor uses in production. The rendered clip is reactive: the
 * history's change notifications update it, so the grid reflects each edit.
 */
function renderEditor(project: Project) {
	const clipId = project.clips[0].id;
	const track = project.song.tracks.find(
		(candidate) =>
			candidate.instrument !== null &&
			project.clips[0].trackId === candidate.id,
	);
	const history = new CommandHistory(project);
	const [clip, setClip] = createSignal<Clip>(project.clips[0]);
	const [selectedIds, setSelectedIds] = createSignal<readonly EventId[]>([]);
	history.subscribe((snapshot) => {
		const next = snapshot.project.clips.find(
			(candidate) => candidate.id === clipId,
		);
		if (next) setClip(next);
	});

	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	analytics.setAccountType("anonymous");

	const [playbackStep, setPlaybackStep] = createSignal<number | null>(null);

	render(() => (
		<StepEditor
			clip={clip()}
			instrument={track?.instrument ?? null}
			dispatch={(commands) => history.execute(commands as never)}
			beginGesture={(options) => history.beginGesture(options)}
			playbackStep={playbackStep}
			selectedIds={selectedIds}
			setSelectedIds={setSelectedIds}
			analytics={analytics}
		/>
	));

	return {
		history,
		clip,
		transport,
		selectedIds,
		setSelectedIds,
		setPlaybackStep,
	};
}

function cell(name: string): HTMLElement {
	return screen.getByRole("button", { name });
}

/** A complete paint/erase stroke: down on the first cell, up to commit. */
function stroke(name: string): void {
	const target = cell(name);
	fireEvent.pointerDown(target, { button: 0 });
	fireEvent.pointerUp(target);
}

/**
 * A drag stroke: down on the first cell, entering each of the rest, then up.
 * The final `pointerUp` is fired on the editor region (where the handler lives)
 * rather than a cell, since a cell's accessible name flips from "off" to "on"
 * the moment it is painted.
 */
function dragStroke(names: readonly string[]): void {
	const first = cell(names[0]);
	fireEvent.pointerDown(first, { button: 0 });
	for (const name of names.slice(1)) {
		fireEvent.pointerEnter(cell(name));
	}
	fireEvent.pointerUp(screen.getByRole("region", { name: "Step editor" }));
}

function clipEditedEvents(
	transport: ReturnType<typeof createRecordingTransport>,
) {
	return transport.events.filter((event) => event.name === "clip_edited");
}

describe("StepEditor", () => {
	it("renders one pitched lane for a sampler clip, marking saved steps active", () => {
		renderEditor(createSliceFixtureProject());
		// The single lane is named "Notes"; the slice clip has steps 1, 5, 9, 13 on.
		expect(cell("Notes, step 1, on")).toBeInTheDocument();
		expect(cell("Notes, step 2, off")).toBeInTheDocument();
		expect(cell("Notes, step 5, on")).toBeInTheDocument();
		// 1 bar × 16 steps.
		expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(16);
	});

	it("renders one named lane per pad for a drum-machine clip", () => {
		renderEditor(createDrumMachineFixtureProject());
		expect(screen.getByLabelText("Lane BD")).toBeInTheDocument();
		expect(screen.getByLabelText("Lane CP")).toBeInTheDocument();
		// The drum fixture's beat: BD on 1/5/9/13, CP on 5/13.
		expect(cell("BD, step 1, on")).toBeInTheDocument();
		expect(cell("CP, step 5, on")).toBeInTheDocument();
		expect(cell("CP, step 1, off")).toBeInTheDocument();
	});

	it("paints an empty step with a single note.add gesture and one history entry", () => {
		const { history } = renderEditor(createSliceFixtureProject());
		expect(history.canUndo).toBe(false);

		stroke("Notes, step 2, off");

		expect(cell("Notes, step 2, on")).toBeInTheDocument();
		expect(history.canUndo).toBe(true);
		// One entry for the whole stroke.
		expect(history.entries).toHaveLength(1);
	});

	it("erases an occupied step", () => {
		const { history } = renderEditor(createSliceFixtureProject());
		stroke("Notes, step 1, on");
		expect(cell("Notes, step 1, off")).toBeInTheDocument();
		expect(history.entries).toHaveLength(1);
	});

	it("paints a multi-step drag as one gesture, one history entry, one revision", () => {
		const { history } = renderEditor(createSliceFixtureProject());
		const startRevision = history.project.metadata.revision;

		dragStroke([
			"Notes, step 2, off",
			"Notes, step 3, off",
			"Notes, step 4, off",
		]);

		expect(cell("Notes, step 2, on")).toBeInTheDocument();
		expect(cell("Notes, step 3, on")).toBeInTheDocument();
		expect(cell("Notes, step 4, on")).toBeInTheDocument();
		// One entry, one revision bump, for three painted steps.
		expect(history.entries).toHaveLength(1);
		expect(history.project.metadata.revision).toBe(startRevision + 1);

		// Undo removes all three at once.
		history.undo();
		expect(history.project.metadata.revision).toBe(startRevision + 2);
	});

	it("paints across multiple drum lanes in one drag", () => {
		const { history } = renderEditor(createDrumMachineFixtureProject());
		dragStroke(["BD, step 2, off", "CP, step 2, off"]);
		expect(cell("BD, step 2, on")).toBeInTheDocument();
		expect(cell("CP, step 2, on")).toBeInTheDocument();
		expect(history.entries).toHaveLength(1);
	});

	it("emits clip_edited once per completed paint gesture, bucketed by changed steps", () => {
		const { transport } = renderEditor(createSliceFixtureProject());

		dragStroke([
			"Notes, step 2, off",
			"Notes, step 3, off",
			"Notes, step 4, off",
		]);

		const edited = clipEditedEvents(transport);
		expect(edited).toHaveLength(1);
		expect(edited[0].params.editor).toBe("step");
		// Three steps changed → the 1_4 bucket.
		expect(edited[0].params.event_count_bucket).toBe("1_4");
	});

	it("emits clip_edited per stroke, not per step, across two strokes", () => {
		const { transport } = renderEditor(createSliceFixtureProject());
		stroke("Notes, step 2, off");
		stroke("Notes, step 3, off");
		expect(clipEditedEvents(transport)).toHaveLength(2);
	});

	it("emits one clip_edited for an erase stroke", () => {
		const { transport, history } = renderEditor(createSliceFixtureProject());
		stroke("Notes, step 1, on"); // erase a saved note
		const edited = clipEditedEvents(transport);
		expect(edited).toHaveLength(1);
		expect(edited[0].params.editor).toBe("step");
		expect(history.entries).toHaveLength(1);
	});

	it("logs step_editor feature_first_use once, through the catalog, across two strokes", () => {
		const { transport } = renderEditor(createSliceFixtureProject());
		stroke("Notes, step 2, off");
		stroke("Notes, step 3, off");
		const firstUse = transport.events.filter(
			(event) => event.name === "feature_first_use",
		);
		expect(firstUse).toHaveLength(1);
		expect(firstUse[0].params.feature).toBe("step_editor");
	});

	it("still paints when analytics is disabled, emitting no events", () => {
		const consent = new ConsentStore(memoryStorage());
		consent.set({ productAnalytics: false });
		const transport = createRecordingTransport();
		const analytics = new Analytics({
			transport,
			consent,
			storage: memoryStorage(),
		});
		const project = createSliceFixtureProject();
		const history = new CommandHistory(project);
		const [clip, setClip] = createSignal<Clip>(project.clips[0]);
		history.subscribe((snapshot) => {
			const next = snapshot.project.clips[0];
			if (next) setClip(next);
		});
		render(() => (
			<StepEditor
				clip={clip()}
				instrument={project.song.tracks[0].instrument}
				dispatch={(commands) => history.execute(commands as never)}
				beginGesture={(options) => history.beginGesture(options)}
				analytics={analytics}
			/>
		));

		stroke("Notes, step 2, off");

		// The edit still lands…
		expect(cell("Notes, step 2, on")).toBeInTheDocument();
		expect(history.canUndo).toBe(true);
		// …but with consent denied, nothing was sent.
		expect(transport.events).toHaveLength(0);
	});

	it("selects a painted note and edits its velocity through a note.update command", () => {
		const { history, clip } = renderEditor(createSliceFixtureProject());
		stroke("Notes, step 2, off");

		// A velocity slider appears for the freshly-selected note.
		const velocity = screen.getByRole("slider", { name: "Velocity" });
		fireEvent.input(velocity, { target: { value: "0.25" } });

		const content = clip().content;
		if (content.kind !== "notes") throw new Error("expected a note clip");
		const painted = content.events.find((event) => event.startTicks === 48);
		expect(painted?.velocity).toBeCloseTo(0.25, 2);
		// The paint stroke and the velocity edit are two separate history entries.
		expect(history.entries.length).toBeGreaterThanOrEqual(2);
	});

	it("shift-click selects an existing note without erasing it", () => {
		const { selectedIds, history } = renderEditor(createSliceFixtureProject());
		const target = cell("Notes, step 1, on");
		// jsdom has no PointerEvent, so build a plain event carrying shiftKey.
		const down = new Event("pointerdown", { bubbles: true, cancelable: true });
		Object.assign(down, { button: 0, shiftKey: true });
		target.dispatchEvent(down);
		fireEvent.pointerUp(target);

		// Still on (not erased), and now selected.
		expect(cell("Notes, step 1, on")).toBeInTheDocument();
		expect(selectedIds()).toHaveLength(1);
		expect(history.canUndo).toBe(false);
	});

	it("resizes the clip to a whole number of bars through clip.update", () => {
		const { history, clip } = renderEditor(createSliceFixtureProject());
		expect(clip().lengthTicks).toBe(TICKS_PER_BAR);

		const select = screen.getByRole("combobox", { name: "Bars" });
		fireEvent.change(select, { target: { value: "4" } });

		expect(clip().lengthTicks).toBe(TICKS_PER_BAR * 4);
		// The grid now shows 4 bars × 16 steps on the single lane.
		expect(cell("Notes, step 64, off")).toBeInTheDocument();
		expect(history.entries.at(-1)?.commands[0].type).toBe("clip.update");
	});

	it("marks the current playback step while playing", () => {
		const { setPlaybackStep } = renderEditor(createSliceFixtureProject());
		setPlaybackStep(3);
		// The playing class lands on the cell at step 4 (index 3).
		const playingCell = cell("Notes, step 4, off");
		expect(playingCell.className).toContain("playing");
	});

	it("renders the dense 8-bar fixture with every lane and 128 steps per lane", () => {
		renderEditor(createDenseStepFixtureProject());
		expect(screen.getByLabelText("Lane BD")).toBeInTheDocument();
		expect(screen.getByLabelText("Lane SD")).toBeInTheDocument();
		expect(screen.getByLabelText("Lane HH")).toBeInTheDocument();
		// 8 bars × 16 = 128 steps; the last step exists on each lane.
		expect(cell("BD, step 128, off")).toBeInTheDocument();
		expect(cell("HH, step 127, on")).toBeInTheDocument();
	});

	it("paints and erases without leaving the browser default text selection on", () => {
		renderEditor(createSliceFixtureProject());
		const target = cell("Notes, step 2, off");
		const event = new Event("pointerdown", { bubbles: true, cancelable: true });
		// The handler prevents default so a drag never starts a text selection.
		const prevented = !target.dispatchEvent(event);
		expect(prevented).toBe(true);
	});
});
