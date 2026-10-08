import type { AssistantClient } from "./assistant/assistantClient";
import { createAssistantClient } from "./assistant/assistantClient";
import { isMockBackend, resolveEmulatorHosts } from "./devBackend";

/**
 * The editor's `AssistantClient` (GRV-26), chosen the way the repository
 * clients choose theirs: the mock backend runs the gateway in the page over
 * the emulator's scripted provider (`src/assistant/localTransport.ts`), and
 * everything else (the emulator included) calls the `assistantTurn`
 * callable. Both are imported dynamically, so neither `firebase/functions`
 * nor the gateway joins a graph that never opens the assistant.
 */
let cached: Promise<AssistantClient> | null = null;

export function getAssistantClient(): Promise<AssistantClient> {
  if (cached) return cached;
  const pending = createClient();
  cached = pending;
  // A failed load (a chunk that did not arrive, say) must not stick: the
  // next caller tries again rather than inheriting the rejection forever.
  pending.catch(() => {
    if (cached === pending) cached = null;
  });
  return pending;
}

async function createClient(): Promise<AssistantClient> {
  if (isMockBackend) {
    const [
      { createLocalAssistantTransport },
      { createEmulatorAssistantProvider },
      guards,
    ] = await Promise.all([
      import("./assistant/localTransport"),
      import("./assistant/emulatorProvider"),
      import("./assistant/inMemoryGuardStores"),
    ]);
    return createAssistantClient(
      createLocalAssistantTransport(
        {
          provider: createEmulatorAssistantProvider(),
          guards: guards.createInMemoryGuardStores(),
          log: () => {},
          now: Date.now,
        },
        { uid: "mock-user", signInProvider: "google.com" },
      ),
    );
  }
  const [{ createFirebaseAssistantTransport }, { app }] = await Promise.all([
    import("./firebaseAssistantTransport"),
    import("./firebaseConfig"),
  ]);
  return createAssistantClient(
    createFirebaseAssistantTransport(app, resolveEmulatorHosts()?.functions ?? null),
  );
}
