import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import {
	createFailingTransport,
	createRecordingTransport,
} from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import LandingPage from "./LandingPage";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const navigate = vi.fn();
vi.mock("@solidjs/router", () => ({
	useNavigate: () => navigate,
}));

function setup(
	options: {
		signInWithGoogle?: () => Promise<void>;
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
	const signInWithGoogle = vi.fn(
		options.signInWithGoogle ?? (() => Promise.resolve()),
	);
	const reportError = vi.fn();
	render(() => (
		<LandingPage
			analytics={analytics}
			loadAuthService={() => Promise.resolve({ signInWithGoogle })}
			reportError={reportError}
		/>
	));
	return { transport, signInWithGoogle, reportError };
}

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
			expect(screen.getByText(/no account, no install/i)).toBeInTheDocument();
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
			expect(
				screen.getByText(/early build, shared privately/i),
			).toHaveTextContent(/features change, and things break/i);
		});

		it("states the DEC-001 guest retention promise", () => {
			setup();
			expect(
				screen.getByText(/kept for 180 days after you last open them/i),
			).toBeInTheDocument();
		});

		// This page's "Log in" is `signInWithGoogle`, which swaps the uid rather
		// than linking, so it does not make a guest's projects permanent — it
		// makes them unreachable. `linkWithGoogle` is what keeps the promise, and
		// it lives behind the dashboard's upgrade prompt ("Sign up with Google").
		// A returning guest quietly losing their work is the failure this pins.
		it("points the retention promise at the control that keeps it, not at Log in", () => {
			setup();

			const note = screen.getByText(
				/kept for 180 days after you last open them/i,
			);
			expect(note).toHaveTextContent(/Sign up with Google/i);
			expect(note).toHaveTextContent(/projects page/i);
			expect(note.textContent ?? "").not.toMatch(
				/log in[^.]*to keep them indefinitely/i,
			);
		});

		it("says plainly that logging in does not carry guest projects across", () => {
			setup();
			expect(
				screen.getByText(/does not move guest projects into it/i),
			).toBeInTheDocument();
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

	describe("entry points (PRJ-01 anonymous start)", () => {
		it("drops the visitor into the anonymous-start flow with no account", async () => {
			setup();

			await userEvent.click(
				screen.getByRole("button", { name: "Start in your browser" }),
			);

			expect(navigate).toHaveBeenCalledWith("/dashboard");
		});

		it("offers the same start from the header and the closing section", async () => {
			setup();

			await userEvent.click(screen.getByRole("button", { name: "Start free" }));
			await userEvent.click(
				screen.getByRole("button", { name: "Start free — no account needed" }),
			);

			expect(navigate).toHaveBeenCalledTimes(2);
			expect(navigate).toHaveBeenLastCalledWith("/dashboard");
		});

		// The start path deliberately signs nobody in: `AuthProvider` owns the
		// anonymous start, which is what keeps `anon_session_created` firing for a
		// visitor who arrives through this page.
		it("does not sign in on the start path", async () => {
			const { signInWithGoogle } = setup();

			await userEvent.click(
				screen.getByRole("button", { name: "Start in your browser" }),
			);

			expect(signInWithGoogle).not.toHaveBeenCalled();
		});

		it("leads an existing user to log in, then into the app", async () => {
			const { signInWithGoogle } = setup();

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));

			await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
			await waitFor(() => expect(navigate).toHaveBeenCalledWith("/dashboard"));
		});

		it("recovers from a failed log-in without leaving the page", async () => {
			const { reportError } = setup({
				signInWithGoogle: () => Promise.reject(new Error("popup closed")),
			});

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));

			const alert = await screen.findByRole("alert");
			expect(alert).toHaveTextContent(/could not log in/i);
			expect(navigate).not.toHaveBeenCalled();
			// Non-fatal: the visitor is still on a working page (PRD OPS-03).
			expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
				area: "shell",
				fatal: false,
			});
			// And both paths are available again afterwards.
			expect(
				screen.getByRole("button", { name: "Start in your browser" }),
			).toBeEnabled();
			expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
		});
	});

	describe("analytics (PRD OPS-02)", () => {
		it("emits landing_cta_click once per start-free activation", async () => {
			const { transport } = setup();

			await userEvent.click(
				screen.getByRole("button", { name: "Start in your browser" }),
			);

			const events = transport.named("landing_cta_click");
			expect(events).toHaveLength(1);
			expect(events[0]?.params.cta_id).toBe("start_free");
			expect(events[0]?.params.surface).toBe("landing");
		});

		it("distinguishes the log-in path with its own cta_id", async () => {
			const { transport } = setup();

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));

			const events = transport.named("landing_cta_click");
			expect(events).toHaveLength(1);
			expect(events[0]?.params.cta_id).toBe("log_in");
		});

		it("counts the intent even when the log-in it starts fails", async () => {
			const { transport } = setup({
				signInWithGoogle: () => Promise.reject(new Error("popup closed")),
			});

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));

			await screen.findByRole("alert");
			expect(transport.named("landing_cta_click")).toHaveLength(1);
		});

		it("keeps both paths working when analytics is blocked", async () => {
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
					loadAuthService={() => Promise.resolve({ signInWithGoogle })}
					reportError={vi.fn()}
				/>
			));

			await userEvent.click(
				screen.getByRole("button", { name: "Start in your browser" }),
			);
			expect(navigate).toHaveBeenCalledWith("/dashboard");

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));
			await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
		});

		// DEC-009 / FND-001c: the disclosure and opt-out surface belong on this page.
		it("carries the analytics disclosure and its opt-out", async () => {
			setup();

			await userEvent.click(screen.getByText("Privacy"));

			expect(screen.getByText(/Two processors receive this/)).toHaveTextContent(
				/Sentry/,
			);
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
			for (const name of [
				"Start free",
				"Start in your browser",
				"Start free — no account needed",
				"Log in",
			]) {
				expect(screen.getByRole("button", { name })).toBeInTheDocument();
			}
		});

		it("announces a failed log-in to assistive technology", async () => {
			setup({ signInWithGoogle: () => Promise.reject(new Error("nope")) });

			await userEvent.click(screen.getByRole("button", { name: "Log in" }));

			expect(await screen.findByRole("alert")).toBeInTheDocument();
		});
	});
});
