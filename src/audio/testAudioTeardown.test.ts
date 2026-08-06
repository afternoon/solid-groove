import { describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";
import { installWebAudioTeardownGuard } from "./testAudioTeardown";

installWebAudioGlobals();

/**
 * The guard patches `node-web-audio-api`'s `AudioNode.prototype.dispatchEvent`,
 * so these tests only need *an* `AudioNode` to dispatch through — they never
 * play or render audio. An `OfflineAudioContext` yields a node on the identical
 * prototype chain without acquiring the real CoreAudio output device, which a
 * real `AudioContext` does. Under many parallel worktrees that device is
 * contended and cpal fails the stream with `play_output_stream ... OSStatus
 * 1937010544`, failing this file for reasons unrelated to what it asserts (#203).
 *
 * This is not mocking or weakening: the node is a genuine native node, it
 * resolves `dispatchEvent` to the guard's own installed wrapper, and both
 * assertions below are unchanged. Note `OfflineAudioContext` has no `close()` —
 * there is no output stream to release.
 */
function offlineNode(nwaa: typeof import("node-web-audio-api")) {
	return new nwaa.ConstantSourceNode(
		new nwaa.OfflineAudioContext(1, 128, 44100),
	);
}

describe("web audio teardown guard", () => {
	it("swallows the stale-Event dispatch TypeError from a node-web-audio-api node", async () => {
		installWebAudioTeardownGuard();
		const nwaa = await import("node-web-audio-api");
		const node = offlineNode(nwaa);
		// A jsdom Event whose realm no longer matches the bound dispatchEvent
		// is the shape of the post-teardown collision. We provoke the exact
		// thrown TypeError by dispatching a non-Event value: the inherited
		// (jsdom) dispatchEvent rejects it, and the guard must swallow *that*
		// specific failure rather than let it escape as an unhandled error.
		const dispatch = node.dispatchEvent as (e: unknown) => boolean;
		expect(dispatch.call(node, { type: "ended" })).toBe(false);
	});

	it("is transparent for a well-formed event (happy path still dispatches)", async () => {
		installWebAudioTeardownGuard();
		const nwaa = await import("node-web-audio-api");
		const node = offlineNode(nwaa);
		let heard = false;
		node.addEventListener("custom", () => {
			heard = true;
		});
		// A real, in-realm jsdom Event must pass straight through the guard.
		node.dispatchEvent(new Event("custom"));
		expect(heard).toBe(true);
	});

	it("dispatches through the guard's own wrapper, not the inherited implementation", async () => {
		installWebAudioTeardownGuard();
		const nwaa = await import("node-web-audio-api");
		// Guards the substitution itself: if an offline-context node ever stopped
		// resolving to the installed wrapper, the two tests above would pass
		// against the *unguarded* inherited dispatchEvent and quietly stop
		// covering the guard at all.
		expect(Object.getOwnPropertyNames(nwaa.AudioNode.prototype)).toContain(
			"dispatchEvent",
		);
		expect(offlineNode(nwaa).dispatchEvent).toBe(
			nwaa.AudioNode.prototype.dispatchEvent,
		);
	});
});
