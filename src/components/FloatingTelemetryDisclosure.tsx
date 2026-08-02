import { Show } from "solid-js";
import TelemetryDisclosure, {
	inlineDisclosureMounted,
} from "./TelemetryDisclosure";

/**
 * The app-chrome copy of the PRD `OPS-02` disclosure and opt-out.
 *
 * The opt-out has to be reachable from every page, and a page must never carry
 * two of them — two controls for one preference, and duplicate element ids.
 * This resolves both by rendering only when nothing else on the page already
 * has: the landing page hosts its own inline copy in its footer (`LOOP-001b`,
 * per `DEC-009`), so the floating one stands down there and comes back the
 * moment that copy is gone.
 *
 * Keying on presence rather than on the route is deliberate. `/` only has an
 * inline disclosure while `LandingPage` is actually mounted and rendering — not
 * while its chunk is still loading, and not when the error boundary has
 * replaced it with `AppErrorFallback`, which carries no disclosure of its own.
 * A route-based rule reads the same on a healthy page and leaves the visitor
 * with no opt-out anywhere in exactly the two cases the floating copy is for.
 *
 * The visible consequence is a hand-over on `/`: this copy covers the window
 * before the page's footer exists and stands down once it does. That is the
 * behaviour the invariant asks for — during that window there is genuinely no
 * other opt-out on the page — so an assertion about the landing page's
 * disclosure has to settle on the rendered page first, not on the load.
 */
export default function FloatingTelemetryDisclosure() {
	return (
		<Show when={!inlineDisclosureMounted()}>
			<TelemetryDisclosure />
		</Show>
	);
}
