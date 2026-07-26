// The analytics transport seam (PRD `OPS-02`, ADR 0001 decision 1).
//
// The logging boundary in `analytics.ts` validates, enriches, and hands a
// finished event to a transport. Which vendor actually receives it is behind
// this interface, so swapping Google Analytics — or running with no vendor at
// all, which is what every test and every opted-out session does — changes one
// wiring line rather than every call site.
//
// A transport MUST NOT throw. Analytics fails open (PRD `OPS-02`: "A blocked,
// failed, or unavailable analytics endpoint ... never breaks playback,
// editing, saving, or export"). The boundary guards against a throwing
// transport anyway, but a transport that swallows its own failures keeps that
// guard a backstop rather than the primary mechanism.

import type { AnalyticsParamValue } from "./catalog";

export interface AnalyticsTransport {
	logEvent(
		name: string,
		params: Readonly<Record<string, AnalyticsParamValue>>,
	): void;
	setUserProperties(properties: Readonly<Record<string, string>>): void;
}

/** Discards everything. The default until a real transport is wired in. */
export const noopTransport: AnalyticsTransport = {
	logEvent() {},
	setUserProperties() {},
};

export interface RecordedEvent {
	readonly name: string;
	readonly params: Record<string, AnalyticsParamValue>;
}

export interface RecordingTransport extends AnalyticsTransport {
	readonly events: readonly RecordedEvent[];
	readonly userProperties: Readonly<Record<string, string>>;
	/** Events recorded for one name, in order. */
	named(name: string): readonly RecordedEvent[];
	reset(): void;
}

/** An in-memory transport for tests and for the local debug surface. */
export function createRecordingTransport(): RecordingTransport {
	const events: RecordedEvent[] = [];
	let userProperties: Record<string, string> = {};

	return {
		get events() {
			return events;
		},
		get userProperties() {
			return userProperties;
		},
		named(name) {
			return events.filter((event) => event.name === name);
		},
		logEvent(name, params) {
			events.push({ name, params: { ...params } });
		},
		setUserProperties(properties) {
			userProperties = { ...userProperties, ...properties };
		},
		reset() {
			events.length = 0;
			userProperties = {};
		},
	};
}

/**
 * A transport that always throws, for the PRD `OPS-02` acceptance test that
 * "disabling or blocking analytics leaves every product behavior unchanged".
 */
export function createFailingTransport(
	message = "analytics blocked",
): AnalyticsTransport {
	return {
		logEvent() {
			throw new Error(message);
		},
		setUserProperties() {
			throw new Error(message);
		},
	};
}
