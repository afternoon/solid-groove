import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { detectCapabilities, FULLY_CAPABLE } from "./capabilities";
import { reportMissingCapabilities } from "./reportCapabilities";

function recordingAnalytics() {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  return { analytics, transport };
}

describe("reportMissingCapabilities", () => {
  it("reports each missing capability once, marking the ones sound needs as required", () => {
    const { analytics, transport } = recordingAnalytics();
    const report = detectCapabilities({});

    reportMissingCapabilities(report, analytics);
    reportMissingCapabilities(report, analytics);

    const events = transport
      .named("browser_capability_missing")
      .map((event) => event.params);
    expect(events).toHaveLength(report.missing.length);
    expect(events).toContainEqual(
      expect.objectContaining({ capability: "web_audio", is_required: true }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ capability: "canvas_2d", is_required: false }),
    );
  });

  it("reports nothing for a fully capable browser", () => {
    const { analytics, transport } = recordingAnalytics();
    reportMissingCapabilities(FULLY_CAPABLE, analytics);
    expect(transport.named("browser_capability_missing")).toEqual([]);
  });
});
