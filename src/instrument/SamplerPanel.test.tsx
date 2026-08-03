import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Instrument } from "../domain/entities";
import type { AssetId, TrackId } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import SamplerPanel, { type SampleChoice } from "./SamplerPanel";

afterEach(() => cleanup());

const TRACK_ID = "trk_sampler" as TrackId;
const ASSET_A = "ast_a" as AssetId;
const ASSET_B = "ast_b" as AssetId;

const OPTIONS: SampleChoice[] = [
	{ assetId: ASSET_A, name: "Clap" },
	{ assetId: ASSET_B, name: "Snare" },
];

function renderPanel(
	instrument: Extract<Instrument, { kind: "sampler" }> = {
		kind: "sampler",
		assetId: ASSET_A,
		parameters: {},
	},
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
			sampleName="Clap"
			replacementOptions={OPTIONS}
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

	it("replacing the sample dispatches instrument.setSample and emits instrument_changed once", () => {
		const { dispatch, transport } = renderPanel();
		const select = screen.getByRole("combobox") as HTMLSelectElement;
		fireEvent.change(select, { target: { value: ASSET_B } });

		const command = dispatch.mock.calls.at(-1)?.[0] as {
			type: string;
			payload: { assetId: string };
		};
		expect(command.type).toBe("instrument.setSample");
		expect(command.payload.assetId).toBe(ASSET_B);

		const changed = transport.named("instrument_changed");
		expect(changed).toHaveLength(1);
		expect(changed[0].params.instrument_type).toBe("sampler");
		expect(
			transport
				.named("feature_first_use")
				.filter((e) => e.params.feature === "sampler"),
		).toHaveLength(1);
	});

	it("does not emit instrument_changed when the sample swap is rejected", () => {
		const dispatch = vi.fn<
			(
				commands: RawCommandInput | readonly RawCommandInput[],
			) => TransactionResult | undefined
		>(() => ({ ok: false, issues: [] }) as unknown as TransactionResult);
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
				instrument={{ kind: "sampler", assetId: ASSET_A, parameters: {} }}
				sampleName="Clap"
				replacementOptions={OPTIONS}
				dispatch={dispatch}
				audition={vi.fn()}
				analytics={analytics}
			/>
		));
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: ASSET_B },
		});
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
