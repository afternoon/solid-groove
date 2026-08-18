import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import {
	FIXTURE_PACK_INDEX_DOC,
	fixtureFetcher,
} from "./__fixtures__/fixtures";
import LibraryBrowser from "./LibraryBrowser";
import { FetchClassifiedError, LibraryClient } from "./libraryClient";

afterEach(() => cleanup());

const PACKS = FIXTURE_PACK_INDEX_DOC.packs;
const FIRST_PACK = PACKS[0];
const SECOND_PACK = PACKS[1];

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

/**
 * Render the panel and open the pack browser from it — the way a user reaches
 * the modal — so the test exercises the real entrypoint rather than mounting
 * the dialog with a hand-made controller.
 */
async function openPackBrowser(
	overrides: {
		client?: LibraryClient;
		previewEngine?: ReturnType<typeof fakePreviewEngine>;
		analytics?: Analytics;
		addedPackIds?: readonly string[];
		onAddPack?: (pack: { id: string }) => void;
		onInsert?: (asset: unknown) => void;
	} = {},
) {
	const previewEngine = overrides.previewEngine ?? fakePreviewEngine();
	const onAddPack = overrides.onAddPack ?? vi.fn();
	// The editor owns the project's pack list and feeds it back in; mirror that
	// here so "added" is the state the user would actually see afterwards.
	const [addedPackIds, setAddedPackIds] = createSignal<readonly string[]>(
		overrides.addedPackIds ?? [FIRST_PACK.id],
	);
	render(() => (
		<LibraryBrowser
			client={overrides.client ?? new LibraryClient(fixtureFetcher())}
			previewEngine={previewEngine}
			analytics={overrides.analytics}
			addedPackIds={addedPackIds()}
			onAddPack={(pack) => {
				onAddPack(pack);
				setAddedPackIds((previous) => [...previous, pack.id]);
			}}
			onInsert={overrides.onInsert}
		/>
	));
	fireEvent.click(await screen.findByRole("button", { name: /Browse packs/ }));
	const dialog = await screen.findByRole("dialog");
	// Wait for the index, so a query made before the packs render is not asserted
	// against an empty list that would satisfy it vacuously.
	await within(dialog).findByRole("button", {
		name: new RegExp(FIRST_PACK.name),
	});
	return { dialog, previewEngine, onAddPack };
}

describe("browsing packs", () => {
	it("lists every pack with what it is and who made it", async () => {
		const { dialog } = await openPackBrowser();
		const list = within(dialog).getByRole("navigation", { name: "Packs" });
		for (const pack of PACKS) {
			expect(
				within(list).getByRole("button", { name: new RegExp(pack.name) }),
			).toBeInTheDocument();
		}
		// Plus the cross-pack way in.
		expect(
			within(list).getByRole("button", { name: /All sounds/ }),
		).toBeInTheDocument();
	});

	it("searches packs by name without fetching their manifests", async () => {
		const paths: string[] = [];
		const client = new LibraryClient(async (path) => {
			paths.push(path);
			return fixtureFetcher()(path);
		});
		const { dialog } = await openPackBrowser({ client });
		const before = paths.length;
		fireEvent.input(
			within(dialog).getByRole("searchbox", { name: "Search packs" }),
			{ target: { value: SECOND_PACK.name } },
		);
		await waitFor(() =>
			expect(
				within(dialog).queryByRole("button", {
					name: new RegExp(PACKS[2].name),
				}),
			).toBeNull(),
		);
		expect(
			within(dialog).getByRole("button", {
				name: new RegExp(SECOND_PACK.name),
			}),
		).toBeInTheDocument();
		// Searching read the index, nothing more (sample-library section 12).
		expect(paths.length).toBe(before);
	});

	it("says so when no pack matches", async () => {
		const { dialog } = await openPackBrowser();
		fireEvent.input(
			within(dialog).getByRole("searchbox", { name: "Search packs" }),
			{ target: { value: "zzzzz-no-such-pack" } },
		);
		expect(
			await within(dialog).findByText(/No packs match/),
		).toBeInTheDocument();
	});
});

describe("the pack detail view", () => {
	it("shows the pack's own description and contents", async () => {
		const { dialog } = await openPackBrowser();
		fireEvent.click(
			within(dialog).getByRole("button", {
				name: new RegExp(SECOND_PACK.name),
			}),
		);
		const detail = within(dialog).getByRole("region", { name: "Pack" });
		expect(
			await within(detail).findByRole("heading", { name: SECOND_PACK.name }),
		).toBeInTheDocument();
		expect(
			within(detail).getByText(new RegExp(SECOND_PACK.publisher)),
		).toBeInTheDocument();
		expect(
			within(detail).getByText(SECOND_PACK.description),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(
				within(dialog).getAllByRole("button", { name: /^Audition / }).length,
			).toBeGreaterThan(0),
		);
	});

	it("auditions a sound from the pack detail", async () => {
		const { dialog, previewEngine } = await openPackBrowser();
		const audition = await waitFor(
			() => within(dialog).getAllByRole("button", { name: /^Audition / })[0],
		);
		fireEvent.click(audition);
		await waitFor(() => expect(previewEngine.starts.length).toBe(1));
	});

	it("offers no drag, because its own dialog covers every drop target", async () => {
		const { dialog } = await openPackBrowser({ onInsert: vi.fn() });
		const rows = await waitFor(() => {
			const found = within(dialog)
				.getAllByRole("button", { name: /^Audition / })
				.map((button) => button.closest("li"));
			expect(found.length).toBeGreaterThan(0);
			return found;
		});
		// The instrument a sound would be dropped on is behind this modal, so a
		// row here can start a drag that nothing can ever receive: no drop target
		// lights up and the release does nothing. "Insert" is the way in from the
		// browser; dragging belongs to the panel, where the editor is visible.
		for (const row of rows) {
			expect(row).not.toHaveAttribute("draggable", "true");
		}
		expect(
			within(dialog).getAllByRole("button", { name: /^Insert / }).length,
		).toBeGreaterThan(0);
	});

	it("offers Add pack to project, and says so once the project has it", async () => {
		const { analytics: a, transport } = analytics();
		const { dialog, onAddPack } = await openPackBrowser({
			analytics: a,
			addedPackIds: [FIRST_PACK.id],
		});
		fireEvent.click(
			within(dialog).getByRole("button", {
				name: new RegExp(SECOND_PACK.name),
			}),
		);
		const add = await within(dialog).findByRole("button", {
			name: "Add pack to project",
		});
		fireEvent.click(add);
		await waitFor(() => expect(onAddPack).toHaveBeenCalledTimes(1));
		expect(transport.named("library_pack_added")).toHaveLength(1);
		// The panel behind now lists the added pack, and the CTA reflects it.
		await waitFor(() =>
			expect(
				within(dialog).getByRole("button", { name: /In this project/ }),
			).toBeDisabled(),
		);
	});

	it("shows a pack the project already has as added, not addable again", async () => {
		const { dialog } = await openPackBrowser({
			addedPackIds: [FIRST_PACK.id],
		});
		// The modal opens on the first pack, which this project already has.
		expect(
			await within(dialog).findByRole("button", { name: /In this project/ }),
		).toBeDisabled();
	});
});

describe("the cross-pack view (LIB-02)", () => {
	it("searches and filters across every loaded pack, and clearing re-exposes", async () => {
		const { dialog } = await openPackBrowser();
		fireEvent.click(within(dialog).getByRole("button", { name: /All sounds/ }));
		// The union spans more than one pack, so it is strictly larger than the
		// pack the modal opened on.
		await waitFor(() =>
			expect(
				within(dialog).getAllByRole("button", { name: /^Audition / }).length,
			).toBeGreaterThan(FIRST_PACK.assetCount),
		);
		const total = within(dialog).getAllByRole("button", {
			name: /^Audition /,
		}).length;

		fireEvent.input(
			within(dialog).getByRole("searchbox", { name: "Search sounds" }),
			{ target: { value: "kick" } },
		);
		await waitFor(() =>
			expect(
				within(dialog).getAllByRole("button", { name: /^Audition / }).length,
			).toBeLessThan(total),
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Clear filters" }),
		);
		await waitFor(() =>
			expect(
				within(dialog).getAllByRole("button", { name: /^Audition / }).length,
			).toBe(total),
		);
	});

	it("names an unavailable pack while the rest stay browsable", async () => {
		const client = new LibraryClient(async (path) => {
			if (path.includes(`/${SECOND_PACK.slug}/`)) {
				throw new FetchClassifiedError("network", "offline");
			}
			return fixtureFetcher()(path);
		});
		const { dialog } = await openPackBrowser({ client });
		fireEvent.click(within(dialog).getByRole("button", { name: /All sounds/ }));
		await waitFor(() =>
			expect(within(dialog).getByText(/is unavailable/)).toBeInTheDocument(),
		);
		expect(
			within(dialog).getByText(/Other packs still work/),
		).toBeInTheDocument();
		expect(
			within(dialog).getAllByRole("button", { name: /^Audition / }).length,
		).toBeGreaterThan(0);
	});
});

describe("dismissal", () => {
	it("closes on Escape through the shortcut registry", async () => {
		await openPackBrowser();
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("closes on a click outside the dialog", async () => {
		await openPackBrowser();
		fireEvent.click(screen.getByRole("button", { name: "Close pack browser" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("stops audition when it closes", async () => {
		const { dialog, previewEngine } = await openPackBrowser();
		const audition = await waitFor(
			() => within(dialog).getAllByRole("button", { name: /^Audition / })[0],
		);
		fireEvent.click(audition);
		await waitFor(() => expect(previewEngine.starts.length).toBe(1));
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() =>
			expect(previewEngine.starts[0].stop).toHaveBeenCalled(),
		);
	});
});

describe("analytics", () => {
	it("emits the pack_browser feature_first_use key once", async () => {
		const { analytics: a, transport } = analytics();
		await openPackBrowser({ analytics: a });
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: /Browse packs/ }));
		await screen.findByRole("dialog");
		const firstUse = transport
			.named("feature_first_use")
			.filter((event) => event.params.feature === "pack_browser");
		expect(firstUse).toHaveLength(1);
	});
});
