import type { Analytics } from "../analytics/analytics";
import { CAPABILITY_SEVERITY, type CapabilityReport } from "./capabilities";

/**
 * Reports each capability `report` found missing as
 * `browser_capability_missing` (#75), at most once per capability per
 * browser: a missing API is a property of the browser, so a producer who opens
 * ten projects in it is still one observation.
 */
export function reportMissingCapabilities(
  report: CapabilityReport,
  analytics: Pick<Analytics, "logOnce">,
): void {
  for (const capability of report.missing) {
    analytics.logOnce(`capability:${capability}`, "browser_capability_missing", {
      capability,
      is_required: CAPABILITY_SEVERITY[capability] === "required",
    });
  }
}
