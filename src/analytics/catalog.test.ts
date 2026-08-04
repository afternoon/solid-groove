import { describe, expect, it } from "vitest";
import { COMMAND_TYPES } from "../commands/registry";
import type { SaveFailureReason } from "../persistence/projectRepository";
import { SHORTCUT_ACTION_IDS as REGISTERED_SHORTCUT_IDS } from "../shortcuts/registry";
import { BUCKET_SCALES, bucketLabels, bucketOf } from "./buckets";
import {
	ANALYTICS_EVENT_NAMES,
	ANALYTICS_EVENTS,
	type AnalyticsEventDefinition,
	type AnalyticsParam,
	COMMAND_IDS,
	declaredValues,
	FEATURE_KEYS,
	PARAM_KINDS,
	SHORTCUT_ACTION_IDS,
	sampleRateKey,
	validateEventPayload,
} from "./catalog";
import { ERROR_CODES } from "./errorCodes";

const definitions = Object.entries(ANALYTICS_EVENTS) as [
	string,
	AnalyticsEventDefinition,
][];

function everyParam(): {
	event: string;
	param: string;
	spec: AnalyticsParam;
}[] {
	return definitions.flatMap(([event, definition]) =>
		Object.entries(definition.params).map(([param, spec]) => ({
			event,
			param,
			spec,
		})),
	);
}

describe("event names", () => {
	// PRD OPS-02 event rules.
	it("are snake_case and at most 40 characters", () => {
		for (const name of ANALYTICS_EVENT_NAMES) {
			expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(name.length).toBeLessThanOrEqual(40);
		}
	});

	it("avoid Google Analytics reserved prefixes", () => {
		for (const name of ANALYTICS_EVENT_NAMES) {
			expect(name.startsWith("firebase_")).toBe(false);
			expect(name.startsWith("google_")).toBe(false);
			expect(name.startsWith("ga_")).toBe(false);
		}
	});

	it("covers every event in the PRD OPS-02 catalog table", () => {
		// Pinned so an event cannot quietly disappear from the contract. Adding a
		// row to the PRD table means adding it here in the same change.
		expect([...ANALYTICS_EVENT_NAMES].sort()).toEqual(
			[
				"account_upgraded",
				"anon_session_created",
				"app_opened",
				"arrangement_milestone",
				"arrangement_outline_created",
				"asset_load_failed",
				"assistant_message_sent",
				"assistant_proposal_applied",
				"assistant_proposal_cancelled",
				"assistant_proposal_shown",
				"assistant_proposal_undone",
				"assistant_result_edited",
				"assistant_suggestion_clicked",
				"audio_start_failed",
				"audio_underrun",
				"automation_lane_created",
				"clip_edited",
				"device_added",
				"exception",
				"export_completed",
				"export_failed",
				"export_started",
				"feature_first_use",
				"first_edit",
				"instrument_changed",
				"landing_cta_click",
				"library_audition",
				"library_pack_added",
				"project_created",
				"project_deleted",
				"project_opened",
				"save_failed",
				"save_recovered",
				"section_created",
				"shortcut_used",
				"track_added",
				"transport_play",
				"undo_used",
			].sort(),
		);
	});
});

describe("parameter declarations", () => {
	it("uses only kinds that cannot carry free text", () => {
		// The structural guarantee behind "No project content, ever": there is no
		// string/text parameter kind, so no parameter can be declared that would
		// accept a project name, an assistant reply, a search term, or a token.
		// This test is what keeps that true for parameters added by later tasks.
		for (const { event, param, spec } of everyParam()) {
			expect(
				PARAM_KINDS,
				`${event}.${param} uses an unrecognized parameter kind`,
			).toContain(spec.kind);
		}
	});

	it("names parameters in snake_case", () => {
		for (const { event, param } of everyParam()) {
			expect(param, `${event}.${param}`).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	it("declares a known bucket scale for every bucket parameter", () => {
		for (const { event, param, spec } of everyParam()) {
			if (spec.kind !== "bucket") continue;
			expect(BUCKET_SCALES, `${event}.${param}`).toHaveProperty(spec.scale);
		}
	});

	it("bounds every count parameter", () => {
		for (const { event, param, spec } of everyParam()) {
			if (spec.kind !== "count") continue;
			expect(spec.max, `${event}.${param}`).toBeGreaterThan(0);
			// Bucketed cardinality: an unbounded count is a re-identification risk
			// and a GA4 cardinality problem.
			expect(spec.max, `${event}.${param}`).toBeLessThanOrEqual(1000);
		}
	});
});

describe("no project content (PRD OPS-02 / section 10)", () => {
	// This is the catalog half of the acceptance criterion. The Sentry-payload
	// half lives in src/monitoring/scrub.test.ts, which exercises the scrubbing
	// functions directly.
	const FORBIDDEN_VALUE_SHAPES: readonly { name: string; pattern: RegExp }[] = [
		{ name: "a URL", pattern: /[a-z]+:\/\//i },
		{ name: "a bare host", pattern: /\b[\w-]+\.(com|net|org|io|app|dev)\b/i },
		{ name: "an email address", pattern: /@/ },
		{ name: "whitespace (free text rather than a key)", pattern: /\s/ },
		{ name: "a file extension", pattern: /\.(wav|mp3|aiff|flac|ogg|json)$/i },
		{ name: "a long opaque token", pattern: /^[A-Za-z0-9_-]{32,}$/ },
	];

	it("declares no value that looks like user content, a URL, or a token", () => {
		for (const { event, param, spec } of everyParam()) {
			for (const value of declaredValues(spec)) {
				for (const { name, pattern } of FORBIDDEN_VALUE_SHAPES) {
					expect(
						pattern.test(value),
						`${event}.${param} declares "${value}", which looks like ${name}`,
					).toBe(false);
				}
			}
		}
	});

	it("declares no parameter whose name suggests it carries content", () => {
		// A name-level check as well as a kind-level one: it catches a parameter
		// that is *shaped* correctly but conceptually wrong, e.g. an enum of
		// project names.
		const FORBIDDEN_NAME =
			/(^|_)(name|title|label|text|message|query|search|prompt|reply|url|uri|path|file|filename|email|token|secret)($|_)/;
		for (const { event, param } of everyParam()) {
			expect(
				FORBIDDEN_NAME.test(param),
				`${event}.${param} is named as though it carries free text`,
			).toBe(false);
		}
	});

	it("rejects a value outside a parameter's declared set at runtime", () => {
		// Defense behind the types, for untyped edges.
		const { params, issues } = validateEventPayload("clip_edited", {
			editor: "My Demo Track",
			event_count_bucket: "1_4",
		});
		// Two issues: the value is rejected, and the required parameter is then
		// missing — so the event is dropped rather than sent half-populated.
		expect(issues.join(" ")).toContain("outside its declared set");
		expect(issues.join(" ")).toContain("missing required parameter");
		expect(params).not.toHaveProperty("editor");
	});

	it("never repeats a rejected value in the issue text", () => {
		// An issue string can be logged. It must not become the leak it reports.
		const { issues } = validateEventPayload("clip_edited", {
			editor: "Secret Project Name",
			event_count_bucket: "1_4",
		});
		expect(issues.join(" ")).not.toContain("Secret Project Name");
	});

	it("drops a parameter the event does not declare", () => {
		const { params, issues } = validateEventPayload("app_opened", {
			project_name: "Midnight Drive",
		});
		expect(params).toEqual({});
		expect(issues.join(" ")).toContain("has no parameter");
		expect(issues.join(" ")).not.toContain("Midnight Drive");
	});
});

describe("catalog cross-references", () => {
	it("pins exactly the registered command types as first_edit's command_id", () => {
		// Keeps "analytics ships with the feature" enforced: adding a command
		// without deciding how it appears in analytics fails here.
		expect([...COMMAND_IDS].sort()).toEqual([...COMMAND_TYPES].sort());
	});

	it("pins exactly the registered shortcut actions as shortcut_used's action_id", () => {
		// Same rule for the KEY-01 registry: a mapping added without an
		// analytics decision fails here rather than shipping unmeasured.
		expect([...SHORTCUT_ACTION_IDS].sort()).toEqual(
			[...REGISTERED_SHORTCUT_IDS].sort(),
		);
	});

	it("covers every persistence failure reason with an error code", () => {
		const reasons: SaveFailureReason[] = [
			"revision_conflict",
			"not_found",
			"already_exists",
			"unsupported_schema_version",
			"invalid_document",
			"document_too_large",
			"unavailable",
		];
		for (const reason of reasons) {
			expect(ERROR_CODES).toContain(reason);
		}
	});

	it("declares the PRD OPS-02 feature_first_use keys", () => {
		expect([...FEATURE_KEYS].sort()).toEqual(
			[
				"assistant",
				"audio_loop",
				"automation",
				"device_chain",
				"drum_machine",
				"export_stems",
				"export_stereo",
				"library_browser",
				"mixer",
				"piano_roll",
				"sampler",
				"sections",
				"send_return",
				"shortcut_guide",
				"step_editor",
				"synth",
			].sort(),
		);
	});
});

describe("section 11 measure coverage", () => {
	// PRD section 11: "A measure that no catalogued event can produce is a gap
	// in the catalog." Each measure names the events it is derived from.
	const MEASURES: Record<string, readonly string[]> = {
		"track progression rate": [
			"project_created",
			"arrangement_milestone",
			"transport_play",
			"export_completed",
		],
		"time to first audible edit": ["project_created", "first_edit"],
		"features reached for first": [
			"feature_first_use",
			"app_opened",
			"project_created",
		],
		"session frequency": ["app_opened", "project_opened"],
		"loop to three sections": [
			"section_created",
			"arrangement_outline_created",
			"arrangement_milestone",
		],
		"export rate": ["export_started", "export_completed"],
		"assistant proposal rates": [
			"assistant_proposal_shown",
			"assistant_proposal_applied",
			"assistant_proposal_cancelled",
			"assistant_proposal_undone",
		],
		"assistant result ownership": [
			"assistant_proposal_applied",
			"assistant_result_edited",
		],
		"project reopen rate": ["project_opened"],
		reliability: [
			"save_failed",
			"save_recovered",
			"asset_load_failed",
			"audio_start_failed",
			"audio_underrun",
			"export_failed",
		],
		// Crash-free session rate comes from Sentry Release Health (ADR 0001),
		// with `exception` available to cross-check it.
		"crash-free sessions": ["exception"],
	};

	it("derives every measure from catalogued events", () => {
		for (const [measure, events] of Object.entries(MEASURES)) {
			for (const event of events) {
				expect(
					ANALYTICS_EVENT_NAMES,
					`the "${measure}" measure needs an event "${event}" the catalog does not declare`,
				).toContain(event);
			}
		}
	});
});

describe("buckets", () => {
	it("places values in the expected bucket", () => {
		expect(bucketOf("track_count", 0)).toBe("0");
		expect(bucketOf("track_count", 1)).toBe("1_2");
		expect(bucketOf("track_count", 50)).toBe("21_50");
		expect(bucketOf("track_count", 51)).toBe("50_plus");
	});

	it("puts the section 11 two-minute threshold on a bucket edge", () => {
		// The primary measure is "at least ... two minutes of content", so 120s
		// must not fall inside a bucket that also contains shorter projects.
		expect(bucketOf("musical_duration", 119)).toBe("1_2m");
		expect(bucketOf("musical_duration", 120)).toBe("2_5m");
	});

	it("is total for negative and non-finite input", () => {
		// Bucketing runs inside telemetry paths that must never throw.
		expect(bucketOf("elapsed_seconds", -10)).toBe("0_5s");
		expect(bucketOf("elapsed_seconds", Number.NaN)).toBe("0_5s");
		expect(bucketOf("elapsed_ms", Number.POSITIVE_INFINITY)).toBe("60s_plus");
	});

	it("produces only labels the scale declares", () => {
		for (const scale of Object.keys(
			BUCKET_SCALES,
		) as (keyof typeof BUCKET_SCALES)[]) {
			const labels = bucketLabels(scale) as readonly string[];
			for (const value of [-1, 0, 1, 7, 100, 10_000, 1e9]) {
				expect(labels).toContain(bucketOf(scale, value) as string);
			}
		}
	});

	it("has unique labels within a scale", () => {
		for (const scale of Object.keys(
			BUCKET_SCALES,
		) as (keyof typeof BUCKET_SCALES)[]) {
			const labels = bucketLabels(scale) as readonly string[];
			expect(new Set(labels).size).toBe(labels.length);
		}
	});
});

describe("sampleRateKey", () => {
	it("maps known rates to their key", () => {
		expect(sampleRateKey(48000)).toBe("48000");
		expect(sampleRateKey(44100)).toBe("44100");
	});

	it("collapses an unusual rate rather than logging it exactly", () => {
		// An exact unusual rate helps identify a machine.
		expect(sampleRateKey(37231)).toBe("other");
	});
});

describe("validateEventPayload", () => {
	it("accepts a well-formed payload", () => {
		const { params, issues } = validateEventPayload("exception", {
			fatal: true,
			area: "audio",
			error_code: "autoplay_blocked",
		});
		expect(issues).toEqual([]);
		expect(params).toEqual({
			fatal: true,
			area: "audio",
			error_code: "autoplay_blocked",
		});
	});

	it("reports a missing required parameter", () => {
		const { issues } = validateEventPayload("exception", { fatal: true });
		expect(issues.join(" ")).toContain("missing required parameter");
	});

	it("clamps a count to its declared maximum", () => {
		const { params } = validateEventPayload("save_failed", {
			error_code: "unavailable",
			retry_count: 9999,
		});
		expect(params.retry_count).toBe(20);
	});

	it("returns an issue rather than throwing for an unregistered event", () => {
		// Only reachable from an untyped edge, but it must fail open: the caller
		// is editing or playback code, which must never see an analytics throw.
		const { params, issues } = validateEventPayload(
			"not_a_real_event" as never,
			{ anything: 1 },
		);
		expect(params).toEqual({});
		expect(issues.join(" ")).toContain("is not a registered event");
	});

	it("treats an omitted optional parameter as valid", () => {
		const { issues } = validateEventPayload("project_created", {
			source: "blank",
		});
		expect(issues).toEqual([]);
	});
});
