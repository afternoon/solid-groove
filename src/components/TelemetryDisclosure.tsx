import { type Component, createSignal, onCleanup } from "solid-js";
import {
	type ConsentState,
	type ConsentStore,
	consentStore,
} from "../analytics/consent";
import "./TelemetryDisclosure.css";

/**
 * The user-facing disclosure and opt-out (PRD `OPS-02`, section 10 Security
 * and privacy).
 *
 * "The user is told what is collected and can decline product analytics
 * without losing any DAW or assistant capability." Turning this off stops
 * collection and changes nothing else — there is no capability behind it,
 * which `src/telemetry.test.ts` asserts by running the core journey (edit,
 * save, undo) with collection disabled and both transports throwing, and
 * comparing the result against the same journey with telemetry working.
 *
 * ## What this task does and does not decide
 *
 * `FND-001c` owns the mechanism: a persisted preference, an accessible
 * control, and a disclosure naming both processors. `DEC-009` owns the
 * *default state* (see `CONSENT_DEFAULT`) and the *final wording*. The copy
 * below is deliberately plain and factual so it is accurate as written, and it
 * is isolated here so settling `DEC-009` is a copy change in one file.
 *
 * `LOOP-001b` places this surface on the landing page per `DEC-009`; it is
 * mounted in the app footer meanwhile so the opt-out is reachable from every
 * surface rather than existing only in code.
 */
const TelemetryDisclosure: Component<{ store?: ConsentStore }> = (props) => {
	const store = props.store ?? consentStore;
	const [state, setState] = createSignal<ConsentState>(store.current);
	onCleanup(store.subscribe(setState));

	const enabled = () => state().productAnalytics || state().errorMonitoring;

	const toggle = () => {
		if (enabled()) {
			store.optOut();
		} else {
			store.optIn();
		}
	};

	return (
		<details class="telemetry-disclosure">
			<summary class="telemetry-disclosure-summary">Privacy</summary>
			<div class="telemetry-disclosure-body">
				<p>
					Solid Groove records which features are used and reports errors, so we
					can tell what works and fix what breaks. Two processors receive this:
					Google Analytics for product events and Sentry for error reports.
				</p>
				<p>
					Your music never leaves your project. Event and error reports carry no
					project, track, clip, or section names, no notes or audio, no
					assistant messages, and no text you type.
				</p>
				<label class="telemetry-disclosure-toggle">
					<input
						type="checkbox"
						checked={enabled()}
						onChange={toggle}
						aria-describedby="telemetry-disclosure-note"
					/>
					<span>Share usage and error reports</span>
				</label>
				<p id="telemetry-disclosure-note" class="telemetry-disclosure-note">
					Turning this off stops collection. Every feature keeps working.
				</p>
			</div>
		</details>
	);
};

export default TelemetryDisclosure;
