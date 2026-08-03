/**
 * Swallows the one teardown-race artifact that `node-web-audio-api` produces
 * under jsdom, and nothing else.
 *
 * `node-web-audio-api` fires a scheduled source's `ended` event from a *native*
 * callback (see `AudioScheduledSourceNode.js`), on the host event loop rather
 * than a JS microtask we can await. When a test schedules a note whose stop
 * time is still in the future and then disposes/closes the context, that native
 * callback can fire *after* the whole Vitest run has finished and jsdom has been
 * torn down. Its `propagateEvent` then calls `dispatchEvent(new Event(...))`,
 * but the freshly-constructed `Event` no longer matches the (now stale) jsdom
 * `EventTarget.prototype.dispatchEvent` still bound to the node, so jsdom throws
 *
 *   TypeError: Failed to execute 'dispatchEvent' on 'EventTarget':
 *   parameter 1 is not of type 'Event'.
 *
 * Vitest reports that as an unhandled error and fails an otherwise-green run.
 * It is an environment artifact, not a test failure: it can only happen *after*
 * teardown (a live dispatch during a test uses the matching jsdom `Event` and
 * succeeds), so ignoring it cannot mask a real in-test assertion or throw.
 *
 * The match is deliberately narrow — the exact jsdom message AND a
 * `node-web-audio-api` `propagateEvent` frame in the stack — so any other
 * unhandled `dispatchEvent` error still surfaces normally.
 */
function isNwaaTeardownDispatchArtifact(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	// The strong discriminator: it must have originated in node-web-audio-api's
	// native `ended` propagation (`propagateEvent` in `lib/events.js`). Any
	// error a test itself throws lacks this frame.
	const fromNwaaPropagateEvent = /node-web-audio-api[\\/].*events\.js/.test(
		error.stack ?? "",
	);
	if (!fromNwaaPropagateEvent) return false;
	// ...and it must be the `dispatchEvent` type mismatch itself — jsdom words it
	// "parameter 1 is not of type 'Event'"; Node's native EventTarget words the
	// same failure "must be an instance of Event". Both are the stale-`Event`
	// teardown collision, never a real test assertion.
	return (
		error.name === "TypeError" &&
		(/dispatchEvent/.test(error.message) ||
			/instance of Event/.test(error.message))
	);
}

let installed = false;

/**
 * Install the guard once per worker. Idempotent: any Tone-touching suite may
 * call it (it is wired through `installWebAudioGlobals`), and repeated calls add
 * no extra listeners.
 *
 * The listener only ever *swallows* the artifact above. For any other uncaught
 * exception it re-emits on the next tick with itself detached, so Vitest's own
 * `uncaughtException` handling still sees and reports the error — we suppress
 * the one benign event, never the rest.
 */
export function installWebAudioTeardownGuard(): void {
	if (installed) return;
	installed = true;
	const handler = (error: Error): void => {
		if (isNwaaTeardownDispatchArtifact(error)) return;
		process.removeListener("uncaughtException", handler);
		installed = false;
		process.nextTick(() => {
			throw error;
		});
	};
	process.on("uncaughtException", handler);
}
