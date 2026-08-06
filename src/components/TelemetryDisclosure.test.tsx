import { cleanup, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ConsentStore } from "../analytics/consent";
import { memoryStorage } from "../testing/storage";
import TelemetryDisclosure from "./TelemetryDisclosure";

afterEach(() => cleanup());

function setup() {
	const storage = memoryStorage();
	const store = new ConsentStore(storage);
	render(() => <TelemetryDisclosure store={store} />);
	return { store, storage };
}

describe("TelemetryDisclosure (PRD OPS-02, section 10 Security and privacy)", () => {
	it("names both processors, so the user is told what is collected", () => {
		setup();
		const body = screen.getByText(/Google Analytics/).textContent ?? "";
		expect(body).toContain("Google Analytics");
		expect(body).toContain("Sentry");
	});

	it("states that no project content or typed text is collected", () => {
		setup();
		expect(
			screen.getByText(/no project, track, clip, or section names/),
		).toBeInTheDocument();
	});

	// ADR 0002 decision 5: "The user is told, before it happens." Replay is a
	// real expansion of collection, so the disclosure has to name it, say what
	// it is for, and say what it is not for. These four assertions are the four
	// things that sentence requires, checked separately so a copy edit that
	// drops one of them fails on that one.
	describe("Session Replay (ADR 0002 decision 5)", () => {
		it("names Session Replay specifically", () => {
			setup();
			expect(screen.getByText(/Session Replay records/)).toBeInTheDocument();
		});

		it("states its purpose: understanding how people use the app", () => {
			setup();
			expect(
				screen.getByText(/understand how people make music with Solid Groove/),
			).toBeInTheDocument();
		});

		it("states that it is not used to access the user's music or private information", () => {
			setup();
			expect(
				screen.getByText(
					/not used to access your music or anything else private/,
				),
			).toBeInTheDocument();
		});

		it("states that project content is masked out as the recording is made", () => {
			// "Masked out at capture, so it never reaches Sentry at all" is the
			// claim decision 2 makes true. If the masking could not support it, the
			// masking would be wrong — not this sentence.
			setup();
			expect(
				screen.getByText(/masked out as the recording is made/),
			).toBeInTheDocument();
			expect(
				screen.getByText(/never reaches Sentry at all/),
			).toBeInTheDocument();
		});

		it("keeps the promise that the user's music never leaves their project", () => {
			// Unchanged from before replay, and it must stay literally true with
			// replay on. The replay payload is covered in `scrub.test.ts`.
			setup();
			expect(
				screen.getByText(/Your music never leaves your project/),
			).toBeInTheDocument();
		});

		it("turns replay off with the same single control (ADR 0002 decision 4)", async () => {
			const { store } = setup();
			const toggle = screen.getByRole("checkbox", {
				name: /Share usage and error reports/,
			});

			await userEvent.click(toggle);

			expect(store.sessionReplayAllowed).toBe(false);
			expect(store.analyticsAllowed).toBe(false);
			expect(store.errorMonitoringAllowed).toBe(false);
		});

		it("still reads as on while replay alone is being collected", () => {
			// Otherwise the control would show "off" for a state in which session
			// recordings are still being made.
			const store = new ConsentStore(memoryStorage());
			store.set({
				productAnalytics: false,
				errorMonitoring: false,
				sessionReplay: true,
			});
			render(() => <TelemetryDisclosure store={store} />);
			expect(
				screen.getByRole("checkbox", {
					name: /Share usage and error reports/,
				}),
			).toBeChecked();
		});
	});

	it("promises that opting out costs no capability", () => {
		setup();
		expect(screen.getByText(/Every feature keeps working/)).toBeInTheDocument();
	});

	it("opts the user out through the control", async () => {
		const { store } = setup();
		const toggle = screen.getByRole("checkbox", {
			name: /Share usage and error reports/,
		});
		expect(toggle).toBeChecked();

		await userEvent.click(toggle);

		expect(store.analyticsAllowed).toBe(false);
		expect(store.errorMonitoringAllowed).toBe(false);
		expect(toggle).not.toBeChecked();
	});

	it("opts back in", async () => {
		const { store } = setup();
		const toggle = screen.getByRole("checkbox", {
			name: /Share usage and error reports/,
		});

		await userEvent.click(toggle);
		await userEvent.click(toggle);

		expect(store.analyticsAllowed).toBe(true);
		expect(toggle).toBeChecked();
	});

	it("persists the choice, so it survives a reload", async () => {
		const { storage } = setup();
		await userEvent.click(
			screen.getByRole("checkbox", { name: /Share usage and error reports/ }),
		);
		expect(new ConsentStore(storage).analyticsAllowed).toBe(false);
	});

	it("reflects a change made elsewhere", () => {
		const { store } = setup();
		store.optOut();
		expect(
			screen.getByRole("checkbox", { name: /Share usage and error reports/ }),
		).not.toBeChecked();
	});

	// `LOOP-001b`: the landing page gives it a designed home in its footer, so
	// it stops floating there. Same control and copy either way.
	it("floats as app chrome by default and sits inline when asked", () => {
		const store = new ConsentStore(memoryStorage());
		const { container } = render(() => (
			<>
				<TelemetryDisclosure store={store} />
				<TelemetryDisclosure store={store} placement="inline" />
			</>
		));
		const [floating, inline] = [
			...container.querySelectorAll(".telemetry-disclosure"),
		];
		expect(floating?.classList.contains("telemetry-disclosure-inline")).toBe(
			false,
		);
		expect(inline?.classList.contains("telemetry-disclosure-inline")).toBe(
			true,
		);
	});

	it("describes the control for assistive technology", () => {
		setup();
		const toggle = screen.getByRole("checkbox", {
			name: /Share usage and error reports/,
		});
		expect(toggle).toHaveAttribute(
			"aria-describedby",
			"telemetry-disclosure-note",
		);
	});
});
