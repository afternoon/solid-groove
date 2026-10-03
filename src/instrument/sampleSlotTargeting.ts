import { createContext, useContext } from "solid-js";

/**
 * Which sample slot this is, on the selected track (`UI-002`). The instrument
 * view only ever shows the selected track, so a slot is named by its kind, and
 * a drum pad's by its pad.
 */
export type SampleSlotId =
  | { readonly kind: "sampler" | "loop" }
  | { readonly kind: "pad"; readonly padId: string };

/** What every sample slot shows about the Library (`UI-002`). */
export interface SampleSlotTargeting {
  /** The key that opens the Library, from the registry: `4`. */
  readonly keyLabel?: string;
  /** Whether the Library is aimed at this slot. */
  isTarget(slot: SampleSlotId): boolean;
}

/**
 * Provided once by the editor, read by every `SampleSlot`, so the sampler, the
 * drum machine and the loop player share the Library's target without each
 * panel threading it through.
 */
export const SampleSlotTargetingContext = createContext<SampleSlotTargeting>({
  isTarget: () => false,
});

export const useSampleSlotTargeting = (): SampleSlotTargeting =>
  useContext(SampleSlotTargetingContext);
