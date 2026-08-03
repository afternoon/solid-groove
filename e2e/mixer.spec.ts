import { expect, test } from "@playwright/test";

// `LOOP-007`: the mixer's continuous controls are the shared fill slider
// (`src/instrument/FillSlider.tsx`, design mock `06c-slider`) — a real range
// input rotated to sit under a thumbless fill track. That rotation is pure
// layout, so jsdom cannot see it: a component test passes just as happily
// when the input lands beside the fill a user is aiming at instead of over
// it, leaving a fader that reads correctly, answers the keyboard, and cannot
// be dragged. Only a real browser catches that, so it is asserted here.
test.describe("mixer", () => {
	test("the volume fader is draggable where it is painted", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		const fader = page.getByRole("slider", { name: /^Volume for / });
		await expect(fader).toBeVisible();

		// The input's hit area is the fill the user sees, not merely somewhere on
		// the page: same box, within a pixel of rounding.
		const track = page.locator(".mixer-strip-controls .fill-slider-track", {
			has: fader,
		});
		const inputBox = await fader.boundingBox();
		const trackBox = await track.boundingBox();
		expect(inputBox).not.toBeNull();
		expect(trackBox).not.toBeNull();
		if (!inputBox || !trackBox) return;
		expect(Math.abs(inputBox.x - trackBox.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.y - trackBox.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.width - trackBox.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.height - trackBox.height)).toBeLessThanOrEqual(1);

		// Dragging down turns the track down, and the readout follows.
		const before = Number(await fader.inputValue());
		await page.mouse.move(
			trackBox.x + trackBox.width / 2,
			trackBox.y + trackBox.height * 0.3,
		);
		await page.mouse.down();
		await page.mouse.move(
			trackBox.x + trackBox.width / 2,
			trackBox.y + trackBox.height * 0.8,
			{ steps: 8 },
		);
		await page.mouse.up();

		expect(Number(await fader.inputValue())).toBeLessThan(before);
		await expect(fader).not.toHaveAttribute("aria-valuetext", "0.0 dB");
	});
});
