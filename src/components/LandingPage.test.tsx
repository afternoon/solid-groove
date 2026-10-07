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
    /** Defaults to true, so a test never asks jsdom to play a video. */
    prefersReducedMotion?: boolean;
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
      prefersReducedMotion={() => options.prefersReducedMotion ?? true}
    />
  ));
  return { transport, signInWithGoogle, onAuthStateChanged, unsubscribe, reportError };
}

/** The header's Sign in, the page's one sign-in control. */
const signIn = () => screen.getByRole("button", { name: "Sign in" });

const requestInvites = () => screen.getAllByRole("link", { name: "Request an invite" });

describe("LandingPage (PRD PRJ-06)", () => {
  describe("what the page says (#1135)", () => {
    it("leads with the headline", () => {
      setup();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Finish the tracks you start.",
      );
    });

    it("says what Groove is, the AI producer, and the payoff, in that order", () => {
      setup();
      const lede = screen.getByText(/music studio in your browser with an AI producer/i);
      expect(lede.textContent).toMatch(
        /music studio in your browser.*AI producer.*learn the skills for your next track/s,
      );
    });

    it("says the alpha is invite-only and runs in the browser", () => {
      setup();
      expect(
        screen.getByText("Invite-only alpha · runs in your browser"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/small batches/i, { selector: ".landing-hint" }),
      ).toHaveTextContent(/nothing to install/i);
      expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    });

    // PRD PRJ-06: the AI producer has not shipped, so the page never shows it
    // as if it had: a badge with its date, and a captioned design study.
    it("labels the AI producer as coming, and its picture as a design study", () => {
      setup();
      expect(screen.getByText("Coming in October")).toBeInTheDocument();
      const study = screen.getByRole("img", { name: /design study of the AI producer/i });
      expect(study.closest("figure")).toHaveTextContent(
        "Design study. The AI producer arrives in October.",
      );
    });

    it("shows the studio today in four rows, each with a real screenshot", () => {
      setup();
      const section = screen
        .getByRole("heading", { level: 2, name: "In the studio today." })
        .closest("section");
      expect(section).toHaveAttribute("id", "inside");
      const rows = section?.querySelectorAll("article") ?? [];
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        const image = row.querySelector("img");
        expect(image?.getAttribute("src")).toMatch(/^\/landing\/\w+\.jpg$/);
        expect(image?.getAttribute("alt")).toBeTruthy();
      }
    });

    it("drops the old working-now and still-being-built lists", () => {
      setup();
      expect(screen.queryByText(/still being built/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/working now/i)).not.toBeInTheDocument();
    });

    it("answers the six questions, one of them about phones", () => {
      setup();
      const faq = screen
        .getByRole("heading", { level: 2, name: "Questions, answered." })
        .closest("section");
      expect(faq?.querySelectorAll("dt")).toHaveLength(6);
      expect(faq).toHaveTextContent(/Does it work on my phone\?/);
    });

    it("names no price anywhere", () => {
      setup();
      expect(screen.getByRole("main").textContent).not.toMatch(
        /\$|£|€|\bfree\b|price|per month/i,
      );
    });

    it("shows the hero video decoratively, with a poster, and never autoplays from markup", () => {
      setup({ prefersReducedMotion: true });
      const video = document.querySelector("video");
      // Hidden on its frame: Biome counts a bare video as focusable.
      expect(video?.closest("[aria-hidden='true']")).not.toBeNull();
      expect(video).toHaveAttribute("poster", "/landing/hero-poster.jpg");
      expect(video).not.toHaveAttribute("autoplay");
      expect(video?.querySelector("source")).toHaveAttribute("src", "/landing/hero.webm");
    });
  });

  describe("the hero video (#1135)", () => {
    it("plays it, muted, once the page is in", async () => {
      const play = vi
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
      setup({ prefersReducedMotion: false });

      await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
      expect(document.querySelector("video")?.muted).toBe(true);
      play.mockRestore();
    });

    it("leaves the poster up when the visitor prefers reduced motion", async () => {
      const play = vi
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
      setup({ prefersReducedMotion: true });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(play).not.toHaveBeenCalled();
      play.mockRestore();
    });
  });

  describe("entry points (#854: Request an invite and Sign in)", () => {
    it("points every Request an invite link at the request-access form", () => {
      setup();
      const links = requestInvites();
      // The header, the hero and the closing section.
      expect(links).toHaveLength(3);
      for (const link of links) expect(link).toHaveAttribute("href", requestAccessUrl);
    });

    it("leaves Request an invite to the browser, and signs nobody in", async () => {
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
      requestInvites()[0].dispatchEvent(event);

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

    it("shows Signing in… while a sign-in is in flight", async () => {
      setup({ signInWithGoogle: () => new Promise(() => {}) });

      await userEvent.click(signIn());

      const busy = await screen.findByRole("button", { name: "Signing in…" });
      expect(busy).toBeDisabled();
    });
  });

  describe("analytics (PRD OPS-02)", () => {
    it("emits landing_cta_click once per Request an invite, with its placement", () => {
      const { transport } = setup();
      document.addEventListener("click", (event) => event.preventDefault());

      for (const link of requestInvites()) link.click();

      const events = transport.named("landing_cta_click");
      expect(events.map((event) => event.params)).toEqual([
        expect.objectContaining({ cta_id: "request_access", placement: "header" }),
        expect.objectContaining({ cta_id: "request_access", placement: "hero" }),
        expect.objectContaining({ cta_id: "request_access", placement: "close" }),
      ]);
      expect(events[0]?.params.surface).toBe("landing");
    });

    it("distinguishes the sign-in path with its own cta_id", async () => {
      const { transport } = setup();

      await userEvent.click(signIn());

      const events = transport.named("landing_cta_click");
      expect(events).toHaveLength(1);
      expect(events[0]?.params).toMatchObject({ cta_id: "log_in", placement: "header" });
    });

    it("counts See what's inside as its own call to action", () => {
      const { transport } = setup();
      document.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });

      screen.getByRole("link", { name: "See what's inside" }).click();

      const events = transport.named("landing_cta_click");
      expect(events).toHaveLength(1);
      expect(events[0]?.params).toMatchObject({
        cta_id: "see_inside",
        placement: "hero",
      });
    });

    it("logs feature_first_use for landing_v2 once, on the first call to action", () => {
      const { transport } = setup();
      document.addEventListener("click", (event) => event.preventDefault());

      screen.getByRole("link", { name: "See what's inside" }).click();
      for (const link of requestInvites()) link.click();

      const firstUse = transport
        .named("feature_first_use")
        .filter((event) => event.params.feature === "landing_v2");
      expect(firstUse).toHaveLength(1);
    });

    it("logs landing_video_play once per page view, however often it resumes", () => {
      const { transport } = setup();
      const video = document.querySelector("video");
      if (!video) throw new Error("no hero video");

      video.dispatchEvent(new Event("play"));
      video.dispatchEvent(new Event("play"));

      const events = transport.named("landing_video_play");
      expect(events).toHaveLength(1);
      expect(events[0]?.params.surface).toBe("landing");
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
          prefersReducedMotion={() => true}
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
    it("uses one h1, an h2 per section, and labelled landmarks", () => {
      setup();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      // Who it's for, the AI producer, the studio, where it fits, how it
      // works, the FAQ and the closing call to action.
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
      for (const image of screen.getAllByRole("img")) {
        expect(image).toHaveAccessibleName();
      }
      expect(screen.getByRole("main")).toBeInTheDocument();
      expect(
        screen.getByRole("navigation", { name: /get started/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });

    it("gives every call to action a real accessible name", () => {
      setup();
      // Request an invite is a link because it leads somewhere; Sign in is a
      // button because it opens a provider popup and goes nowhere on its own.
      expect(requestInvites()).toHaveLength(3);
      expect(screen.getAllByRole("button", { name: "Sign in" })).toHaveLength(1);
      expect(screen.getByRole("link", { name: "See what's inside" })).toHaveAttribute(
        "href",
        "#inside",
      );
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
