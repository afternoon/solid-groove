import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { noteEventsOf } from "../commands";
import type { NoteEvent } from "../domain/entities";
import { createPianoRollFixtureProject } from "../domain/fixtures";
import type { EventId } from "../domain/ids";
import { createInMemoryProjectRepository } from "../persistence/inMemoryProjectRepository";
import { createManualClock } from "../shared/clock";
import { memoryStorage } from "../testing/storage";
import { EditorSession } from "./EditorSession";
import TransformPanel from "./TransformPanel";

/**
 * Shared harness for the `TransformPanel` suites (test-only): a real
 * `EditorSession` over an in-memory repository, so a transformation goes
 * through the actual command layer, transaction, and undo history rather than
 * a stub, and one recording transport shared by the session and the panel, so
 * a test can assert the whole event stream a user action produced.
 */
export async function setUpTransformPanel(
	options: { analyticsEnabled?: boolean } = {},
) {
	const repository = createInMemoryProjectRepository();
	const project = createPianoRollFixtureProject();
	const created = await repository.createProject(project);
	if (!created.ok) throw new Error("fixture failed to create");

	const transport = createRecordingTransport();
	const consent = new ConsentStore(memoryStorage());
	if (options.analyticsEnabled === false) consent.optOut();

	const session = new EditorSession({
		repository,
		project,
		clock: createManualClock(1_000),
		analytics: new Analytics({ transport, consent, storage: memoryStorage() }),
		deviceStorage: memoryStorage(),
	});

	const panelAnalytics = new Analytics({
		transport,
		consent,
		storage: memoryStorage(),
	});
	panelAnalytics.setAccountType("anonymous");

	function renderPanel(selectedIds: readonly EventId[] = []) {
		return render(() => (
			<TransformPanel
				clip={session.project.clips[0]}
				project={session.project}
				selectedIds={selectedIds}
				dispatch={session.dispatch.bind(session)}
				editor="piano_roll"
				analytics={panelAnalytics}
			/>
		));
	}

	return { repository, session, transport, renderPanel };
}

export function currentNotes(session: EditorSession): readonly NoteEvent[] {
	return noteEventsOf(session.project.clips[0]) ?? [];
}

export function pitchOf(event: NoteEvent): number {
	return event.trigger.kind === "pitch" ? event.trigger.pitch : -1;
}

export function pitches(session: EditorSession): number[] {
	return currentNotes(session)
		.map(pitchOf)
		.sort((a, b) => a - b);
}

/** Clicks the panel button whose visible label is `label`. */
export function clickTransform(label: string): void {
	const button = screen
		.getAllByRole("button")
		.find((candidate) => candidate.textContent === label);
	if (!button) throw new Error(`no ${label} button`);
	fireEvent.click(button);
}

/** Types into one of the panel's labelled option inputs. */
export function setOption(label: string, value: string): void {
	fireEvent.input(screen.getByLabelText(label, { exact: false }), {
		target: { value },
	});
}
