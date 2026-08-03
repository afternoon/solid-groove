import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { RawCommandInput, TransactionResult } from "../commands";
import type { Track } from "../domain/entities";
import { createDrumMachineFixtureProject } from "../domain/fixtures";
import type { PadId } from "../domain/ids";
import { memoryStorage } from "../testing/storage";
import DrumMachinePanel from "./DrumMachinePanel";

afterEach(() => cleanup());

function drumTrackOf(
	project: ReturnType<typeof createDrumMachineFixtureProject>,
): Track {
	const track = project.song.tracks.find(
		(candidate) => candidate.instrument?.kind === "drumMachine",
	);
	if (!track) throw new Error("expected a drum-machine track in the fixture");
	return track;
}

function renderPanel() {
	const project = createDrumMachineFixtureProject();
	const track = drumTrackOf(project);
	const assets = project.song.assets.filter((asset) => asset.kind === "sample");
	const dispatch =
		vi.fn<
			(
				commands: RawCommandInput | readonly RawCommandInput[],
			) => TransactionResult | undefined
		>();
	const audition = vi.fn<(padId: PadId) => void>();
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	const analytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	analytics.setAccountType("anonymous");
	render(() => (
		<DrumMachinePanel
			track={track}
			assets={assets}
			dispatch={dispatch}
			audition={audition}
			analytics={analytics}
		/>
	));
	return { project, track, assets, dispatch, audition, transport };
}

describe("DrumMachinePanel", () => {
	it("renders one named lane per pad with mute and solo controls", () => {
		const { track } = renderPanel();
		const padNames =
			track.instrument?.kind === "drumMachine"
				? track.instrument.pads.map((pad) => pad.name)
				: [];
		for (const name of padNames) {
			expect(
				screen.getByRole("button", { name: `Audition ${name}` }),
			).toBeInTheDocument();
		}
		// Each pad exposes a Mute and a Solo toggle, named for its pad.
		for (const name of padNames) {
			expect(
				screen.getByRole("button", { name: `Mute ${name}` }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: `Solo ${name}` }),
			).toBeInTheDocument();
		}
	});

	it("dispatches drum.setPadAsset and logs instrument_changed on a sample replacement", () => {
		const { track, assets, dispatch, transport } = renderPanel();
		const selects = screen.getAllByRole("combobox");
		// The first pad's sample selector; pick a different asset than it holds.
		const firstPad =
			track.instrument?.kind === "drumMachine"
				? track.instrument.pads[0]
				: undefined;
		const replacement = assets.find((asset) => asset.id !== firstPad?.assetId);
		expect(replacement).toBeDefined();

		fireEvent.change(selects[0], { target: { value: replacement?.id } });

		expect(dispatch).toHaveBeenCalledTimes(1);
		const command = dispatch.mock.calls[0][0] as {
			type: string;
			payload: { assetId: string };
		};
		expect(command.type).toBe("drum.setPadAsset");
		expect(command.payload.assetId).toBe(replacement?.id);

		const instrumentChanged = transport.events.filter(
			(event) => event.name === "instrument_changed",
		);
		expect(instrumentChanged).toHaveLength(1);
		expect(instrumentChanged[0]?.params.instrument_type).toBe("drum_machine");
	});

	it("logs drum_machine feature_first_use exactly once across several interactions", () => {
		const { transport } = renderPanel();

		fireEvent.click(screen.getAllByRole("button", { name: /^Mute / })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: /^Solo / })[0]);
		fireEvent.click(screen.getAllByRole("button", { name: /^Audition / })[0]);

		const featureEvents = transport.events.filter(
			(event) => event.name === "feature_first_use",
		);
		expect(featureEvents).toHaveLength(1);
		expect(featureEvents[0]?.params.feature).toBe("drum_machine");
	});

	it("toggles pad mute through a drum.setPadFlag command", () => {
		const { dispatch } = renderPanel();
		fireEvent.click(screen.getAllByRole("button", { name: /^Mute / })[0]);

		const command = dispatch.mock.calls[0][0] as {
			type: string;
			payload: { flag: string; value: boolean };
		};
		expect(command.type).toBe("drum.setPadFlag");
		expect(command.payload.flag).toBe("muted");
		expect(command.payload.value).toBe(true);
	});

	it("auditions a pad when its name button is clicked", () => {
		const { track, audition } = renderPanel();
		const firstPadName =
			track.instrument?.kind === "drumMachine"
				? track.instrument.pads[0].name
				: "";
		fireEvent.click(
			screen.getByRole("button", { name: `Audition ${firstPadName}` }),
		);
		expect(audition).toHaveBeenCalledTimes(1);
	});
});
