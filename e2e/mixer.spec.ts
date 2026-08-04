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

		// Sitting over the fill, the input has to stay invisible in every state —
		// including hover, where the app-wide `input:hover` tint would otherwise
		// win on specificity and paint over the fill the user is aiming at.
		await fader.hover();
		expect(
			await fader.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			),
		).toBe("rgba(0, 0, 0, 0)");

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

	// Pan is the same slider laid on its side, so it takes no rotation at all —
	// which is exactly the sort of thing a shared component regresses silently.
	// Dragging right has to pan right, and the strip's fixed width has to hold.
	test("pan drags left-to-right and never widens the strip", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		const pan = page.getByRole("slider", { name: /^Pan for / });
		await expect(pan).toBeVisible();
		await expect(pan).toHaveAttribute("aria-valuetext", "C");

		const track = page.locator(".mixer-strip-pan .fill-slider-track", {
			has: pan,
		});
		const inputBox = await pan.boundingBox();
		const trackBox = await track.boundingBox();
		expect(inputBox).not.toBeNull();
		expect(trackBox).not.toBeNull();
		if (!inputBox || !trackBox) return;
		expect(inputBox.width).toBeGreaterThan(inputBox.height);
		expect(Math.abs(inputBox.x - trackBox.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.y - trackBox.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.width - trackBox.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(inputBox.height - trackBox.height)).toBeLessThanOrEqual(1);

		// Right of centre pans right, and reads as a right-hand value.
		await page.mouse.click(
			trackBox.x + trackBox.width * 0.85,
			trackBox.y + trackBox.height / 2,
		);
		expect(Number(await pan.inputValue())).toBeGreaterThan(0);
		await expect(pan).toHaveAttribute("aria-valuetext", /^R\d+$/);

		// ...and the strip is the same width it was before anything was panned.
		const strip = page.locator(".mixer-strip").first();
		const stripBox = await strip.boundingBox();
		expect(stripBox?.width).toBe(96);
	});

	// A pointer left resting on a button it just pressed is the normal case, not
	// an edge one — and the cascade is where that goes wrong: `:hover` is three
	// simple selectors against `.active`'s two. jsdom applies no stylesheet, so
	// only a real browser can say what the user is actually looking at.
	test("a soloed track stays soloed under the pointer", async ({ page }) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		const solo = page.getByRole("button", { name: /^Solo / }).first();
		// Compared as brightness rather than an exact colour: the buttons carry a
		// colour transition, so an exact match would be asserting on whichever
		// frame the read landed in. Soloed is the bright fill; off is dark chrome.
		const brightness = async (): Promise<number> => {
			const color = await solo.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			const channels = (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
			return channels.reduce((sum, channel) => sum + channel, 0) / 3;
		};

		expect(await brightness()).toBeLessThan(150);
		await solo.click();
		await expect(solo).toHaveAttribute("aria-pressed", "true");

		// With the pointer taken away, this is what "soloed" looks like.
		await page.mouse.move(0, 0);
		await expect.poll(brightness).toBeGreaterThan(200);

		// Putting the pointer back must not repaint it as an unsoloed button: a
		// pointer resting on the button it just pressed is the normal case. Read
		// once the transition has run, not on the frame the pointer arrived —
		// mid-transition the button is still wearing the colour it is leaving.
		await solo.hover();
		await page.waitForTimeout(600);
		expect(await brightness()).toBeGreaterThan(200);
	});
});
