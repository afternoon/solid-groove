import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import {
	createRecordingTransport,
	type RecordingTransport,
} from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { fakePreviewEngine } from "./__fixtures__/fakePreviewEngine";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import { LibraryClient } from "./libraryClient";
import { PACK_INDEX_PATH } from "./manifest";
import {
	type LibraryBrowserControls,
	useLibraryBrowser,
} from "./useLibraryBrowser";

function analytics(): { analytics: Analytics; transport: RecordingTransport } {
	const transport = createRecordingTransport();
	const instance = new Analytics({
		transport,
		consent: new ConsentStore(memoryStorage()),
		storage: memoryStorage(),
	});
	instance.setAccountType("anonymous");
	return { analytics: instance, transport };
}

/** Run `body` inside a disposable reactive root, awaiting its promise. */
async function withBrowser(
	setup: {
		client?: LibraryClient;
		previewEngine?: ReturnType<typeof fakePreviewEngine>;
		analytics?: Analytics;
	},
	body: (browser: LibraryBrowserControls) => Promise<void>,
): Promise<void> {
	let dispose = () => {};
	const browser = createRoot((d) => {
		dispose = d;
		return useLibraryBrowser({
			client: setup.client ?? new LibraryClient(fixtureFetcher()),
			previewEngine: setup.previewEngine ?? fakePreviewEngine(),
			analytics: setup.analytics,
		});
	});
	try {
		await body(browser);
	} finally {
		dispose();
	}
}

describe("opening the browser", () => {
	it("fetches the index first, then only the opened pack — never every pack's metadata", async () => {
		const calls: string[] = [];
		const client = new LibraryClient(async (path) => {
			calls.push(path);
			return fixtureFetcher()(path);
		});
		await withBrowser({ client }, async (browser) => {
			await browser.open();
			expect(browser.packs().length).toBeGreaterThan(1);
			// The index came first.
			expect(calls[0]).toBe(PACK_INDEX_PATH);
			// Exactly one pack manifest was fetched — the first pack it opened into,
			// not one per pack (sample-library section 12).
			const manifestCalls = calls.filter((path) => path !== PACK_INDEX_PATH);
			expect(manifestCalls).toHaveLength(1);
			expect(manifestCalls[0]).toContain(browser.packs()[0].slug);
		});
	});

	it("emits the library_browser feature_first_use key exactly once", async () => {
		const { analytics: a, transport } = analytics();
		await withBrowser({ analytics: a }, async (browser) => {
			await browser.open();
		});
		// A second browser in the same session must not re-fire it.
		await withBrowser({ analytics: a }, async () => {});
		const firstUse = transport
			.named("feature_first_use")
			.filter((event) => event.params.feature === "library_browser");
		expect(firstUse).toHaveLength(1);
	});
});

describe("selecting a pack", () => {
	it("loads one pack's assets on open", async () => {
		await withBrowser({}, async (browser) => {
			await browser.open();
			const slug = browser.packs()[0].slug;
			await browser.selectPack(slug);
			expect(browser.assets().length).toBeGreaterThan(0);
			expect(browser.assets().every((a) => a.packSlug === slug)).toBe(true);
		});
	});

	it("shows a cross-pack union under All packs", async () => {
		await withBrowser({}, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			const packs = new Set(browser.assets().map((a) => a.packSlug));
			expect(packs.size).toBeGreaterThan(1);
		});
	});

	it("clearing filters keeps the selected pack", async () => {
		await withBrowser({}, async (browser) => {
			await browser.open();
			const slug = browser.packs()[0].slug;
			await browser.selectPack(slug);
			const genre = browser.facets().genres[0];
			browser.toggleGenre(genre);
			browser.clearFilters();
			expect(browser.selectedPackSlug()).toBe(slug);
			expect(browser.filter().genres).toEqual([]);
		});
	});
});

describe("audition analytics (PRD OPS-02 / LOOP-013)", () => {
	it("emits library_audition exactly once per audition, with pack slug and genre flag", async () => {
		const { analytics: a, transport } = analytics();
		await withBrowser({ analytics: a }, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			const asset = browser.assets().find((x) => x.type === "one-shot");
			if (!asset) throw new Error("expected a one-shot fixture asset");
			await browser.audition(asset);
			const events = transport.named("library_audition");
			expect(events).toHaveLength(1);
			expect(events[0].params.pack_id).toBe(asset.packSlug);
			expect(events[0].params.had_genre_filter).toBe(false);
			expect(events[0].params.asset_type).toBe("one_shot");
		});
	});

	it("reports had_genre_filter when a genre facet is active", async () => {
		const { analytics: a, transport } = analytics();
		await withBrowser({ analytics: a }, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			const asset = browser.assets()[0];
			browser.toggleGenre(asset.genres[0]);
			await browser.audition(asset);
			expect(
				transport.named("library_audition")[0].params.had_genre_filter,
			).toBe(true);
		});
	});

	it("never logs a pack display name", async () => {
		const { analytics: a, transport } = analytics();
		await withBrowser({ analytics: a }, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			const asset = browser.assets()[0];
			await browser.audition(asset);
			const serialized = JSON.stringify(transport.events);
			expect(serialized).not.toContain(asset.packName);
		});
	});

	it("emits asset_load_failed exactly once when a preview cannot load", async () => {
		const { analytics: a, transport } = analytics();
		const engine = fakePreviewEngine();
		await withBrowser(
			{ analytics: a, previewEngine: engine },
			async (browser) => {
				await browser.open();
				await browser.selectPack(null);
				const asset = browser.assets()[0];
				engine.failNextWith("decode_failed");
				await browser.audition(asset);
				const failed = transport.named("asset_load_failed");
				expect(failed).toHaveLength(1);
				expect(failed[0].params.error_code).toBe("decode_failed");
				expect(browser.assetErrors().get(asset.id)).toBe("decode_failed");
			},
		);
	});
});

describe("audition lifecycle", () => {
	it("stops the current preview when a new asset is auditioned", async () => {
		const engine = fakePreviewEngine();
		await withBrowser({ previewEngine: engine }, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			const [a, b] = browser.assets();
			await browser.audition(a);
			await browser.audition(b);
			expect(engine.starts[0].stop).toHaveBeenCalledTimes(1);
			expect(browser.auditioningId()).toBe(b.id);
		});
	});

	it("disposes audition when the reactive root is torn down", async () => {
		const engine = fakePreviewEngine();
		let captured!: LibraryBrowserControls;
		await withBrowser({ previewEngine: engine }, async (browser) => {
			captured = browser;
			await browser.open();
			await browser.selectPack(null);
			await browser.audition(browser.assets()[0]);
		});
		// The root disposed at the end of withBrowser; the engine is torn down.
		expect(engine.disposed()).toBe(true);
		expect(captured.auditioningId()).toBeNull();
	});
});

describe("pack failure isolation", () => {
	it("records a pack error and keeps other packs' assets", async () => {
		let firstManifest = true;
		const client = new LibraryClient(async (path) => {
			if (path === PACK_INDEX_PATH) return fixtureFetcher()(path);
			if (firstManifest) {
				firstManifest = false;
				throw new Error("boom");
			}
			return fixtureFetcher()(path);
		});
		await withBrowser({ client }, async (browser) => {
			await browser.open();
			await browser.selectPack(null);
			expect(browser.packErrors().length).toBe(1);
			// The remaining packs still contributed assets.
			expect(browser.assets().length).toBeGreaterThan(0);
		});
	});
});
