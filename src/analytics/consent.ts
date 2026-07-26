// Telemetry consent (PRD `OPS-02` / section 10 Security and privacy).
//
// "The user is told what is collected and can decline product analytics
// without losing any DAW or assistant capability." This module owns the
// *mechanism*: a persisted, observable preference that the analytics boundary
// and the error-reporting boundary both consult before they send anything.
//
// It deliberately owns neither the default nor the wording. `DEC-009` decides
// whether collection is on by default with an opt-out or requires opt-in, what
// the disclosure says, how long data is retained, and any regional constraint.
// Both are isolated to `CONSENT_DEFAULT` and `src/components/TelemetryDisclosure.tsx`
// so settling `DEC-009` is a one-line change here plus copy, not a redesign.
//
// Two processors, two flags: Google Analytics for product events and Sentry
// for error monitoring (ADR 0001). They are separate because `DEC-009` may
// decide differently about a reliability signal that keeps a release gate
// honest than about product analytics. The alpha's disclosure surface presents
// them as one choice; the model does not force that.

export interface ConsentState {
	/** PRD `OPS-02` product-analytics events. */
	readonly productAnalytics: boolean;
	/** PRD `OPS-03` error and crash reports (Sentry, per ADR 0001). */
	readonly errorMonitoring: boolean;
}

export const CONSENT_STORAGE_KEY = "sg_telemetry_consent";

/**
 * The state before the user has expressed a preference.
 *
 * **Provisional, pending `DEC-009`.** Set to collect-with-opt-out, matching
 * the PRD `OPS-02` phrasing that the user "can decline" — which describes an
 * opt-out, not an opt-in. If `DEC-009` decides opt-in, flip both to `false`;
 * every consumer already treats "no stored preference" as this value and
 * nothing else needs to change.
 */
export const CONSENT_DEFAULT: ConsentState = {
	productAnalytics: true,
	errorMonitoring: true,
};

export const CONSENT_ALL_OFF: ConsentState = {
	productAnalytics: false,
	errorMonitoring: false,
};

type Listener = (state: ConsentState) => void;

function parse(raw: string | null): ConsentState {
	if (raw === null) return CONSENT_DEFAULT;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return CONSENT_DEFAULT;
		const record = parsed as Record<string, unknown>;
		return {
			productAnalytics:
				typeof record.productAnalytics === "boolean"
					? record.productAnalytics
					: CONSENT_DEFAULT.productAnalytics,
			errorMonitoring:
				typeof record.errorMonitoring === "boolean"
					? record.errorMonitoring
					: CONSENT_DEFAULT.errorMonitoring,
		};
	} catch {
		// Corrupt or hand-edited storage falls back to the default rather than
		// throwing on app start.
		return CONSENT_DEFAULT;
	}
}

/**
 * A consent store over one `Storage`.
 *
 * Injectable rather than reaching for `localStorage` directly so tests — and
 * any future per-account server-side preference — can supply their own.
 */
export class ConsentStore {
	private readonly listeners = new Set<Listener>();
	private state: ConsentState;

	constructor(private readonly storage: Storage | null) {
		this.state = this.read();
	}

	get current(): ConsentState {
		return this.state;
	}

	/** Whether product-analytics events may be sent. */
	get analyticsAllowed(): boolean {
		return this.state.productAnalytics;
	}

	/** Whether error reports may be sent to the monitoring processor. */
	get errorMonitoringAllowed(): boolean {
		return this.state.errorMonitoring;
	}

	set(patch: Partial<ConsentState>): ConsentState {
		const next: ConsentState = { ...this.state, ...patch };
		if (
			next.productAnalytics === this.state.productAnalytics &&
			next.errorMonitoring === this.state.errorMonitoring
		) {
			return this.state;
		}
		this.state = next;
		this.persist(next);
		for (const listener of [...this.listeners]) {
			try {
				listener(next);
			} catch {
				// A consumer that throws while reacting to a preference change must
				// not prevent the other consumers from being told to stop collecting.
			}
		}
		return next;
	}

	/** Turns both processors off in one action — the user-facing opt-out. */
	optOut(): ConsentState {
		return this.set(CONSENT_ALL_OFF);
	}

	optIn(): ConsentState {
		return this.set({ productAnalytics: true, errorMonitoring: true });
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private read(): ConsentState {
		if (!this.storage) return CONSENT_DEFAULT;
		try {
			return parse(this.storage.getItem(CONSENT_STORAGE_KEY));
		} catch {
			// Private browsing / disabled storage. Consent is a preference, never a
			// reason for the app to fail to start.
			return CONSENT_DEFAULT;
		}
	}

	private persist(state: ConsentState): void {
		if (!this.storage) return;
		try {
			this.storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
		} catch {
			// The preference still applies for this session; it just will not
			// survive a reload. Better than surfacing a storage error to the user.
		}
	}
}

function defaultStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** The app-wide consent store. Tests construct their own `ConsentStore`. */
export const consentStore = new ConsentStore(defaultStorage());
