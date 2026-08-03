import * as nwaa from "node-web-audio-api";

/**
 * Neutralises the one teardown-race artifact that `node-web-audio-api` produces
 * under jsdom, and nothing else.
 *
 * `node-web-audio-api` fires a scheduled source's `ended` event from a *native*
 * callback (see its `AudioScheduledSourceNode.js`), on the host event loop
 * rather than a JS microtask we can await. When a test schedules a note whose
 * stop time is still in the future and then disposes/closes the context, that
 * callback can fire *after* the whole Vitest run has finished and jsdom has been
 * torn down. Its `propagateEvent` then calls `dispatchEvent(new Event(...))`,
 * but the freshly-constructed `Event` no longer matches the (now stale) jsdom
 * `EventTarget.prototype.dispatchEvent` still bound to the node, so jsdom throws
 *
 *   TypeError: Failed to execute 'dispatchEvent' on 'EventTarget':
 *   parameter 1 is not of type 'Event'.
 *
 * Vitest installs its own `uncaughtException` listener and records that as an
 * unhandled error, failing an otherwise-green run — a peer `uncaughtException`
 * listener can't prevent Vitest's from also recording it, so the fix has to stop
 * the throw at its source.
 *
 * We do that by giving `node-web-audio-api`'s own `AudioNode.prototype` a
 * `dispatchEvent` that swallows *only* this exact failure and otherwise defers
 * to the inherited (jsdom) implementation. It is an environment artifact, not a
 * test failure: it can only happen *after* teardown (a live dispatch during a
 * test uses the matching jsdom `Event` and succeeds), so ignoring it cannot mask
 * a real in-test assertion or throw. The match is deliberately narrow — the
 * exact jsdom / native "not an Event" dispatch type error — so any other error
 * from an event handler still propagates normally.
 */
function isStaleEventDispatchTypeError(error: unknown): boolean {
	// jsdom throws from its own realm, so a cross-realm `instanceof Error` is
	// unreliable here — match structurally on `name`/`message` instead.
	if (typeof error !== "object" || error === null) return false;
	const { name, message } = error as { name?: unknown; message?: unknown };
	if (name !== "TypeError" || typeof message !== "string") return false;
	// jsdom words it "...parameter 1 is not of type 'Event'."; Node's native
	// EventTarget words the same failure "...must be an instance of Event".
	return (
		(/dispatchEvent/.test(message) && /not of type 'Event'/.test(message)) ||
		/must be an instance of Event/.test(message)
	);
}

let installed = false;

/**
 * Install the guard once per worker. Idempotent: any Tone-touching suite may
 * call it (it is wired through `installWebAudioGlobals`), and repeated calls
 * leave the single wrapper in place.
 */
export function installWebAudioTeardownGuard(): void {
	if (installed) return;
	const audioNode = (nwaa as unknown as { AudioNode?: { prototype: object } })
		.AudioNode;
	if (!audioNode?.prototype) return;
	const proto = audioNode.prototype as {
		dispatchEvent?: (event: Event) => boolean;
	};
	// The inherited (jsdom / native EventTarget) implementation.
	const inherited = proto.dispatchEvent;
	if (typeof inherited !== "function") return;
	installed = true;
	// An OWN property on node-web-audio-api's AudioNode.prototype, so the wrap is
	// scoped to its nodes and never touches the global EventTarget itself.
	proto.dispatchEvent = function guardedDispatchEvent(
		this: object,
		event: Event,
	): boolean {
		try {
			return inherited.call(this, event);
		} catch (error) {
			if (isStaleEventDispatchTypeError(error)) return false;
			throw error;
		}
	};
}
