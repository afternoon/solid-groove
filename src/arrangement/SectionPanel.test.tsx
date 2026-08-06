/**
 * The section panel (`ARR-003`; PRD ARR-02).
 *
 * Asserted through real DOM queries, because the panel exists precisely so the
 * song's structure is not canvas-only: a keyboard or screen-reader user must be
 * able to name, resize, recolor and reorder a section without touching a canvas.
 */

import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "../domain/entities";
import type { SectionId } from "../domain/ids";
import { TICKS_PER_BAR, toTicks } from "../domain/time";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { SectionPanel, type SectionPanelProps } from "./SectionPanel";

function section(name: string, startBar: number, bars = 1): Section {
	return {
		id: `sec_${name.padEnd(21, "A")}` as SectionId,
		name,
		color: "#123456",
		startTicks: toTicks(startBar * TICKS_PER_BAR),
		durationTicks: toTicks(bars * TICKS_PER_BAR),
	};
}

function setup(overrides: Partial<SectionPanelProps> = {}) {
	const handlers = {
		onAdd: vi.fn(),
		onRename: vi.fn(),
		onResize: vi.fn(),
		onRecolor: vi.fn(),
		onReorder: vi.fn(),
	};
	const view = render(() => (
		<SectionPanel
			sections={[section("Intro", 0), section("Drop", 1)]}
			{...handlers}
			{...overrides}
		/>
	));
	// Scoped to this render's container: the suite renders several panels, and a
	// document-wide query would find the first one every time.
	const actions = (name: string) =>
		[
			...view.container.querySelectorAll(`[data-action="${name}"]`),
		] as HTMLElement[];
	return {
		...handlers,
		view,
		actions,
		action: (name: string) => actions(name)[0],
		text: (pattern: RegExp) =>
			view.container.textContent?.match(pattern) ?? null,
		nameInput: () =>
			view.container.querySelector(
				'[aria-label="Section name"]',
			) as HTMLInputElement,
	};
}

describe("empty state", () => {
	it("says there are no sections yet rather than showing a blank list", () => {
		const h = setup({ sections: [] });
		expect(h.text(/No sections yet/i)).not.toBeNull();
		expect(h.view.container.querySelector("ol")).toBeNull();
	});
});

describe("ARR-02 affordances", () => {
	it("lists sections in timeline order, whatever order they are stored in", () => {
		const h = setup({ sections: [section("Drop", 4), section("Intro", 0)] });
		expect(h.actions("rename-section").map((el) => el.textContent)).toEqual([
			"Intro",
			"Drop",
		]);
	});

	it("adds a section", () => {
		const h = setup();
		fireEvent.click(h.action("add-section"));
		expect(h.onAdd).toHaveBeenCalledTimes(1);
	});

	it("renames on Enter, abandons on Escape, and refuses a blank name", () => {
		const h = setup();
		const edit = (value: string, key: "Enter" | "Escape" | "blur") => {
			fireEvent.click(h.action("rename-section"));
			const input = h.nameInput();
			fireEvent.input(input, { target: { value } });
			if (key === "blur") fireEvent.blur(input);
			else fireEvent.keyDown(input, { key });
		};

		edit("Build", "Enter");
		expect(h.onRename).toHaveBeenCalledWith(expect.any(String), "Build");
		edit("Discarded", "Escape");
		edit("   ", "blur");
		expect(h.onRename).toHaveBeenCalledTimes(1);
	});

	it("resizes in bars and recolors", () => {
		const h = setup();
		fireEvent.change(h.action("resize-section"), { target: { value: "8" } });
		expect(h.onResize).toHaveBeenCalledWith(expect.any(String), 8);

		fireEvent.change(h.action("recolor-section"), {
			target: { value: "#ff0000" },
		});
		expect(h.onRecolor).toHaveBeenCalledWith(expect.any(String), "#ff0000");
	});

	it("reorders with keyboard-reachable buttons, disabled at the ends", () => {
		const h = setup();
		const earlier = h.actions("move-section-earlier");
		const later = h.actions("move-section-later");
		expect(earlier[0]).toBeDisabled();
		expect(later[1]).toBeDisabled();

		fireEvent.click(later[0]);
		expect(h.onReorder).toHaveBeenCalledWith(expect.any(String), 1);
		fireEvent.click(earlier[1]);
		expect(h.onReorder).toHaveBeenCalledWith(expect.any(String), 0);
	});
});

describe("replay privacy (OPS-03 / ADR 0002)", () => {
	it("masks every element that renders a section name", () => {
		const h = setup();
		for (const name of h.actions("rename-section")) {
			expect(name.className).toContain(MASK_CONTENT);
		}
		fireEvent.click(h.action("rename-section"));
		expect(h.nameInput().className).toContain(MASK_CONTENT);
	});
});
