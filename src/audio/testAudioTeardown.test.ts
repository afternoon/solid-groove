import { describe, expect, it } from "vitest";
import { installWebAudioGlobals } from "./testAudioContext";
import { installWebAudioTeardownGuard } from "./testAudioTeardown";

installWebAudioGlobals();

/**
 * An `AudioNode` to dispatch against, built without touching the output device.
 *
 * The guard patches `nwaa.AudioNode.prototype.dispatchEvent`, so any node that
 * inherits from that prototype exercises it. An `OfflineAudioContext` renders
 * into a buffer and never opens a CoreAudio output stream, so these tests no
 * longer contend for the shared device the way a real `AudioContext` does —
 * the contention that made this file flake under parallel worktrees (#203).
 * Nothing about the assertion is weakened: the node, the prototype, and the
 * inherited `dispatchEvent` are the same ones a real context would give us.
 */
async function createOfflineAudioNode() {
  const nwaa = await import("node-web-audio-api");
  // One channel, one render quantum, at a rate every backend accepts. The
  // context is never started; it exists only to parent the node.
  const ctx = new nwaa.OfflineAudioContext(1, 128, 44100);
  return new nwaa.ConstantSourceNode(ctx);
}

describe("web audio teardown guard", () => {
  it("swallows the stale-Event dispatch TypeError from a node-web-audio-api node", async () => {
    installWebAudioTeardownGuard();
    const node = await createOfflineAudioNode();
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
    const node = await createOfflineAudioNode();
    let heard = false;
    node.addEventListener("custom", () => {
      heard = true;
    });
    // A real, in-realm jsdom Event must pass straight through the guard.
    node.dispatchEvent(new Event("custom"));
    expect(heard).toBe(true);
  });
});
