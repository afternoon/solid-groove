import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { AuthProvider } from "../auth/AuthProvider";
import { memoryStorage } from "../testing/storage";
import Dashboard from "./Dashboard";

// Issue #868: the real `AuthProvider` wrapped around the real `Dashboard`, with
// only the Firebase boundary (`authService`), the router and the repository
// doubled. Anonymous sign-in failing must not leave the page on the loader.

const fakeAuth = vi.hoisted(() => {
  let callback: ((user: unknown) => void) | null = null;
  return {
    emit(user: unknown) {
      callback?.(user);
    },
    service: {
      onAuthStateChanged: (cb: (user: unknown) => void) => {
        callback = cb;
        return () => {
          callback = null;
        };
      },
      signInAnonymously: vi.fn(),
    },
  };
});

vi.mock("../auth/authService", () => ({ authService: fakeAuth.service }));

vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn() }));

const listProjects = vi.hoisted(() => vi.fn());
vi.mock("../projectRepositoryClient", () => ({
  getProjectRepository: () =>
    Promise.resolve({ listProjects: (...args: unknown[]) => listProjects(...args) }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderDashboardPage() {
  const analytics = new Analytics({
    transport: createRecordingTransport(),
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  render(() => (
    <AuthProvider analytics={analytics}>
      <Dashboard analytics={analytics} />
    </AuthProvider>
  ));
}

const networkFailure = () =>
  Object.assign(new Error("Firebase: Error (auth/network-request-failed)."), {
    code: "auth/network-request-failed",
  });

describe("Dashboard when anonymous sign-in fails (#868)", () => {
  it("replaces the loader with an error and a retry that signs in again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listProjects.mockResolvedValue([]);
    fakeAuth.service.signInAnonymously
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(() => {
        fakeAuth.emit({ uid: "anon-1", isAnonymous: true });
        return Promise.resolve();
      });

    renderDashboardPage();
    fakeAuth.emit(null);

    expect(await screen.findByText(/Couldn't sign you in/)).toBeInTheDocument();
    expect(screen.queryByText("Loading projects")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    flush();

    expect(
      await screen.findByRole("button", { name: /New Project/ }),
    ).toBeInTheDocument();
    expect(fakeAuth.service.signInAnonymously).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Couldn't sign you in/)).not.toBeInTheDocument();
  });

  it("shows the loader again while a retry is in flight, then the error if it fails too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectRetry: (error: unknown) => void = () => {};
    fakeAuth.service.signInAnonymously
      .mockRejectedValueOnce(networkFailure())
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectRetry = reject;
          }),
      );

    renderDashboardPage();
    fakeAuth.emit(null);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    flush();
    expect(await screen.findByText("Loading projects")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't sign you in/)).not.toBeInTheDocument();

    rejectRetry(networkFailure());
    expect(await screen.findByText(/Couldn't sign you in/)).toBeInTheDocument();
  });
});
