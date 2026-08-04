import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { createArrangementSpikeProject } from "../domain/fixtures";
import { memoryStorage } from "../testing/storage";
import ArrangementView from "./ArrangementView";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** An `Analytics` that actually sends (consent granted, memory storage), with a
 * recording transport so tests can assert exactly what was logged. */
function analyticsAllowing() {
	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	consent.optIn();
	const analytics = new Analytics({
		transport,
		consent,
		releaseSha: "test0000test0000",
		surface: "editor",
		storage: memoryStorage(),
	});
	return { analytics, transport };
}

function renderView(analytics: Analytics) {
	const project = createArrangementSpikeProject(20);
	return render(() => (
		<ArrangementView project={project} analytics={analytics} />
	));
}

describe("ArrangementView shell", () => {
	it("renders the four named DOM actions for keyboard/accessibility workflows", () => {
		const { analytics } = analyticsAllowing();
		renderView(analytics);
		expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
		expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
		expect(screen.getByLabelText("Zoom to selection")).toBeInTheDocument();
		expect(screen.getByLabelText("Scroll to playhead")).toBeInTheDocument();
	});

	it("windows the DOM track headers rather than rendering one per track", () => {
		const { analytics } = analyticsAllowing();
		// 50 tracks at 28px is 1,400px of content; the default 480px viewport
		// windows to roughly 21 rows (+ overscan), well under all 50.
		const project = createArrangementSpikeProject(50);
		render(() => <ArrangementView project={project} analytics={analytics} />);
		const headerList = screen.getByLabelText("Tracks");
		const rows = headerList.querySelectorAll(".arrangement-header-row");
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(50);
	});

	it("exposes an accessible per-track select control (canvas is not the sole representation)", () => {
		const { analytics } = analyticsAllowing();
		renderView(analytics);
		const list = screen.getByLabelText("Arrangement tracks");
		const buttons = list.querySelectorAll("button[data-track-select]");
		expect(buttons.length).toBeGreaterThan(0);
	});

	it("selecting a track from the accessible list updates the live selection region", async () => {
		const { analytics } = analyticsAllowing();
		renderView(analytics);
		const list = screen.getByLabelText("Arrangement tracks");
		const firstSelect = list.querySelector<HTMLButtonElement>(
			"button[data-track-select]",
		);
		if (!firstSelect) throw new Error("no track-select control rendered");
		fireEvent.click(firstSelect);
		const live = screen.getByTestId("arrangement-selection-live");
		expect(live.textContent).toMatch(/^Selected /);
		expect(live.textContent).toMatch(/bars 1 to/);
	});
});

describe("arrangement feature_first_use analytics (PRD OPS-02)", () => {
	it("fires arrangement feature_first_use exactly once, on the first interaction", () => {
		const { analytics, transport } = analyticsAllowing();
		renderView(analytics);
		// No interaction yet: nothing logged.
		expect(featureUses(transport)).toEqual([]);

		fireEvent.click(screen.getByLabelText("Zoom in"));
		expect(featureUses(transport)).toEqual(["arrangement"]);

		// Further interactions do not re-fire it.
		fireEvent.click(screen.getByLabelText("Zoom out"));
		fireEvent.click(screen.getByLabelText("Zoom in"));
		expect(featureUses(transport)).toEqual(["arrangement"]);
	});

	it("logs nothing when analytics consent is denied", () => {
		const transport = createRecordingTransport();
		const consent = new ConsentStore(memoryStorage());
		consent.optOut();
		const analytics = new Analytics({
			transport,
			consent,
			releaseSha: "test0000test0000",
			surface: "editor",
			storage: memoryStorage(),
		});
		renderView(analytics);
		fireEvent.click(screen.getByLabelText("Zoom in"));
		fireEvent.click(screen.getByLabelText("Zoom out"));
		expect(transport.events).toEqual([]);
	});
});

function featureUses(
	transport: ReturnType<typeof createRecordingTransport>,
): string[] {
	return transport.events
		.filter((event) => event.name === "feature_first_use")
		.map((event) => event.params.feature as string);
}
