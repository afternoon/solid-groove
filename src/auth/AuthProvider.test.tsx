import { cleanup, render } from "@solidjs/testing-library";
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
  // #854: guest start is retired. No session means signed out, and nothing
  // is minted in its place.
  it("leaves a visitor with no session signed out, and starts no guest", async () => {
    const { fake, transport } = await renderAuthProvider();

    fake.emit(null);
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.service.signInWithGoogle).not.toHaveBeenCalled();
    expect("signInAnonymously" in fake.service).toBe(false);
    expect(transport.named("anon_session_created")).toHaveLength(0);
  });

  it("restores a guest session from before the alpha closed, as it is", async () => {
    const { fake, transport } = await renderAuthProvider();

    fake.emit({ uid: "user_returning", isAnonymous: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.service.signInWithGoogle).not.toHaveBeenCalled();
    expect(transport.named("anon_session_created")).toHaveLength(0);
  });
});
