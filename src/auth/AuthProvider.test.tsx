import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

type AuthCallback = (user: unknown) => void;

/** A controllable `authService` double: the test decides when it "resolves". */
function createFakeAuthService() {
  let callback: AuthCallback | null = null;
  return {
    service: {
      onAuthStateChanged: vi.fn((cb: AuthCallback) => {
        callback = cb;
        return () => {
          callback = null;
        };
      }),
      signInAnonymously: vi.fn(() => Promise.resolve()),
      signInWithGoogle: vi.fn(() => Promise.resolve()),
      linkWithGoogle: vi.fn(() => Promise.resolve()),
      signOut: vi.fn(() => Promise.resolve()),
      getCurrentUser: vi.fn(() => null),
    },
    emit(user: unknown) {
      callback?.(user);
    },
  };
}

async function renderAuthProvider() {
  const fake = createFakeAuthService();
  vi.doMock("./authService", () => ({ authService: fake.service }));

  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });

  const { AuthProvider } = await import("./AuthProvider");
  render(() => (
    <AuthProvider analytics={analytics}>
      <div>child</div>
    </AuthProvider>
  ));

  return { fake, transport };
}

describe("AuthProvider", () => {
  it("signs in anonymously and logs anon_session_created when there is no existing session", async () => {
    const { fake, transport } = await renderAuthProvider();

    fake.emit(null);

    await waitFor(() => {
      expect(fake.service.signInAnonymously).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(transport.named("anon_session_created")).toHaveLength(1);
    });
  });

  it("does not sign in anonymously or log anon_session_created for a returning session", async () => {
    const { fake, transport } = await renderAuthProvider();

    fake.emit({ uid: "user_returning", isAnonymous: true });

    // Give any (incorrect) async sign-in attempt a chance to happen.
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.service.signInAnonymously).not.toHaveBeenCalled();
    expect(transport.named("anon_session_created")).toHaveLength(0);
  });

  it("does not log anon_session_created again on a second null->user cycle from the same provider instance", async () => {
    const { fake, transport } = await renderAuthProvider();

    fake.emit(null);
    await waitFor(() => {
      expect(transport.named("anon_session_created")).toHaveLength(1);
    });

    fake.emit({ uid: "mock-anon-123", isAnonymous: true });
    await Promise.resolve();

    expect(transport.named("anon_session_created")).toHaveLength(1);
  });
});
