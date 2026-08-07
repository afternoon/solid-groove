import { describe, expect, it } from "vitest";
import { fixtureFetcher } from "./__fixtures__/fixtures";
import {
	hasLibrarySampleDrag,
	LIBRARY_SAMPLE_MIME,
	type LibraryDragTransfer,
	readLibrarySampleDrag,
	writeLibrarySampleDrag,
} from "./assetDrag";
import { packAssets, parsePackManifest } from "./manifest";

/**
 * The drag a library sound travels on (#225). jsdom implements no
 * `DataTransfer`, and neither does a headless worker, so this exercises the
 * structural slice the app actually uses.
 */

function fakeTransfer(): LibraryDragTransfer & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		get types() {
			return [...data.keys()];
		},
		getData: (format: string) => data.get(format) ?? "",
		setData: (format: string, value: string) => {
			data.set(format, value);
		},
	};
}

async function libraryAssets(slug = "core-electronic-drums") {
	const raw = await fixtureFetcher()(
		`samples/starter-library/packs/${slug}/x.json`,
	);
	return packAssets(parsePackManifest(raw));
}

describe("carrying a library sound on a drag", () => {
	it("round-trips a browsed sound through the transfer", async () => {
		const asset = (await libraryAssets())[0];
		const transfer = fakeTransfer();

		expect(writeLibrarySampleDrag(transfer, asset)).toBe(true);
		expect(transfer.effectAllowed).toBe("copy");
		expect(hasLibrarySampleDrag(transfer)).toBe(true);

		const sample = readLibrarySampleDrag(transfer);
		expect(sample?.name).toBe(asset.name);
		expect(sample?.packId).toBe(asset.packId);
		expect(sample?.url).toBe(asset.url);
	});

	it("refuses to carry a sound with no master audio", async () => {
		const asset = {
			...(await libraryAssets())[0],
			storageKey: null,
			url: null,
		};
		const transfer = fakeTransfer();
		expect(writeLibrarySampleDrag(transfer, asset)).toBe(false);
		expect(hasLibrarySampleDrag(transfer)).toBe(false);
	});

	it("sees no sound in a drag carrying something else", () => {
		const transfer = fakeTransfer();
		transfer.setData("text/plain", "just some text");
		expect(hasLibrarySampleDrag(transfer)).toBe(false);
		expect(readLibrarySampleDrag(transfer)).toBeNull();
	});

	it("ignores a payload another page wrote under our type", () => {
		// Any page can `setData` an arbitrary MIME type, so what comes back is
		// input: a shape that is not a library sound reads as no sound at all.
		const transfer = fakeTransfer();
		transfer.setData(LIBRARY_SAMPLE_MIME, '{"name":"Nice try","url":"//evil"}');
		expect(readLibrarySampleDrag(transfer)).toBeNull();

		transfer.setData(LIBRARY_SAMPLE_MIME, "not json at all");
		expect(readLibrarySampleDrag(transfer)).toBeNull();
	});

	it("answers for a transfer that is not there at all", () => {
		expect(hasLibrarySampleDrag(null)).toBe(false);
		expect(readLibrarySampleDrag(null)).toBeNull();
	});
});
