import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawCommandInput, TransactionResult } from "../commands";
import { createSliceFixtureProject } from "../domain/fixtures";
import StepGrid from "./StepGrid";

afterEach(() => cleanup());

function renderGrid() {
	const project = createSliceFixtureProject();
	const clip = project.clips[0];
	const dispatch =
		vi.fn<
			(
				commands: RawCommandInput | readonly RawCommandInput[],
			) => TransactionResult | undefined
		>();
	render(() => <StepGrid clip={clip} dispatch={dispatch} />);
	return { clip, dispatch };
}

describe("StepGrid", () => {
	it("renders 16 steps, marking the clip's existing notes active", () => {
		renderGrid();

		const steps = screen.getAllByRole("button");
		expect(steps).toHaveLength(16);
		// The slice fixture's four-on-the-floor clip: steps 1, 5, 9, 13.
		expect(
			screen.getByRole("button", { name: "Step 1, on" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Step 5, on" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Step 2, off" }),
		).toBeInTheDocument();
	});

	it("dispatches note.add for an empty step", () => {
		const { clip, dispatch } = renderGrid();

		fireEvent.click(screen.getByRole("button", { name: "Step 2, off" }));

		expect(dispatch).toHaveBeenCalledTimes(1);
		const command = dispatch.mock.calls[0][0] as {
			type: string;
			payload: { clipId: string };
		};
		expect(command.type).toBe("note.add");
		expect(command.payload.clipId).toBe(clip.id);
	});

	it("dispatches note.remove for an occupied step", () => {
		const { clip, dispatch } = renderGrid();

		fireEvent.click(screen.getByRole("button", { name: "Step 1, on" }));

		expect(dispatch).toHaveBeenCalledTimes(1);
		const command = dispatch.mock.calls[0][0] as {
			type: string;
			payload: { clipId: string; eventIds: string[] };
		};
		expect(command.type).toBe("note.remove");
		expect(command.payload.clipId).toBe(clip.id);
		expect(command.payload.eventIds).toHaveLength(1);
	});
});
