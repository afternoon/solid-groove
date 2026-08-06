import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Instrument } from "../domain/entities";
import type { AssetId, TrackId } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import SamplerPanel from "./SamplerPanel";

afterEach(() => cleanup());

const TRACK_ID = "trk_sampler" as TrackId;
const ASSET_A = "ast_a" as AssetId;

function renderPanel(
	instrument: Extract<Instrument, { kind: "sampler" }> = {
		kind: "sampler",
		assetId: ASSET_A,
		parameters: {},
	},
	sampleName: string | null = "Clap",
) {
	const dispatch = vi.fn<
		(
			commands: RawCommandInput | readonly RawCommandInput[],
		) => TransactionResult | undefined
	>(() => ({ ok: true }) as TransactionResult);
	const audition = vi.fn();
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	analytics.setAccountType("anonymous");
	render(() => (
		<SamplerPanel
			trackId={TRACK_ID}
			instrument={instrument}
			sampleName={sampleName}
			dispatch={dispatch}
			audition={audition}
			analytics={analytics}
		/>
	));
	return { dispatch, audition, transport };
}

describe("SamplerPanel", () => {
	it("renders the sample name, playback, and amp-envelope sliders", () => {
		renderPanel();
		expect(screen.getByText("Clap", { selector: "p" })).toBeInTheDocument();
		expect(screen.getByLabelText("Pitch")).toBeInTheDocument();
		expect(screen.getByLabelText("Start")).toBeInTheDocument();
		expect(screen.getByLabelText("End")).toBeInTheDocument();
		expect(screen.getByLabelText("Attack")).toBeInTheDocument();
	});

	it("says so when it is holding nothing, and how to fill it", () => {
		renderPanel({ kind: "sampler", assetId: null, parameters: {} }, null);
		expect(screen.getByText("No sample loaded")).toBeInTheDocument();
		expect(
			screen.getByText("Drag a sound here from the library"),
		).toBeInTheDocument();
	});

	it("dispatches an instrument parameter.set once when a slider commits", () => {
		const { dispatch, transport } = renderPanel();
		const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
		fireEvent.input(pitch, { target: { value: "5" } });
		fireEvent.change(pitch, { target: { value: "5" } });

		expect(dispatch).toHaveBeenCalledTimes(1);
		const command = dispatch.mock.calls[0][0] as {
			type: string;
			payload: { target: { scope: string; parameterId: string } };
		};
		expect(command.type).toBe("parameter.set");
		expect(command.payload.target.scope).toBe("instrument");
		expect(command.payload.target.parameterId).toBe("pitch");
		// No instrument_changed for a plain parameter edit.
		expect(transport.named("instrument_changed")).toHaveLength(0);
	});

	it("emits nothing per input tick before a slider commits", () => {
		const { dispatch, transport } = renderPanel();
		const pitch = screen.getByLabelText("Pitch") as HTMLInputElement;
		fireEvent.input(pitch, { target: { value: "1" } });
		fireEvent.input(pitch, { target: { value: "2" } });
		expect(dispatch).not.toHaveBeenCalled();
		expect(transport.events).toHaveLength(0);
	});

	it("auditions on the audition button", () => {
		const { audition } = renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "Audition" }));
		expect(audition).toHaveBeenCalledTimes(1);
	});
});
