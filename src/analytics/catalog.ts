// The typed product-analytics catalog (PRD `OPS-02`).
//
// This module is the *only* place an analytics event name or parameter name
// appears in the codebase. UI, audio, persistence, and assistant code log
// through `src/analytics/analytics.ts`, which accepts nothing this file has not
// declared. Logging an unregistered event, an unregistered parameter, or a
// value outside a parameter's declared set is a type error.
//
// ## Why there is no free-text parameter kind
//
// PRD `OPS-02`: "No project content, ever." Rather than reviewing each new call
// site for leaks, the catalog makes the leak unrepresentable: the four
// parameter kinds below are `enum`, `bucket`, `boolean`, and `count`. There is
// deliberately no `string`/`text` kind, so there is no way to declare a
// parameter that *could* carry a project name, an assistant reply, a search
// term, a URL, or a token — and `catalog.test.ts` asserts that stays true for
// parameters added by later tasks.
//
// ## Events that cannot be logged yet
//
// Several later-milestone parameters are keys owned by a task that has not landed
// (`template_id` by `LOOP-015`, `action_id` by `LOOP-014`, `suggestion_id` and
// `capability` by the `AI-*` tasks). Those are declared here as *empty* enums.
// An empty enum's value type is `never`, so the event is declared, reportable,
// and documented — but physically un-loggable until its owning task adds its
// keys in the same change that adds the call site. That is the "analytics ships
// with the feature" rule (PRD section 14) enforced by the compiler rather than
// by review.
//
// ## Changing this file
//
// Event names, parameter names, and parameter values are a published contract:
// they appear in Google Analytics reports and saved explorations, and renaming
// one splits a metric across two values for the same behavior. Adding is
// routine; renaming or removing is a task of its own.

import {
	type BucketLabel,
	type BucketScaleName,
	bucketLabels,
} from "./buckets";
import { ERROR_AREAS, ERROR_CODES } from "./errorCodes";
import {
	isPublishedPackSlug,
	PACK_KINDS,
	type PublishedPackId,
	RESERVED_PACK_IDS,
} from "./packIdentity";

// ---------------------------------------------------------------------------
// Parameter kinds
// ---------------------------------------------------------------------------

export interface EnumParam<
	V extends string = string,
	O extends boolean = boolean,
> {
	readonly kind: "enum";
	readonly values: readonly V[];
	readonly optional: O;
}

export interface BucketParam<
	S extends BucketScaleName = BucketScaleName,
	O extends boolean = boolean,
> {
	readonly kind: "bucket";
	readonly scale: S;
	readonly optional: O;
}

export interface BooleanParam<O extends boolean = boolean> {
	readonly kind: "boolean";
	readonly optional: O;
}

export interface CountParam<O extends boolean = boolean> {
	readonly kind: "count";
	/** Values above this are clamped, so cardinality stays bounded. */
	readonly max: number;
	readonly optional: O;
}

/**
 * A value set an enum cannot express because it is *published* rather than
 * compiled: a third-party pack's slug enters the library by publication, so no
 * table in this repository can enumerate it ahead of time (LIB-05, LIB-08).
 *
 * The guarantee is therefore a shape and a set of reserved sentinels instead of
 * a fixed list — a kebab-case slug within {@link MAX_PACK_ID_LENGTH}, or one of
 * `reserved`. Anything else is dropped exactly like an out-of-set enum value.
 * This is the *only* parameter kind that admits a value the catalog has not
 * seen, which is why the decision about whether a value may travel at all is
 * made before it gets here, by `packAnalyticsIdentity`.
 */
export interface SlugParam<O extends boolean = boolean> {
	readonly kind: "slug";
	/** Non-slug values that are always allowed (e.g. `"user"`, `"unknown"`). */
	readonly reserved: readonly string[];
	readonly optional: O;
}

export type AnalyticsParam =
	| EnumParam
	| BucketParam
	| BooleanParam
	| CountParam
	| SlugParam;

/** Every parameter kind, for exhaustiveness checks in tests and validation. */
export const PARAM_KINDS = [
	"enum",
	"bucket",
	"boolean",
	"count",
	"slug",
] as const;

function enumParam<const V extends string>(
	values: readonly V[],
): EnumParam<V, false> {
	return { kind: "enum", values, optional: false };
}

function optionalEnumParam<const V extends string>(
	values: readonly V[],
): EnumParam<V, true> {
	return { kind: "enum", values, optional: true };
}

function bucketParam<S extends BucketScaleName>(
	scale: S,
): BucketParam<S, false> {
	return { kind: "bucket", scale, optional: false };
}

function boolParam(): BooleanParam<false> {
	return { kind: "boolean", optional: false };
}

function countParam(max: number): CountParam<false> {
	return { kind: "count", max, optional: false };
}

function slugParam<const R extends string>(
	reserved: readonly R[],
): SlugParam<false> {
	return { kind: "slug", reserved, optional: false };
}

// ---------------------------------------------------------------------------
// Shared value sets
// ---------------------------------------------------------------------------

/**
 * The surfaces the app can log from. Attached to every event automatically
 * (see `AUTOMATIC_PARAMS`), so no event declares it.
 */
export const SURFACES = ["landing", "dashboard", "editor"] as const;
export type Surface = (typeof SURFACES)[number];

/** Non-identifying account facts, logged as a GA4 user property. */
export const ACCOUNT_TYPES = ["anonymous", "registered", "unknown"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * `feature_first_use` keys (PRD `OPS-02`). One low-cardinality key rather than
 * an event name per feature, so first-use is comparable across features in one
 * report and the catalog stays well inside GA4's distinct-event-name limit.
 * A feature task adds its key here with the feature.
 */
export const FEATURE_KEYS = [
	"step_editor",
	"piano_roll",
	"drum_machine",
	"synth",
	"sampler",
	"audio_loop",
	"device_chain",
	"send_return",
	"mixer",
	"library_browser",
	"pack_browser",
	"shortcut_guide",
	"arrangement",
	"sections",
	"automation",
	"assistant",
	"export_stereo",
	"export_stems",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * Registered command types, as `first_edit`'s `command_id`.
 *
 * Pinned here rather than derived from `src/commands/registry.ts` because that
 * registry erases its command types to `string`, which would make `command_id`
 * accept free text. `catalog.test.ts` asserts this list equals the registry's
 * exactly, so adding a command without deciding how it appears in analytics
 * fails the suite.
 */
/**
 * Arrangement outline templates, as `arrangement_outline_created`'s
 * `template_id` (PRD ARR-03).
 *
 * Pinned here for the same reason as `COMMAND_IDS`: an analytics parameter's
 * value set is a published contract, so adding a template means deciding how it
 * appears in a report in the same change. `outlineTemplates.test.ts` asserts
 * this list equals `OUTLINE_TEMPLATES`' IDs exactly. A template's *label* may be
 * reworded freely; its ID may not, because renaming one splits a metric.
 */
export const OUTLINE_TEMPLATE_IDS = [
	"basic_song",
	"electronic_build",
	"aaba",
] as const;
export type OutlineTemplateId = (typeof OUTLINE_TEMPLATE_IDS)[number];

export const COMMAND_IDS = [
	"note.add",
	"note.remove",
	"note.update",
	"notes.clear",
	"notes.duplicate",
	"notes.quantize",
	"notes.scaleVelocity",
	"notes.transpose",
	"notes.vary",
	"clip.create",
	"clip.delete",
	"clip.update",
	"track.create",
	"track.delete",
	"track.reorder",
	"track.setFlag",
	"track.update",
	"placement.create",
	"placement.delete",
	"placement.update",
	"section.create",
	"section.delete",
	"section.update",
	"section.reorder",
	"parameter.set",
	"drum.setPadAsset",
	"drum.setPadFlag",
	"drum.setPadChoke",
	"drum.setPadParameter",
	"drum.addPad",
	"drum.removePad",
	"drum.reorderPad",
	"instrument.change",
	"instrument.setSample",
	"pack.add",
	"pack.remove",
	"device.add",
	"device.remove",
	"device.reorder",
	"device.duplicate",
	"device.setBypass",
	"device.reset",
	"device.restoreParameters",
] as const;
export type CommandId = (typeof COMMAND_IDS)[number];

/**
 * Registered shortcut actions, as `shortcut_used`'s `action_id` (PRD `KEY-01`).
 *
 * Pinned here for the same reason as `COMMAND_IDS`: an analytics parameter's
 * value set is a published contract, and pinning it means a mapping added to
 * `src/shortcuts/registry.ts` has to be given an analytics decision in the same
 * change. `catalog.test.ts` asserts this list equals the registry's exactly.
 */
export const SHORTCUT_ACTION_IDS = [
	"transport.play_stop",
	"transport.continue",
	"transport.metronome",
	"edit.undo",
	"edit.redo",
	"edit.cut",
	"edit.copy",
	"edit.paste",
	"edit.select_all",
	"edit.delete",
	"edit.duplicate",
	"arrangement.split_clip",
	"arrangement.toggle_loop",
	"arrangement.toggle_automation_view",
	"clip.quantize",
	"clip.toggle_draw_mode",
	"view.zoom_to_selection",
	"view.zoom_back",
	"view.zoom_in",
	"view.zoom_out",
	"view.close_surface",
	"help.shortcut_guide",
] as const;
export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

/**
 * Audio sample rates, as an enumerated key rather than a raw number, so
 * `audio_underrun` cannot carry an unusual exact rate that helps identify a
 * machine. `sampleRateKey()` maps a measured rate onto this set.
 */
export const SAMPLE_RATE_KEYS = [
	"44100",
	"48000",
	"88200",
	"96000",
	"176400",
	"192000",
	"other",
] as const;
export type SampleRateKey = (typeof SAMPLE_RATE_KEYS)[number];

export function sampleRateKey(rate: number): SampleRateKey {
	const candidate = String(Math.round(rate));
	return (SAMPLE_RATE_KEYS as readonly string[]).includes(candidate)
		? (candidate as SampleRateKey)
		: "other";
}

/**
 * Our own published packs, as `pack_id` values (PRD LIB-05, LOOP-013, LIB-08).
 *
 * `pack_id` is a pack's stable **slug** — never its display name, never its
 * `pak_` ID. This list is *not* the parameter's whole value set: a third-party
 * pack is published into the library out of band, so no table compiled into the
 * app can enumerate every legitimate slug, and `pack_id` is a
 * {@link SlugParam} that admits any published slug by shape (see
 * `packAnalyticsIdentity`, which decides whether a given pack's slug may travel
 * at all).
 *
 * What the list still buys is a decision point for *our* catalogue: a factory
 * pack shipped without an analytics decision fails `catalog.test.ts` rather than
 * quietly appearing in reports, and the frozen slugs document what a saved GA4
 * exploration of the first-party library can rely on.
 */
export const LIBRARY_PACK_SLUGS = [
	"core-electronic-drums",
	"foundation-bass",
	"tonal-elements",
	"ambient-textures",
	"transitions-fx",
	"cc0-community",
] as const;
export type LibraryPackSlug = (typeof LIBRARY_PACK_SLUGS)[number];

/** Keys owned by a task that has not landed yet — see the file banner. */
const UNCLAIMED: readonly never[] = [];

// ---------------------------------------------------------------------------
// Automatic parameters and user properties
// ---------------------------------------------------------------------------

/**
 * Attached by the logging boundary to every event (PRD `OPS-02`: "Every event
 * carries the release SHA and the surface it came from"). Callers never pass
 * these — they are not part of any event's payload type, and the boundary
 * strips them if a caller somehow supplies one.
 */
export const AUTOMATIC_PARAMS = {
	/** The deployed revision, from `src/release.ts` (PRD `OPS-01`). */
	release_sha: "release_sha",
	surface: "surface",
} as const;

/**
 * GA4 user properties (PRD `OPS-02`: "limited to coarse, non-identifying
 * facts: account type and whether the session is internal").
 */
export const USER_PROPERTIES = {
	account_type: "account_type",
	/** `"true"`/`"false"` — GA4 user property values are strings. */
	internal: "internal",
} as const;

// ---------------------------------------------------------------------------
// The event catalog
// ---------------------------------------------------------------------------

export interface AnalyticsEventDefinition {
	/**
	 * Delivery milestone, matching the PRD `OPS-02` catalog table's
	 * `Alpha Milestone` column. The field keeps its `phase` name because
	 * renaming it changes this published catalog contract, which is its own
	 * task rather than part of a documentation rename.
	 */
	readonly phase: 0 | 1 | 2 | 3;
	/** Backlog task(s) that must ship the event with the feature it measures. */
	readonly owners: readonly string[];
	readonly params: Readonly<Record<string, AnalyticsParam>>;
}

/**
 * Every event in the PRD `OPS-02` catalog table, in that table's order.
 *
 * `surface`, `release_sha`, `account_type`, and `internal` appear in the PRD's
 * "key parameters" column for some rows but are not declared per-event: the
 * boundary attaches the first two to everything and sets the last two as user
 * properties.
 */
export const ANALYTICS_EVENTS = {
	app_opened: {
		phase: 0,
		owners: ["FND-001c"],
		params: {},
	},

	landing_cta_click: {
		phase: 1,
		owners: ["LOOP-001b"],
		params: { cta_id: enumParam(["start_free", "log_in"]) },
	},

	anon_session_created: {
		phase: 1,
		owners: ["LOOP-001"],
		params: {},
	},

	account_upgraded: {
		phase: 1,
		owners: ["LOOP-001"],
		// The alpha's only upgrade path is linking an anonymous account to a
		// Google identity (see src/auth/authService.ts). A second provider adds
		// its key here with the sign-in method itself.
		params: { method: enumParam(["google"]) },
	},

	project_created: {
		phase: 1,
		owners: ["LOOP-001", "LOOP-015"],
		params: {
			source: enumParam(["blank", "template", "duplicate"]),
			// Template keys belong to LOOP-015; genres are the PRD LIB-02 set,
			// pinned here so a library re-tagging cannot rewrite analytics history.
			template_id: optionalEnumParam(UNCLAIMED),
			genre: optionalEnumParam([
				"house",
				"techno",
				"hip_hop",
				"trap",
				"drum_and_bass",
				"jungle",
				"dubstep",
				"ambient",
				"lofi",
				"trance",
				"uk_garage",
				"breakbeat",
				"electronic_pop",
			]),
		},
	},

	project_opened: {
		phase: 1,
		owners: ["LOOP-001"],
		params: {
			project_age_bucket: bucketParam("project_age"),
			track_count_bucket: bucketParam("track_count"),
			is_first_open: boolParam(),
		},
	},

	project_deleted: {
		phase: 1,
		owners: ["LOOP-001"],
		params: { project_age_bucket: bucketParam("project_age") },
	},

	first_edit: {
		phase: 0,
		owners: ["FND-009"],
		params: {
			command_id: enumParam(COMMAND_IDS),
			seconds_since_open_bucket: bucketParam("elapsed_seconds"),
		},
	},

	feature_first_use: {
		phase: 0,
		owners: ["FND-001c", "each owning feature task"],
		params: { feature: enumParam(FEATURE_KEYS) },
	},

	transport_play: {
		phase: 1,
		owners: ["LOOP-003"],
		params: { is_first_play_in_session: boolParam() },
	},

	track_added: {
		phase: 1,
		owners: ["LOOP-007"],
		params: { track_type: enumParam(["instrument", "audio", "return"]) },
	},

	instrument_changed: {
		phase: 1,
		owners: ["LOOP-004", "LOOP-005"],
		params: {
			instrument_type: enumParam(["synth", "sampler", "drum_machine"]),
		},
	},

	device_added: {
		phase: 1,
		owners: ["LOOP-008", "LOOP-009"],
		params: {
			// The alpha's six core device types (LOOP-008); LOOP-009 extends this
			// list as it authors more. Kept in sync with `src/domain/devices.ts`.
			device_type: enumParam([
				"filter",
				"overdrive",
				"saturator",
				"compressor",
				"delay",
				"reverb",
			]),
			chain: enumParam(["insert", "return", "master"]),
		},
	},

	library_audition: {
		phase: 1,
		owners: ["LOOP-013"],
		params: {
			asset_type: enumParam(["one_shot", "loop", "instrument_preset"]),
			had_genre_filter: boolParam(),
			// The pack's stable slug (never its display name), so an audition can
			// be attributed to a pack without leaking library copy — see
			// `packIdentity.ts` for which packs may be named at all.
			pack_id: slugParam(RESERVED_PACK_IDS),
			pack_kind: enumParam(PACK_KINDS),
		},
	},

	library_pack_added: {
		phase: 1,
		owners: ["LOOP-013", "LIB-08"],
		// This is the pack-popularity measure, so it has to say *which* pack —
		// including a third party's, whose creator the adoption number is fed back
		// to (LIB-05, LIB-06). `pack_id` therefore carries any *published* pack's
		// slug, first-party or third-party, and `"user"` for an unpublished pack a
		// producer authored themselves. `packAnalyticsIdentity` is what draws that
		// line; the same two parameters as `library_audition`, so a pack's
		// auditions and its adds join on one vocabulary.
		params: {
			pack_id: slugParam(RESERVED_PACK_IDS),
			pack_kind: enumParam(PACK_KINDS),
		},
	},

	clip_edited: {
		phase: 1,
		owners: ["LOOP-010", "LOOP-011"],
		params: {
			editor: enumParam(["step", "piano_roll"]),
			event_count_bucket: bucketParam("event_count"),
		},
	},

	shortcut_used: {
		phase: 1,
		owners: ["LOOP-014"],
		// Action IDs come from the KEY-01 shortcut registry (LOOP-014), and the
		// registry — not the handler — is what logs them.
		params: { action_id: enumParam(SHORTCUT_ACTION_IDS) },
	},

	undo_used: {
		phase: 1,
		owners: ["LOOP-002"],
		params: {
			direction: enumParam(["undo", "redo"]),
			actor: enumParam(["user", "assistant"]),
		},
	},

	placement_duplicated: {
		phase: 2,
		owners: ["ARR-002"],
		// CLP-01 requires duplicating a placement to be able to either reuse the
		// source clip or fork an independent variation, with the UI saying which
		// will happen. `mode` is how we learn whether producers actually reach for
		// reuse — the whole point of clips being reusable — or always fork.
		params: { mode: enumParam(["linked", "independent"]) },
	},

	section_created: {
		phase: 2,
		owners: ["ARR-003"],
		params: { origin: enumParam(["manual", "template", "assistant"]) },
	},

	arrangement_outline_created: {
		phase: 2,
		owners: ["ARR-003"],
		params: {
			template_id: enumParam(OUTLINE_TEMPLATE_IDS),
			section_count: countParam(64),
		},
	},

	automation_lane_created: {
		phase: 2,
		owners: ["ARR-004"],
		params: {
			target_kind: enumParam(["track", "device", "return", "master"]),
		},
	},

	arrangement_milestone: {
		phase: 2,
		owners: ["ARR-003"],
		params: {
			section_count: countParam(64),
			duration_bucket: bucketParam("musical_duration"),
		},
	},

	export_started: {
		phase: 2,
		owners: ["EXP-002", "EXP-003"],
		params: {
			export_type: enumParam(["stereo", "stems"]),
			duration_bucket: bucketParam("musical_duration"),
			track_count_bucket: bucketParam("track_count"),
		},
	},

	export_completed: {
		phase: 2,
		owners: ["EXP-002", "EXP-003"],
		params: {
			export_type: enumParam(["stereo", "stems"]),
			elapsed_ms_bucket: bucketParam("elapsed_ms"),
		},
	},

	export_failed: {
		phase: 2,
		owners: ["EXP-002", "EXP-003"],
		params: {
			export_type: enumParam(["stereo", "stems"]),
			error_code: enumParam(ERROR_CODES),
			was_cancelled: boolParam(),
		},
	},

	assistant_message_sent: {
		phase: 3,
		owners: ["AI-004"],
		params: { scope: enumParam(["clip", "track", "section", "song"]) },
	},

	assistant_suggestion_clicked: {
		phase: 3,
		owners: ["AI-004"],
		params: { suggestion_id: enumParam(UNCLAIMED) },
	},

	assistant_proposal_shown: {
		phase: 3,
		owners: ["AI-003"],
		params: {
			// Capability keys come from the Appendix A command families (AI-001).
			capability: enumParam(UNCLAIMED),
			command_count_bucket: bucketParam("command_count"),
		},
	},

	assistant_proposal_applied: {
		phase: 3,
		owners: ["AI-003"],
		params: {
			capability: enumParam(UNCLAIMED),
			seconds_to_decision_bucket: bucketParam("elapsed_seconds"),
		},
	},

	assistant_proposal_cancelled: {
		phase: 3,
		owners: ["AI-003"],
		params: { capability: enumParam(UNCLAIMED) },
	},

	assistant_proposal_undone: {
		phase: 3,
		owners: ["AI-003"],
		params: {
			capability: enumParam(UNCLAIMED),
			seconds_to_undo_bucket: bucketParam("elapsed_seconds"),
		},
	},

	assistant_result_edited: {
		phase: 3,
		owners: ["AI-004"],
		params: { capability: enumParam(UNCLAIMED) },
	},

	save_failed: {
		phase: 0,
		owners: ["FND-001c", "LOOP-002"],
		params: {
			error_code: enumParam(ERROR_CODES),
			retry_count: countParam(20),
		},
	},

	save_recovered: {
		phase: 1,
		owners: ["LOOP-002"],
		params: { retry_count: countParam(20) },
	},

	audio_start_failed: {
		phase: 0,
		owners: ["FND-001c", "LOOP-003"],
		params: {
			error_code: enumParam(ERROR_CODES),
			was_browser_blocked: boolParam(),
		},
	},

	audio_underrun: {
		phase: 1,
		owners: ["LOOP-003"],
		params: {
			dropped_event_bucket: bucketParam("dropped_events"),
			sample_rate: enumParam(SAMPLE_RATE_KEYS),
		},
	},

	asset_load_failed: {
		phase: 1,
		owners: ["LOOP-006", "LOOP-013"],
		params: {
			asset_type: enumParam(["one_shot", "loop", "instrument_preset"]),
			error_code: enumParam(ERROR_CODES),
		},
	},

	exception: {
		phase: 0,
		owners: ["FND-001c"],
		params: {
			fatal: boolParam(),
			area: enumParam(ERROR_AREAS),
			error_code: enumParam(ERROR_CODES),
		},
	},
} as const satisfies Record<string, AnalyticsEventDefinition>;

export type AnalyticsCatalog = typeof ANALYTICS_EVENTS;
export type AnalyticsEventName = keyof AnalyticsCatalog;

export const ANALYTICS_EVENT_NAMES = Object.keys(
	ANALYTICS_EVENTS,
) as AnalyticsEventName[];

// ---------------------------------------------------------------------------
// Derived payload types
// ---------------------------------------------------------------------------

/** The value type one declared parameter accepts. */
export type ParamValue<P> = P extends EnumParam<infer V, boolean>
	? V
	: P extends BucketParam<infer S, boolean>
		? BucketLabel<S>
		: P extends BooleanParam
			? boolean
			: P extends CountParam
				? number
				: P extends SlugParam
					? PublishedPackId
					: never;

type ParamsOf<N extends AnalyticsEventName> = AnalyticsCatalog[N]["params"];

type RequiredKeys<P> = {
	[K in keyof P]: P[K] extends { optional: true } ? never : K;
}[keyof P];

type OptionalKeys<P> = {
	[K in keyof P]: P[K] extends { optional: true } ? K : never;
}[keyof P];

/**
 * The payload a caller must pass for one event.
 *
 * Required parameters are required, optional ones optional, and every value is
 * narrowed to its declared set — so `log("clip_edited", { editor: "steps" })`
 * (a typo) and `log("clip_edited", { editor: someUserInput })` are both type
 * errors, not runtime surprises.
 */
export type AnalyticsEventPayload<N extends AnalyticsEventName> = {
	[K in RequiredKeys<ParamsOf<N>>]: ParamValue<ParamsOf<N>[K]>;
} & {
	[K in OptionalKeys<ParamsOf<N>>]?: ParamValue<ParamsOf<N>[K]>;
};

/** Events whose payload is empty, so `log(name)` needs no second argument. */
type HasNoParams<N extends AnalyticsEventName> = keyof ParamsOf<N> extends never
	? true
	: false;

/** Argument tuple for `log`, making the payload optional for empty events. */
export type LogArgs<N extends AnalyticsEventName> = HasNoParams<N> extends true
	? [payload?: Record<string, never>]
	: [payload: AnalyticsEventPayload<N>];

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

/**
 * Values sent to the transport. GA4 accepts strings, numbers, and booleans.
 */
export type AnalyticsParamValue = string | number | boolean;

export interface ValidationResult {
	readonly params: Record<string, AnalyticsParamValue>;
	readonly issues: readonly string[];
}

/**
 * Second line of defense behind the types.
 *
 * The compiler already rejects unregistered events, unregistered parameters,
 * and out-of-set values at every call site. This exists because analytics is
 * also reachable from untyped edges — a JS consumer, a `@ts-expect-error`, a
 * value narrowed by a cast — and a bad value must be dropped rather than sent.
 * It never throws: PRD `OPS-02` requires analytics to fail open.
 */
export function validateEventPayload(
	event: AnalyticsEventName,
	payload: Readonly<Record<string, unknown>> = {},
): ValidationResult {
	const definition = ANALYTICS_EVENTS[event] as
		| AnalyticsEventDefinition
		| undefined;
	const params: Record<string, AnalyticsParamValue> = {};
	const issues: string[] = [];

	// The compiler rejects an unregistered event at every typed call site, so
	// reaching this needs an untyped edge. It must still return rather than
	// throw: analytics fails open, and the caller is editing or playback code.
	if (!definition) {
		return { params, issues: [`"${event}" is not a registered event`] };
	}

	for (const [name, value] of Object.entries(payload)) {
		const spec = definition.params[name];
		if (!spec) {
			issues.push(`"${event}" has no parameter "${name}"`);
			continue;
		}
		if (value === undefined) continue;
		const coerced = coerceParam(spec, value);
		if (coerced === undefined) {
			// Deliberately does not include `value` — an issue string can end up in
			// a log or an error report, and the whole point of this file is that a
			// rejected value may be exactly the project content that must not travel.
			issues.push(
				`"${event}.${name}" received a value outside its declared set`,
			);
			continue;
		}
		params[name] = coerced;
	}

	for (const [name, spec] of Object.entries(definition.params)) {
		if (!spec.optional && !(name in params)) {
			issues.push(`"${event}" is missing required parameter "${name}"`);
		}
	}

	return { params, issues };
}

function coerceParam(
	spec: AnalyticsParam,
	value: unknown,
): AnalyticsParamValue | undefined {
	switch (spec.kind) {
		case "enum":
			return typeof value === "string" && spec.values.includes(value)
				? value
				: undefined;
		case "bucket":
			return typeof value === "string" &&
				(bucketLabels(spec.scale) as readonly string[]).includes(value)
				? value
				: undefined;
		case "boolean":
			return typeof value === "boolean" ? value : undefined;
		case "count":
			if (typeof value !== "number" || !Number.isFinite(value))
				return undefined;
			return Math.min(Math.max(Math.round(value), 0), spec.max);
		case "slug":
			if (typeof value !== "string") return undefined;
			if (spec.reserved.includes(value)) return value;
			// Shape, not membership — the published set is not knowable here. A
			// value that is not a well-formed slug (a `pak_` ID, a display name, a
			// user-entered string) is dropped exactly like an out-of-set enum value.
			return isPublishedPackSlug(value) ? value : undefined;
	}
}

/**
 * Every allowed value of an `enum` or `bucket` parameter, for tests. A `slug`
 * parameter has no closed set — only its reserved sentinels are declared.
 */
export function declaredValues(spec: AnalyticsParam): readonly string[] {
	switch (spec.kind) {
		case "enum":
			return spec.values;
		case "bucket":
			return bucketLabels(spec.scale);
		case "slug":
			return spec.reserved;
		default:
			return [];
	}
}
