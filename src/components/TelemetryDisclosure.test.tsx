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
