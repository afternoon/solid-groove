import { vi } from "vitest";
import {
	AuditionError,
	type AuditionFailureReason,
	type PreviewEngine,
	type PreviewStartOptions,
	type PreviewVoice,
} from "../audition";
import type { LibraryAsset } from "../manifest";

export interface FakePreviewEngine extends PreviewEngine {
	readonly starts: {
		asset: LibraryAsset;
		options: PreviewStartOptions;
		stop: ReturnType<typeof vi.fn>;
	}[];
	/** Make the next `start` throw the given failure. */
	failNextWith(reason: AuditionFailureReason): void;
	disposed(): boolean;
}

/** A Web-Audio-free {@link PreviewEngine} for browser and hook tests. */
export function fakePreviewEngine(): FakePreviewEngine {
	const starts: FakePreviewEngine["starts"] = [];
	let failure: AuditionFailureReason | null = null;
	let isDisposed = false;

	return {
		starts,
		failNextWith(reason) {
			failure = reason;
		},
		disposed: () => isDisposed,
		async start(asset, options): Promise<PreviewVoice> {
			if (failure) {
				const reason = failure;
				failure = null;
				throw new AuditionError(reason, `simulated ${reason}`);
			}
			const stop = vi.fn();
			starts.push({ asset, options, stop });
			return { stop };
		},
		dispose() {
			isDisposed = true;
		},
	};
}
