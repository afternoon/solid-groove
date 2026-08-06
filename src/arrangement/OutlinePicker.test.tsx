/**
 * ARR-03's loop-to-song affordance (PRD ARR-03, CLP-01).
 *
 * The property under test is the one CLP-01 names: the UI states which of the
 * two copy operations will run *before* it runs, and the sentence it shows is
 * generated from the same module that performs the operation.
 */

import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { describeOutline } from "./arrangementOutline";
import { OutlinePicker, type OutlinePickerProps } from "./OutlinePicker";
import { OUTLINE_TEMPLATES } from "./outlineTemplates";

function setup(overrides: Partial<OutlinePickerProps> = {}) {
	const onCreate = vi.fn();
	const view = render(() => (
		<OutlinePicker onCreate={onCreate} hasLoopRange {...overrides} />
	));
	const action = (name: string) =>
		view.container.querySelector(`[data-action="${name}"]`) as HTMLElement;
	return {
		onCreate,
		action,
		text: () => view.container.textContent ?? "",
		description: () =>
			(
				view.container.querySelector(
					'[data-testid="outline-mode-description"]',
				) as HTMLElement
			).textContent,
	};
}

describe("OutlinePicker", () => {
	it("offers every registered template, with its description", () => {
		const h = setup();
		const options = [
			...(h.action("outline-template") as HTMLSelectElement).options,
		];
		expect(options.map((option) => option.value)).toEqual(
			OUTLINE_TEMPLATES.map((template) => template.id),
		);
		// The first template's description is shown before anything is chosen.
		expect(h.text()).toContain(OUTLINE_TEMPLATES[0].description);
	});

	it("states which copy operation will run, from the module that performs it", () => {
		const h = setup();
		expect(h.description()).toBe(describeOutline("linked"));

		fireEvent.change(h.action("outline-mode"), {
			target: { value: "independent" },
		});
		expect(h.description()).toBe(describeOutline("independent"));
	});

	it("passes the chosen template and mode to the handler", () => {
		const h = setup();
		fireEvent.change(h.action("outline-template"), {
			target: { value: "aaba" },
		});
		fireEvent.change(h.action("outline-mode"), {
			target: { value: "independent" },
		});
		fireEvent.click(h.action("create-outline"));

		expect(h.onCreate).toHaveBeenCalledWith(
			OUTLINE_TEMPLATES.find((template) => template.id === "aaba"),
			"independent",
		);
	});

	it("disables the action and says why when no loop range is selected", () => {
		const h = setup({ hasLoopRange: false });
		expect(h.action("create-outline")).toBeDisabled();
		expect(h.text()).toMatch(/Select a loop range/i);
		fireEvent.click(h.action("create-outline"));
		expect(h.onCreate).not.toHaveBeenCalled();
	});

	it("shows the refusal message the caller reports", () => {
		const h = setup({ message: "The range has no clips in it." });
		expect(h.text()).toContain("The range has no clips in it.");
	});
});
