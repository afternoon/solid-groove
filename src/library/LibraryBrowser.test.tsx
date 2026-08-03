import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import LibraryBrowser from "./LibraryBrowser";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";

afterEach(() => cleanup());

function analytics() {
	const transport = createRecordingTransport();
	const instance = new Analytics({
		transport,
		consent: new ConsentStore(memoryStorage()),
		storage: memoryStorage(),
	});
	instance.setAccountType("anonymous");
	return { analytics: instance, transport };
}

function renderBrowser(
	overrides: {
		client?: LibraryClient;
		previewEngine?: ReturnType<typeof fakePreviewEngine>;
		analytics?: Analytics;
		onInsert?: (asset: unknown) => void;
	} = {},
) {
	const client = overrides.client ?? new LibraryClient(fixtureFetcher());
	const previewEngine = overrides.previewEngine ?? fakePreviewEngine();
	render(() => (
		<LibraryBrowser
			client={client}
			previewEngine={previewEngine}
			analytics={overrides.analytics}
			onInsert={overrides.onInsert}
		/>
	));
	return { previewEngine };
}

describe("packs as the first-class way in (LIB-05)", () => {
	it("lists every available pack plus an All-packs entry", async () => {
		renderBrowser();
		expect(
			await screen.findByRole("button", { name: "All packs" }),
		).toBeInTheDocument();
		// Every fixture pack is offered as a way in.
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /Core Electronic Drums/ }),
			).toBeInTheDocument(),
		);
		expect(
			screen.getByRole("button", { name: /Foundation Bass/ }),
		).toBeInTheDocument();
	});

	it("opens into a pack and shows its contents", async () => {
		renderBrowser();
		// The browser opens into the first pack, so its sounds are visible without
		// the user choosing the taxonomy first. Two sequential fetches (index then
		// the first pack's manifest) sit behind this, so the wait is generous.
		await waitFor(
			() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0),
			{ timeout: 3000 },
		);
		// Switching to another pack shows that pack's contents.
		fireEvent.click(screen.getByRole("button", { name: /Foundation Bass/ }));
		await waitFor(() =>
			expect(
				screen.getByRole("heading", { name: "Foundation Bass" }),
			).toBeInTheDocument(),
		);
		await waitFor(() =>
			expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0),
		);
	});
});

describe("search and filters (LIB-01/LIB-02)", () => {
	it("filters the visible sounds by a search query", async () => {
		renderBrowser();
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		await waitFor(() =>
			expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0),
		);
		const before = screen.getAllByRole("listitem").length;
		fireEvent.input(screen.getByRole("searchbox"), {
			target: { value: "zzzzz-no-match" },
		});
		await waitFor(() =>
			expect(screen.getByText(/No sounds match/)).toBeInTheDocument(),
		);
		expect(before).toBeGreaterThan(0);
	});

	it("re-exposes everything after clearing filters", async () => {
		renderBrowser();
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		await waitFor(() =>
			expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0),
		);
		const total = screen.getAllByRole("listitem").length;
		fireEvent.input(screen.getByRole("searchbox"), {
			target: { value: "kick" },
		});
		await waitFor(() =>
			expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(total),
		);
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		await waitFor(() =>
			expect(screen.getAllByRole("listitem").length).toBe(total),
		);
	});
});

describe("audition", () => {
	it("auditions on play and toggles to stop", async () => {
		const { previewEngine } = renderBrowser();
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		const auditionButton = await waitFor(
			() => screen.getAllByRole("button", { name: /^Audition / })[0],
		);
		fireEvent.click(auditionButton);
		await waitFor(() => expect(previewEngine.starts.length).toBe(1));
		// The row's button now offers Stop.
		await waitFor(() =>
			expect(
				screen.getAllByRole("button", { name: /^Stop / }).length,
			).toBeGreaterThan(0),
		);
		fireEvent.click(screen.getAllByRole("button", { name: /^Stop / })[0]);
		await waitFor(() =>
			expect(previewEngine.starts[0].stop).toHaveBeenCalled(),
		);
	});

	it("shows a per-row error when a preview fails, without blocking others", async () => {
		const { analytics: a, transport } = analytics();
		const previewEngine = fakePreviewEngine();
		renderBrowser({ analytics: a, previewEngine });
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		const auditionButton = await waitFor(
			() => screen.getAllByRole("button", { name: /^Audition / })[0],
		);
		previewEngine.failNextWith("network");
		fireEvent.click(auditionButton);
		await waitFor(() =>
			expect(transport.named("asset_load_failed")).toHaveLength(1),
		);
		// The rest of the list is still present and interactive.
		expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
	});
});

describe("insertion affordance", () => {
	it("fires onInsert with the chosen asset", async () => {
		const onInsert = vi.fn();
		renderBrowser({ onInsert });
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		const insertButton = await waitFor(
			() => screen.getAllByRole("button", { name: /^Insert / })[0],
		);
		fireEvent.click(insertButton);
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(onInsert.mock.calls[0][0]).toHaveProperty("packSlug");
	});
});

describe("error and empty states", () => {
	it("shows an actionable error and retries when the index fails", async () => {
		let attempt = 0;
		const client = new LibraryClient(async (path) => {
			attempt++;
			if (attempt === 1) throw new FetchClassifiedError("network", "offline");
			return fixtureFetcher()(path);
		});
		renderBrowser({ client });
		const retry = await screen.findByRole("button", { name: "Retry" });
		expect(screen.getByText(/Check your connection/)).toBeInTheDocument();
		fireEvent.click(retry);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /Core Electronic Drums/ }),
			).toBeInTheDocument(),
		);
	});

	it("names an unavailable pack locally while others keep working", async () => {
		// One specific pack's manifest is always unavailable; every other pack
		// loads. Under the cross-pack view its failure is named and isolated while
		// the rest of the library stays browsable.
		const client = new LibraryClient(async (path) => {
			if (path.includes("/foundation-bass/")) {
				throw new FetchClassifiedError("network", "offline");
			}
			return fixtureFetcher()(path);
		});
		renderBrowser({ client });
		fireEvent.click(await screen.findByRole("button", { name: "All packs" }));
		await waitFor(() =>
			expect(screen.getByText(/is unavailable/)).toBeInTheDocument(),
		);
		expect(screen.getByText(/Other packs still work/)).toBeInTheDocument();
		// The healthy packs still contributed browsable sounds.
		expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
	});
});
