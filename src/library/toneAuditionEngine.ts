import * as Tone from "tone";
import type { AudioHost, AudioProjectScope } from "../audio/AudioRuntime";
import {
	AuditionError,
	type PreviewEngine,
	type PreviewStartOptions,
	type PreviewVoice,
} from "./audition";
import type { LibraryAsset } from "./manifest";

/**
 * The Tone-backed {@link PreviewEngine} the browser uses in production.
 *
 * It plays a preview through the runtime's **shared destination** — the same
 * output the project plays through — so audition is heard exactly like the
 * project and is provably not part of any export/offline render (LIB-01:
 * "Audition ... does not become part of export"). Every node it builds is
 * registered with its own runtime project scope (`library-audition`), so
 * disposing the engine tears down its scope idempotently without touching the
 * project graph or the shared context (PRD AUD-07/AUD-09).
 *
 * The only place in the browser that touches Tone: like `toneBufferLoader.ts`,
 * it keeps the audition *policy* (`AuditionController`) Web-Audio-free and
 * testable, and confines the Web Audio calls to this one file.
 */
export class ToneAuditionEngine implements PreviewEngine {
	private readonly scope: AudioProjectScope;
	private disposed = false;

	constructor(private readonly runtime: AudioHost) {
		this.scope = runtime.openProjectScope("library-audition");
	}

	async start(
		asset: LibraryAsset,
		options: PreviewStartOptions,
	): Promise<PreviewVoice> {
		if (this.disposed) {
			throw new AuditionError("asset_missing", "Audition engine is disposed");
		}
		if (!asset.url) {
			throw new AuditionError(
				"asset_missing",
				`Asset "${asset.id}" has no audio`,
			);
		}

		const player = await this.load(asset.url);
		if (this.disposed) {
			player.dispose();
			throw new AuditionError("asset_missing", "Audition engine is disposed");
		}

		player.connect(this.runtime.getDestination());
		const handle = this.scope.register("node", () => {
			player.dispose();
		});

		let stopped = false;
		const voice: PreviewVoice = {
			stop: () => {
				if (stopped) return;
				stopped = true;
				try {
					player.stop();
				} catch {
					// A player that never started (e.g. a synced start that has not
					// fired yet) throws on stop; releasing the scope handle disposes it.
				}
				void this.scope.release(handle);
			},
		};

		// Sync where appropriate (LIB-01): a loop drops in on the next beat so it
		// sits with a running project; a one-shot fires immediately, which is what
		// a producer expects when they click a hit.
		if (options.sync) {
			player.sync().start(quantizedStart());
		} else {
			player.start();
		}
		return voice;
	}

	private async load(url: string): Promise<Tone.Player> {
		try {
			return await new Promise<Tone.Player>((resolve, reject) => {
				const player = new Tone.Player({
					url,
					onload: () => resolve(player),
					onerror: (error) =>
						reject(
							new AuditionError(
								"decode_failed",
								error instanceof Error ? error.message : "Decode failed",
							),
						),
				});
			});
		} catch (error) {
			if (error instanceof AuditionError) throw error;
			throw new AuditionError(
				"network",
				error instanceof Error ? error.message : "Failed to load asset",
			);
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.scope.dispose();
	}
}

/**
 * The next musical grid point to drop a synced loop in on. Quantizing to the
 * next bar keeps a loop preview phase-aligned with a running transport rather
 * than starting mid-beat.
 */
function quantizedStart(): string {
	return "@1m";
}
