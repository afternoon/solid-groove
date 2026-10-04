import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import type { User } from "firebase/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAccessUrl } from "../../site.config.mjs";
import { NOT_ON_ALLOWLIST } from "../access/allowlist";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createFailingTransport, createRecordingTransport } from "../analytics/transport";
import type { AuthService } from "../auth/authService";
import { memoryStorage } from "../testing/storage";
import LandingPage from "./LandingPage";

afterEach(() => {
  cleanup();
  // `resetAllMocks`, not `restoreAllMocks`: the mocks here are module-level
  // `vi.fn()`s (see the `vi.hoisted` block below), and from Vitest 4
  // `restoreAllMocks` only restores spies created with `vi.spyOn` — it no
  // longer clears a plain `vi.fn()`'s calls or implementation. There are no
  // spies in this file, so it had become a no-op and call counts leaked from
  // one test into the next. `resetAllMocks` clears both, which is what this
  // teardown always meant.
  vi.resetAllMocks();
});

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigate,
}));

/**
 * A persisted session as the auth service reports it. Only `isAnonymous` and a
 * uid matter to this page, so the rest of `User` is not worth standing up.
 */
function persistedUser(isAnonymous: boolean): User {
  return { uid: isAnonymous ? "anon-1" : "registered-1", isAnonymous } as User;
}

function setup(
  options: {
    signInWithGoogle?: () => Promise<void>;
    /**
     * The session the injected auth service restores, reported the way Firebase
     * reports it: on the first `onAuthStateChanged` emission, asynchronously.
     * Omitted means "no session at all", which is what a first-time visitor has.
     */
    restoredUser?: User | null;
    /** For the case where the restored state never arrives at all. */
    onAuthStateChanged?: AuthService["onAuthStateChanged"];
    /** Shortened where a test waits the restore budget out. */
    sessionRestoreTimeoutMs?: number;
    analyticsTransport?: ReturnType<typeof createRecordingTransport>;
  } = {},
) {
  navigate.mockReset();
  const transport = options.analyticsTransport ?? createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
    surface: "landing",
  });
  const signInWithGoogle = vi.fn(options.signInWithGoogle ?? (() => Promise.resolve()));
  const unsubscribe = vi.fn();
  const onAuthStateChanged = vi.fn<AuthService["onAuthStateChanged"]>(
    options.onAuthStateChanged ??
      ((callback) => {
        // Asynchronously, deliberately: Firebase restores the persisted session
        // after the SDK loads, which is why a synchronous `getCurrentUser()`
        // read reports "no session" for exactly the visitor #308 is about.
        queueMicrotask(() => callback(options.restoredUser ?? null));
        return unsubscribe;
      }),
  );
  const reportError = vi.fn();
  render(() => (
    <LandingPage
      analytics={analytics}
      loadAuthService={() => Promise.resolve({ signInWithGoogle, onAuthStateChanged })}
      reportError={reportError}
      sessionRestoreTimeoutMs={options.sessionRestoreTimeoutMs}
    />
  ));
  return { transport, signInWithGoogle, onAuthStateChanged, unsubscribe, reportError };
}

/** The header's Sign in; the hero repeats it. */
const signIn = () => screen.getAllByRole("button", { name: "Sign in" })[0];

describe("LandingPage (PRD PRJ-06)", () => {
  describe("what the page says", () => {
    it("states the product promise", () => {
      setup();
      expect(
        screen.getByRole("heading", { level: 1, name: /bring a loop/i }),
      ).toHaveTextContent(/leave with a track/i);
    });

    it("says it runs in the browser with nothing to install", () => {
      setup();
      expect(
        screen.getByText(/music studio that runs in your browser/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/the alpha is invite-only/i)).toHaveTextContent(
        /nothing to install/i,
      );
    });

    it("names the browsers it is tested in, and Safari's weaker status", () => {
      setup();
      const support = screen.getByText(/Chrome, Edge and Firefox/);
      expect(support).toHaveTextContent(/test every release/i);
      expect(support).toHaveTextContent(/Safari should work/i);
    });

    it("states the private-alpha status honestly", () => {
      setup();
      expect(screen.getAllByText(/private alpha/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/early build, shared privately/i)).toHaveTextContent(
        /features change, and things break/i,
      );
    });

    // #854: the alpha is invite-only, so the page says so rather than offering
    // a start with no account that no longer exists.
    it("says the alpha is invite-only, and offers no start without an account", () => {
      setup();
      expect(screen.getByText(/the alpha is invite-only/i)).toBeInTheDocument();
      expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /start/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/kept for 180 days/i)).not.toBeInTheDocument();
    });

    // PRD PRJ-06: the page "does not advertise capabilities beyond the current
    // milestone". The unshipped capabilities are named only under the heading
    // that says they are not here yet.
    it("lists unshipped capabilities as still being built, not as features", () => {
      setup();
      const pending = screen
        .getByRole("heading", { name: /still being built/i })
        .closest(".landing-column");
      expect(pending).not.toBeNull();
      for (const capability of [
        /AI producer/i,
        /arrangement timeline/i,
        /sound library/i,
        /export/i,
      ]) {
        expect(pending?.textContent).toMatch(capability);
      }
    });
  });

  describe("entry points (#854: Request access and Sign in)", () => {
    it("points every Request access control at the request-access form", () => {
      setup();
      const links = screen.getAllByRole("link", { name: "Request access" });
      // The header, the hero and the closing section.
      expect(links).toHaveLength(3);
      for (const link of links) expect(link).toHaveAttribute("href", requestAccessUrl);
    });

    it("leaves Request access to the browser, and signs nobody in", async () => {
      const { signInWithGoogle } = setup();

      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      let cancelledByThePage: boolean | undefined;
      document.addEventListener(
        "click",
        (bubbled) => {
          cancelledByThePage = bubbled.defaultPrevented;
          bubbled.preventDefault();
        },
        { once: true },
      );
      screen.getAllByRole("link", { name: "Request access" })[0].dispatchEvent(event);

      expect(cancelledByThePage).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(signInWithGoogle).not.toHaveBeenCalled();
    });

    it("signs an invited producer in, then into the app", async () => {
      const { signInWithGoogle } = setup();

      await userEvent.click(signIn());

      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
    });

    it("offers Sign in in the hero as well as the header", async () => {
      const { signInWithGoogle } = setup();
      expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(2);

      await userEvent.click(screen.getAllByRole("button", { name: "Sign in" })[1]);

      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
    });

    // #308: a returning visitor who was already signed in went through Google's
    // account chooser again, because this handler never asked whether a session
    // existed before starting one.
    it("recognises a persisted registered session instead of signing in again", async () => {
      const { signInWithGoogle, unsubscribe } = setup({
        restoredUser: persistedUser(false),
      });

      await userEvent.click(signIn());

      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
      expect(signInWithGoogle).not.toHaveBeenCalled();
      // One emission read, not a standing subscription on a page that is leaving.
      expect(unsubscribe).toHaveBeenCalled();
    });

    // #854: a guest session from before the alpha closed keeps its projects
    // until it upgrades, so Sign in takes it back to them rather than swapping
    // it for a Google account and leaving its work behind.
    it("takes a guest from before the alpha closed back to their projects", async () => {
      const { signInWithGoogle } = setup({ restoredUser: persistedUser(true) });

      await userEvent.click(signIn());

      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
      expect(signInWithGoogle).not.toHaveBeenCalled();
    });

    // A restored state that never arrives must not leave the button on
    // "Signing in…" forever: the click falls back to the provider.
    it("signs in anyway when the session state never resolves", async () => {
      const unsubscribe = vi.fn();
      const { signInWithGoogle } = setup({
        onAuthStateChanged: () => unsubscribe,
        sessionRestoreTimeoutMs: 5,
      });

      await userEvent.click(signIn());

      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
      expect(unsubscribe).toHaveBeenCalled();
    });

    it("recovers from a failed sign-in without leaving the page", async () => {
      const { reportError } = setup({
        signInWithGoogle: () => Promise.reject(new Error("popup closed")),
      });

      await userEvent.click(signIn());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/could not sign in/i);
      expect(navigate).not.toHaveBeenCalled();
      // Non-fatal: the visitor is still on a working page (PRD OPS-03).
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        area: "shell",
        fatal: false,
      });
      expect(signIn()).toBeEnabled();
    });

    it("shows Signing in… on both buttons while a sign-in is in flight", async () => {
      setup({ signInWithGoogle: () => new Promise(() => {}) });

      await userEvent.click(signIn());

      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: "Signing in…" })).toHaveLength(2),
      );
      for (const button of screen.getAllByRole("button", { name: "Signing in…" })) {
        expect(button).toBeDisabled();
      }
    });
  });

  describe("analytics (PRD OPS-02)", () => {
    it("emits landing_cta_click once per Request access activation", () => {
      const { transport } = setup();
      document.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });

      screen.getAllByRole("link", { name: "Request access" })[1].click();

      const events = transport.named("landing_cta_click");
      expect(events).toHaveLength(1);
      expect(events[0]?.params.cta_id).toBe("request_access");
      expect(events[0]?.params.surface).toBe("landing");
    });

    it("distinguishes the sign-in path with its own cta_id", async () => {
      const { transport } = setup();

      await userEvent.click(signIn());

      const events = transport.named("landing_cta_click");
      expect(events).toHaveLength(1);
      expect(events[0]?.params.cta_id).toBe("log_in");
    });

    it("counts the intent even when the sign-in it starts fails", async () => {
      const { transport } = setup({
        signInWithGoogle: () => Promise.reject(new Error("popup closed")),
      });

      await userEvent.click(signIn());

      await screen.findByRole("alert");
      expect(transport.named("landing_cta_click")).toHaveLength(1);
    });

    it("keeps signing in working when analytics is blocked", async () => {
      const analytics = new Analytics({
        transport: createFailingTransport(),
        consent: new ConsentStore(memoryStorage()),
        storage: memoryStorage(),
        surface: "landing",
      });
      const signInWithGoogle = vi.fn(() => Promise.resolve());
      navigate.mockReset();
      render(() => (
        <LandingPage
          analytics={analytics}
          loadAuthService={() =>
            Promise.resolve({
              signInWithGoogle,
              onAuthStateChanged: (callback) => {
                queueMicrotask(() => callback(null));
                return () => {};
              },
            })
          }
          reportError={vi.fn()}
        />
      ));

      await userEvent.click(signIn());
      await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/projects"));
    });

    // DEC-009 / FND-001c: the disclosure and opt-out surface belong on this page.
    it("carries the analytics disclosure and its opt-out", async () => {
      setup();

      await userEvent.click(screen.getByText("Privacy"));

      expect(screen.getByText(/Two processors receive this/)).toHaveTextContent(/Sentry/);
      expect(
        screen.getByRole("checkbox", {
          name: /share usage and error reports/i,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("accessibility (PRD section 10)", () => {
    it("uses one h1 and labelled landmarks", () => {
      setup();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("main")).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: /get started/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });

    it("gives every call to action a real accessible name", () => {
      setup();
      // Request access is a link because it leads somewhere; Sign in is a
      // button because it opens a provider popup and goes nowhere on its own.
      expect(screen.getAllByRole("link", { name: "Request access" })).toHaveLength(3);
      expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(2);
    });

    it("announces a failed sign-in to assistive technology", async () => {
      setup({ signInWithGoogle: () => Promise.reject(new Error("nope")) });

      await userEvent.click(signIn());

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
  });

  describe("the alpha allowlist (#854)", () => {
    /** What Firebase hands back when the blocking function refuses a sign-in. */
    const refusal = () =>
      Object.assign(
        new Error(
          `Firebase: {"error":{"message":"BLOCKING_FUNCTION_ERROR_RESPONSE : ((${NOT_ON_ALLOWLIST}))"}} (auth/internal-error).`,
        ),
        { code: "auth/internal-error" },
      );

    it("sends a refused sign-in to the not-on-the-list page, not an error", async () => {
      const { reportError } = setup({
        signInWithGoogle: () => Promise.reject(refusal()),
      });

      await userEvent.click(signIn());

      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/not-invited"));
      expect(navigate).not.toHaveBeenCalledWith("/projects");
      expect(reportError).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("counts the refusal once, naming only where it happened", async () => {
      const { transport } = setup({ signInWithGoogle: () => Promise.reject(refusal()) });

      await userEvent.click(signIn());

      await waitFor(() => expect(transport.named("sign_in_blocked")).toHaveLength(1));
      expect(transport.named("sign_in_blocked")[0].params).toMatchObject({
        source: "landing",
      });
    });
  });
});
