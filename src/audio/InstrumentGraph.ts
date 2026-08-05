import type { Instrument } from "../domain/entities";
import { createDrumMachineInstrumentNode } from "./instruments/drumMachine";
import { createSamplerInstrumentNode } from "./instruments/sampler";
import { createSynthInstrumentNode } from "./instruments/synth";
import type {
	InstrumentGraphContext,
	InstrumentNode,
} from "./instruments/types";

export { playOneShot } from "./instruments/assetVoice";
export type {
	InstrumentGraphContext,
	InstrumentNode,
	InstrumentNodeFactory,
} from "./instruments/types";

// --- Factory ---------------------------------------------------------------

export function createInstrumentNode(
	instrument: Instrument,
	context: InstrumentGraphContext,
): InstrumentNode {
	switch (instrument.kind) {
		case "sampler":
			return createSamplerInstrumentNode(instrument, context);
		case "synth":
			return createSynthInstrumentNode(instrument, context);
		case "drumMachine":
			return createDrumMachineInstrumentNode(instrument, context);
	}
}
