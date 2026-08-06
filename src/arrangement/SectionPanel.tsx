import { createSignal, For, Show } from "solid-js";
import type { Section } from "../domain/entities";
import type { SectionId } from "../domain/ids";
import { TICKS_PER_BAR } from "../domain/time";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import "./SectionPanel.css";

/**
 * The section panel (`ARR-003`; PRD ARR-02).
 *
 * Real DOM rather than canvas, deliberately: a section's name is text the user
 * typed and its order is a list, and both must be readable, focusable and
 * editable by assistive tech. The canvas ruler already *draws* section labels
 * (ARR-001); this is where they are *edited*, so canvas pixels are never the
 * sole representation of the song's structure. Reorder is two buttons rather
 * than a drag for the same reason — a drag is not keyboard-reachable, and
 * ARR-02's requirement is the *effect* (contained clips move with it), not the
 * gesture. ARR-03's outline affordance is a separate component rendered as this
 * one's child.
 *
 * It owns no state beyond the transient text of the row being renamed; every
 * action calls a handler that dispatches a command, and the panel never mutates
 * a project and never logs analytics. Section names are user content, so every
 * element rendering one carries `MASK_CONTENT`: the row stays visible in a
 * replay so a reviewer sees which section was edited (ADR 0002 decision 2), but
 * the name itself does not reach the payload.
 */

export interface SectionPanelProps {
	readonly sections: readonly Section[];
	readonly onAdd: () => void;
	readonly onRename: (sectionId: SectionId, name: string) => void;
	readonly onResize: (sectionId: SectionId, bars: number) => void;
	readonly onRecolor: (sectionId: SectionId, color: string) => void;
	readonly onReorder: (sectionId: SectionId, toIndex: number) => void;
	/** ARR-03's loop-to-song affordance, rendered under the list. */
	readonly children?: unknown;
}

const BARS = (section: Section) =>
	Math.max(1, Math.round(section.durationTicks / TICKS_PER_BAR));

export function SectionPanel(props: SectionPanelProps) {
	const [editingId, setEditingId] = createSignal<SectionId | null>(null);
	const [draftName, setDraftName] = createSignal("");

	const ordered = () =>
		[...props.sections].sort((a, b) => a.startTicks - b.startTicks);

	function commitRename(section: Section): void {
		const next = draftName().trim();
		if (next.length > 0 && next !== section.name) {
			props.onRename(section.id, next);
		}
		setEditingId(null);
	}

	return (
		<section class="section-panel" data-testid="section-panel">
			<header class="section-panel-header">
				<h2 class="section-panel-title">Sections</h2>
				<button
					type="button"
					class="arrangement-action"
					data-action="add-section"
					onClick={() => props.onAdd()}
				>
					Add section
				</button>
			</header>

			<Show
				when={ordered().length > 0}
				fallback={
					<p class="section-panel-empty">
						No sections yet. Add one, or build an outline from the loop range.
					</p>
				}
			>
				<ol class="section-panel-list" aria-label="Song sections">
					<For each={ordered()}>
						{(section, index) => (
							<li class="section-panel-row" data-section-row={section.id}>
								<span
									class="section-panel-swatch"
									style={{ background: section.color }}
									aria-hidden="true"
								/>
								<Show
									when={editingId() === section.id}
									fallback={
										<button
											type="button"
											class={`section-panel-name ${MASK_CONTENT}`}
											data-action="rename-section"
											onClick={() => {
												setDraftName(section.name);
												setEditingId(section.id);
											}}
										>
											{section.name}
										</button>
									}
								>
									<input
										class={`section-panel-name-input ${MASK_CONTENT}`}
										aria-label="Section name"
										value={draftName()}
										autofocus
										onInput={(event) => setDraftName(event.currentTarget.value)}
										onBlur={() => commitRename(section)}
										onKeyDown={(event) => {
											if (event.key === "Enter") commitRename(section);
											if (event.key === "Escape") setEditingId(null);
										}}
									/>
								</Show>

								<label class="section-panel-bars">
									<span class="visually-hidden">Length in bars</span>
									<input
										type="number"
										min="1"
										value={BARS(section)}
										data-action="resize-section"
										onChange={(event) =>
											props.onResize(
												section.id,
												Number(event.currentTarget.value),
											)
										}
									/>
									<span aria-hidden="true">bars</span>
								</label>

								<label class="section-panel-color">
									<span class="visually-hidden">Section color</span>
									<input
										type="color"
										value={section.color}
										data-action="recolor-section"
										onChange={(event) =>
											props.onRecolor(section.id, event.currentTarget.value)
										}
									/>
								</label>

								<button
									type="button"
									class="arrangement-action"
									data-action="move-section-earlier"
									disabled={index() === 0}
									aria-label="Move section earlier"
									onClick={() => props.onReorder(section.id, index() - 1)}
								>
									↑
								</button>
								<button
									type="button"
									class="arrangement-action"
									data-action="move-section-later"
									disabled={index() === ordered().length - 1}
									aria-label="Move section later"
									onClick={() => props.onReorder(section.id, index() + 1)}
								>
									↓
								</button>
							</li>
						)}
					</For>
				</ol>
			</Show>
			{props.children as never}
		</section>
	);
}
