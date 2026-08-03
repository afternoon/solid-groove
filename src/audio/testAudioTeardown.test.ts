import { describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";
import { installWebAudioTeardownGuard } from "./testAudioTeardown";

installWebAudioGlobals();

describe("web audio teardown guard", () => {
	it("swallows the stale-Event dispatch TypeError from a node-web-audio-api node", async () => {
		installWebAudioTeardownGuard();
		const nwaa = await import("node-web-audio-api");
		const ctx = new nwaa.AudioContext();
		try {
			const node = new nwaa.ConstantSourceNode(ctx);
			// A jsdom Event whose realm no longer matches the bound dispatchEvent
			// is the shape of the post-teardown collision. We provoke the exact
			// thrown TypeError by dispatching a non-Event value: the inherited
			// (jsdom) dispatchEvent rejects it, and the guard must swallow *that*
			// specific failure rather than let it escape as an unhandled error.
			const dispatch = node.dispatchEvent as (e: unknown) => boolean;
			expect(dispatch.call(node, { type: "ended" })).toBe(false);
		} finally {
			await ctx.close();
		}
	});

	it("is transparent for a well-formed event (happy path still dispatches)", async () => {
		installWebAudioTeardownGuard();
		const nwaa = await import("node-web-audio-api");
		const ctx = new nwaa.AudioContext();
		try {
			const node = new nwaa.ConstantSourceNode(ctx);
			let heard = false;
			node.addEventListener("custom", () => {
				heard = true;
			});
			// A real, in-realm jsdom Event must pass straight through the guard.
			node.dispatchEvent(new Event("custom"));
			expect(heard).toBe(true);
		} finally {
			await ctx.close();
		}
	});
});
