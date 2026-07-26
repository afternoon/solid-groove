import { describe, expect, it } from "vitest";
import {
	ALLOWED_TAGS,
	MAX_MESSAGE_LENGTH,
	pathOnly,
	redactText,
	type ScrubbableEvent,
	scrubBreadcrumb,
	scrubFramePath,
	scrubSelector,
	scrubSentryEvent,
} from "./scrub";

/**
 * The forbidden content, from PRD `OPS-02` / `OPS-03` / section 10: "no
 * project content, assistant text, user-entered strings, asset URLs, or
 * tokens".
 *
 * Every value here is planted into a hostile payload below and must not
 * survive scrubbing. Deliberately checked against the *serialized* output
 * rather than field by field, so a field a future SDK version starts
 * populating is caught too.
 */
const FORBIDDEN = {
	projectName: "Midnight Drive Demo",
	trackName: "Lead Vocal Take 3",
	clipName: "Chorus Riff",
	sectionName: "Final Chorus",
	assetName: "my-secret-sample.wav",
	assetUrl: "https://storage.googleapis.com/solid-groove/users/u1/kick.wav",
	assistantText: "Make the chorus feel more euphoric with a wide pad",
	searchTerm: "dusty vinyl piano",
	email: "producer@example.com",
	token:
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
	apiKey: "AIzaSyDOCAbC123dEf456GhI789jKl012MnO345pQ",
} as const;

function expectScrubbed(serialized: string): void {
	for (const [label, value] of Object.entries(FORBIDDEN)) {
		expect(
			serialized.includes(value),
			`${label} survived scrubbing: ${value}`,
		).toBe(false);
	}
}

describe("redactText", () => {
	it("removes URLs, including the blob and data URLs an audio app creates", () => {
		expect(redactText(`failed to load ${FORBIDDEN.assetUrl}`)).not.toContain(
			"storage.googleapis.com",
		);
		expect(redactText("decode failed for blob:https://app/abc-123")).not.toContain(
			"blob:",
		);
		expect(redactText("data:audio/wav;base64,UklGRiQ")).not.toContain("base64");
	});

	it("removes email addresses", () => {
		expect(redactText(`no account for ${FORBIDDEN.email}`)).not.toContain("@");
	});

	it("removes JWTs and long opaque tokens", () => {
		expect(redactText(`auth failed: ${FORBIDDEN.token}`)).toContain("[token]");
		expect(redactText(`key ${FORBIDDEN.apiKey} rejected`)).not.toContain(
			FORBIDDEN.apiKey,
		);
	});

	it("removes quoted text, which is where user content usually appears", () => {
		expect(redactText(`Clip "${FORBIDDEN.clipName}" not found`)).not.toContain(
			FORBIDDEN.clipName,
		);
		expect(redactText(`Track '${FORBIDDEN.trackName}' is muted`)).not.toContain(
			FORBIDDEN.trackName,
		);
	});

	it("removes filesystem paths", () => {
		expect(
			redactText("/Users/alex/Music/Projects/midnight-drive.wav"),
		).not.toContain("midnight-drive");
	});

	it("keeps an ordinary diagnostic message readable", () => {
		// The rules must not reduce every message to noise.
		expect(redactText("Cannot read properties of undefined")).toBe(
			"Cannot read properties of undefined",
		);
	});

	it("truncates rather than transmitting an unbounded message", () => {
		const long = "a".repeat(5_000);
		expect(redactText(long).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 1);
	});

	it("never stringifies an arbitrary object", () => {
		// Its fields are exactly the project state this exists to keep out.
		expect(redactText({ project: FORBIDDEN.projectName })).toBe("[object]");
		expect(redactText(undefined)).toBe("");
	});
});

describe("scrubSelector", () => {
	it("keeps only tag names, dropping accessible names", () => {
		expect(
			scrubSelector(`button.delete[aria-label="Delete ${FORBIDDEN.trackName}"]`),
		).toBe("button");
	});

	it("keeps a tag chain", () => {
		expect(scrubSelector("div > ul > li.track-row")).toBe("div > ul > li");
	});

	it("returns nothing when there is no tag to keep", () => {
		expect(scrubSelector("#Midnight-Drive")).toBeUndefined();
	});
});

describe("pathOnly and scrubFramePath", () => {
	it("reduces a URL to its path", () => {
		expect(pathOnly("https://app.example.com/projects/prj_abc?token=xyz")).toBe(
			"/projects/prj_abc",
		);
	});

	it("keeps a bundle path but drops its query and fragment", () => {
		// Source-map symbolication needs the path (PRD OPS-03); a query could
		// carry a token.
		expect(
			scrubFramePath("https://app.example.com/assets/editor-a1b2.js?t=123"),
		).toBe("https://app.example.com/assets/editor-a1b2.js");
	});
});

describe("scrubBreadcrumb", () => {
	it("drops console breadcrumbs entirely (ADR 0001)", () => {
		expect(
			scrubBreadcrumb({
				category: "console",
				message: `loaded project ${FORBIDDEN.projectName}`,
				data: { arguments: [FORBIDDEN.assistantText] },
			}),
		).toBeNull();
	});

	it("keeps only method, status, and path for network breadcrumbs", () => {
		const crumb = scrubBreadcrumb({
			category: "fetch",
			message: FORBIDDEN.assetUrl,
			data: {
				url: `${FORBIDDEN.assetUrl}?token=${FORBIDDEN.token}`,
				method: "GET",
				status_code: 404,
			},
		});
		expectScrubbed(JSON.stringify(crumb));
		expect(crumb?.data?.method).toBe("GET");
		expect(crumb?.data?.status_code).toBe(404);
	});

	it("reduces DOM breadcrumbs to a tag name", () => {
		const crumb = scrubBreadcrumb({
			category: "ui.click",
			message: `button.play[title="${FORBIDDEN.clipName}"]`,
		});
		expect(crumb?.message).toBe("button");
	});

	it("reduces navigation breadcrumbs to paths", () => {
		const crumb = scrubBreadcrumb({
			category: "navigation",
			data: {
				from: "https://app.example.com/dashboard?q=dusty vinyl piano",
				to: "https://app.example.com/projects/prj_abc#token",
			},
		});
		expect(crumb?.data?.to).toBe("/projects/prj_abc");
		expect(JSON.stringify(crumb)).not.toContain("dusty");
	});

	it("redacts an unrecognized breadcrumb category", () => {
		// The default branch is what covers breadcrumbs added by later tasks.
		const crumb = scrubBreadcrumb({
			category: "some.future.category",
			message: `assistant said "${FORBIDDEN.assistantText}"`,
			data: { project: FORBIDDEN.projectName },
		});
		expectScrubbed(JSON.stringify(crumb));
		expect(crumb?.data).toBeUndefined();
	});
});

describe("scrubSentryEvent", () => {
	/** A deliberately hostile event: every forbidden shape, in every field. */
	function hostileEvent(): ScrubbableEvent {
		return {
			message: `Failed to save "${FORBIDDEN.projectName}"`,
			transaction: `/projects/${FORBIDDEN.projectName}`,
			request: {
				url: `https://app.example.com/projects?search=${FORBIDDEN.searchTerm}`,
				headers: { Authorization: `Bearer ${FORBIDDEN.token}` },
				cookies: { session: FORBIDDEN.token },
			},
			user: {
				email: FORBIDDEN.email,
				ip_address: "203.0.113.4",
				username: FORBIDDEN.email,
			},
			server_name: "alex-macbook.local",
			extra: {
				project: FORBIDDEN.projectName,
				assistantReply: FORBIDDEN.assistantText,
				apiKey: FORBIDDEN.apiKey,
			},
			contexts: {
				browser: { name: "Firefox", version: "142" },
				// A framework integration attaching application state.
				state: { song: { tracks: [{ name: FORBIDDEN.trackName }] } },
			},
			tags: {
				area: "persistence",
				error_code: "unavailable",
				project_name: FORBIDDEN.projectName,
			},
			exception: {
				values: [
					{
						type: "TypeError",
						value: `Clip '${FORBIDDEN.clipName}' missing from ${FORBIDDEN.assetUrl}`,
						stacktrace: {
							frames: [
								{
									filename:
										"https://app.example.com/assets/editor-a1b2.js?token=abc",
									abs_path:
										"https://app.example.com/assets/editor-a1b2.js?token=abc",
									function: "saveClip",
									lineno: 42,
									colno: 7,
									context_line: `const name = "${FORBIDDEN.sectionName}";`,
									vars: {
										clipName: FORBIDDEN.clipName,
										asset: FORBIDDEN.assetName,
									},
								},
							],
						},
					},
				],
			},
			breadcrumbs: [
				{
					category: "console",
					message: `saving ${FORBIDDEN.projectName}`,
					data: { arguments: [FORBIDDEN.assistantText] },
				},
				{
					category: "fetch",
					message: FORBIDDEN.assetUrl,
					data: { url: FORBIDDEN.assetUrl, method: "PUT", status_code: 500 },
				},
				{
					category: "ui.input",
					message: `input#search[value="${FORBIDDEN.searchTerm}"]`,
				},
			],
		};
	}

	it("removes every forbidden value from the whole payload", () => {
		// The acceptance criterion, exercised on the scrubbing function directly
		// so it also covers events and breadcrumbs added by later tasks.
		expectScrubbed(JSON.stringify(scrubSentryEvent(hostileEvent())));
	});

	it("drops request, user, extra, and server name outright", () => {
		const scrubbed = scrubSentryEvent(hostileEvent());
		expect(scrubbed.request).toBeUndefined();
		expect(scrubbed.user).toBeUndefined();
		expect(scrubbed.extra).toBeUndefined();
		expect(scrubbed.server_name).toBeUndefined();
	});

	it("allowlists contexts, dropping application state", () => {
		const scrubbed = scrubSentryEvent(hostileEvent());
		expect(scrubbed.contexts).toHaveProperty("browser");
		expect(scrubbed.contexts).not.toHaveProperty("state");
	});

	it("allowlists tags", () => {
		const scrubbed = scrubSentryEvent(hostileEvent());
		expect(scrubbed.tags).toEqual({
			area: "persistence",
			error_code: "unavailable",
		});
		for (const key of Object.keys(scrubbed.tags ?? {})) {
			expect(ALLOWED_TAGS).toContain(key as (typeof ALLOWED_TAGS)[number]);
		}
	});

	it("keeps the exception type and stack frame location for symbolication", () => {
		// PRD OPS-03 requires readable production stack traces; removing these
		// would defeat the source-map upload entirely.
		const frame = scrubSentryEvent(hostileEvent()).exception?.values?.[0]
			?.stacktrace?.frames?.[0];
		expect(scrubSentryEvent(hostileEvent()).exception?.values?.[0]?.type).toBe(
			"TypeError",
		);
		expect(frame?.filename).toBe("https://app.example.com/assets/editor-a1b2.js");
		expect(frame?.function).toBe("saveClip");
		expect(frame?.lineno).toBe(42);
	});

	it("drops local variables and source context from frames", () => {
		const frame = scrubSentryEvent(hostileEvent()).exception?.values?.[0]
			?.stacktrace?.frames?.[0];
		expect(frame?.vars).toBeUndefined();
		expect(frame?.context_line).toBeUndefined();
	});

	it("drops the console breadcrumb and keeps the scrubbed others", () => {
		const scrubbed = scrubSentryEvent(hostileEvent());
		expect(scrubbed.breadcrumbs).toHaveLength(2);
		expect(scrubbed.breadcrumbs?.map((crumb) => crumb.category)).toEqual([
			"fetch",
			"ui.input",
		]);
	});

	it("handles an empty event without throwing", () => {
		// beforeSend runs on the reporting path; it must be total.
		expect(() => scrubSentryEvent({})).not.toThrow();
	});

	it("preserves the mechanism that marks a session crashed", () => {
		// Release Health (and therefore the section 11 crash-free session rate)
		// depends on `handled: false` surviving scrubbing.
		const scrubbed = scrubSentryEvent({
			exception: {
				values: [
					{
						type: "Error",
						value: "boom",
						mechanism: { type: "solid_groove_boundary", handled: false },
					},
				],
			},
		});
		expect(scrubbed.exception?.values?.[0]?.mechanism).toEqual({
			type: "solid_groove_boundary",
			handled: false,
		});
	});
});
