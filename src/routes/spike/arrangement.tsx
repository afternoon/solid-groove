import { useSearchParams } from "@solidjs/router";
import { createMemo } from "solid-js";
import ArrangementSpike from "../../arrangement/spike/ArrangementSpike";
import {
	ARRANGEMENT_SPIKE_TRACK_COUNTS,
	type ArrangementSpikeTrackCount,
	createArrangementSpikeProject,
} from "../../domain/fixtures";

/**
 * The FND-008 arrangement renderer spike (task; PRD 9.3). Disposable
 * exploratory UI — see `src/arrangement/spike/README.md` — reachable at
 * `/spike/arrangement?tracks=20|40|50` for manual poking and for the
 * Playwright measurement harness (`perf/arrangement.bench.spec.ts`) to drive.
 * Not linked from any navigation; there is no product reason for an alpha
 * user to find it.
 */
export default function ArrangementSpikePage() {
	const [searchParams] = useSearchParams();

	const trackCount = createMemo<ArrangementSpikeTrackCount>(() => {
		const requested = Number(searchParams.tracks);
		return ARRANGEMENT_SPIKE_TRACK_COUNTS.includes(
			requested as ArrangementSpikeTrackCount,
		)
			? (requested as ArrangementSpikeTrackCount)
			: 50;
	});

	const project = createMemo(() => createArrangementSpikeProject(trackCount()));

	return (
		<main style={{ height: "100vh", width: "100vw" }}>
			<ArrangementSpike project={project()} />
		</main>
	);
}
