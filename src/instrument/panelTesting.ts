import { fireEvent } from "@solidjs/testing-library";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import type { Gesture, RawCommandInput, TransactionResult } from "../commands";
import { fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";

/**
 * An `Analytics` with a recording transport, never the app singleton.
 *
 * `optedOut` starts it with telemetry declined, which is how a panel proves
 * that disabling analytics changes what is reported and nothing else.
 */
export function testAnalytics(options: { optedOut?: boolean } = {}) {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  if (options.optedOut) consent.optOut();
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  return { transport, analytics };
}

/**
 * A gesture that records what a drag applies, for a panel test with no project
 * behind it. It stays open until the control drops it, as a real one does.
 */
export function recordingGesture(applied: RawCommandInput[]): Gesture {
  return {
    active: true,
    apply(commands) {
      applied.push(...(Array.isArray(commands) ? commands : [commands]));
      return { ok: true } as TransactionResult;
    },
    commit: () => null,
    cancel: () => {},
  };
}

/** One pointer move within a drag: the browser fires `input`, not `change`. */
export function moveTo(slider: HTMLInputElement, value: string): void {
  fireAndFlush(() => {
    fireEvent.input(slider, { target: { value } });
  });
}

/** The painted fill's own extent, which is what a fill-slider's value *is*. */
export function fillExtent(slider: HTMLInputElement): string {
  const fill = slider
    .closest(".fill-slider")
    ?.querySelector<HTMLElement>(".fill-slider-fill");
  return fill?.style.height ?? "";
}
