/**
 * The catalog of samples bundled with the app (served from `public/samples`).
 * Used by the SampleChooser so the user can only pick URLs that actually
 * resolve — a stored `sampleUrl` outside this list is likely outdated.
 */
export interface SampleLibraryEntry {
	name: string;
	url: string;
}

export const sampleLibrary: SampleLibraryEntry[] = [
	{ name: "909 Bass Drum", url: "/samples/house/drums/bd/909-bd.wav" },
	{ name: "909 Open Hat", url: "/samples/house/drums/bd/909-oh.wav" },
];

/** Human-readable name for a sample URL, or the URL itself if not in the library. */
export function sampleName(url: string): string {
	return sampleLibrary.find((s) => s.url === url)?.name ?? url;
}

/** Whether a sample URL corresponds to a bundled sample. */
export function isKnownSample(url: string): boolean {
	return sampleLibrary.some((s) => s.url === url);
}
