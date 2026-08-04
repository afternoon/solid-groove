import { expect, test } from "@playwright/test";

// FND-001's isolated example for the browser E2E suite. It exercises the
// "anonymous start" journey from PRD section 14's required end-to-end test
// layer: landing page -> anonymous session -> dashboard, all against the
// in-memory mock backend (see playwright.config.ts). `LOOP-001b` replaced the
// placeholder landing page with the PRD PRJ-06 marketing front door, so these
// assert that page's honest claims and both of its entry points.
test.describe("landing page", () => {
	test("states the promise, the alpha status, and the supported browsers", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(
			page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
		).toBeVisible();
		await expect(
			page.getByText(/music studio that runs in your browser/i),
		).toBeVisible();
		await expect(page.getByText("Private alpha · browser-based")).toBeVisible();
		await expect(page.getByText(/Chrome, Edge and Firefox/)).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Start in your browser" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
	});

	// PRD section 10: "Interactive controls have accessible names, visible
	// focus". The whole page is reachable and operable from the keyboard alone.
	test("starts from the keyboard, with visible focus", async ({ page }) => {
		await page.goto("/");

		const cta = page.getByRole("button", { name: "Start in your browser" });
		// The unfocused baseline, so the assertions below cannot be satisfied by
		// a ring that was always there.
		expect(
			await cta.evaluate((element) => getComputedStyle(element).outlineStyle),
		).toBe("none");

		// Tabbed to rather than focused programmatically: `:focus-visible`, which
		// is what draws the focus ring, only applies to keyboard focus.
		for (let press = 0; press < 10; press++) {
			await page.keyboard.press("Tab");
			if (await cta.evaluate((element) => element === document.activeElement))
				break;
		}
		await expect(cta).toBeFocused();

		// Pins `.landing button:focus-visible` specifically, not merely "some ring
		// is drawn": a UA default ring, or an `outline: none` replaced by a
		// `box-shadow`, does not match the page's own accent-coloured 2px rule.
		// The accent is read from the custom property and normalised through a
		// probe element so the expectation is not a second copy of the hex.
		const ring = await cta.evaluate((element) => {
			const styles = getComputedStyle(element);
			const probe = document.createElement("span");
			probe.style.color = styles.getPropertyValue("--landing-accent").trim();
			document.body.append(probe);
			const accent = getComputedStyle(probe).color;
			probe.remove();
			return {
				style: styles.outlineStyle,
				width: styles.outlineWidth,
				color: styles.outlineColor,
				accent,
			};
		});
		expect(ring.style).toBe("solid");
		expect(ring.width).toBe("2px");
		expect(ring.color).toBe(ring.accent);

		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/dashboard$/);
	});

	test("carries the analytics disclosure and opt-out, exactly once", async ({
		page,
	}) => {
		await page.goto("/");
		// Settle on the rendered page first. The opt-out is reachable throughout
		// (the app-chrome copy covers the window before this page's own footer
		// copy exists, and the error screen if it never does), so counting mid
		// hand-over would be counting the loading state, not the page.
		await expect(
			page.getByRole("heading", { level: 1, name: /Bring a loop/ }),
		).toBeVisible();

		// One control for one preference: the app-chrome copy stands down while
		// this page's footer copy is mounted (see FloatingTelemetryDisclosure), so
		// the page has only the footer's.
		const disclosure = page.getByText("Privacy", { exact: true });
		await expect(disclosure).toHaveCount(1);
		await expect(page.locator("#telemetry-disclosure-note")).toHaveCount(1);

		await disclosure.click();
		const optOut = page.getByRole("checkbox", {
			name: "Share usage and error reports",
		});
		await expect(optOut).toBeChecked();
		await optOut.uncheck();
		await expect(optOut).not.toBeChecked();
	});
});

test.describe("anonymous start", () => {
	test("the landing CTA reaches a playable project with no account", async ({
		page,
	}) => {
		await page.goto("/");

		await page.getByRole("button", { name: "Start in your browser" }).click();

		// PRJ-01's anonymous start: the dashboard signs the visitor in as a guest.
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
		// The in-memory repository starts empty; a project only exists once
		// created (see the "new project" test below).
		await expect(page.getByText("No projects yet")).toBeVisible();
		await expect(page.getByText(/You're working as a guest/)).toBeVisible();

		// ...and the project it creates is playable, which is what makes the CTA's
		// promise true end to end.
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);
		await expect(
			page.getByRole("group", { name: "16-step sequence" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Start playback" }),
		).toBeVisible();
	});
});

// `FND-009`: the foundation vertical slice's surface — a 16-step grid on a
// sampler track — reachable end to end from an anonymous session. This suite
// runs against the in-memory mock backend (see playwright.config.ts), which
// is a fresh store on every page load, so it cannot prove persistence across
// a real reload; e2e-emulator/slice.spec.ts covers that against a real
// (emulated) backend instead.
test.describe("new project", () => {
	test("creates a project with a working 16-step sampler grid", async ({
		page,
	}) => {
		await page.goto("/dashboard");

		await page.getByRole("button", { name: "New Project" }).click();

		await expect(page).toHaveURL(/\/projects\/prj_/);
		const grid = page.getByRole("group", { name: "16-step sequence" });
		await expect(grid).toBeVisible();
		// The starter project's four-on-the-floor clip: steps 1, 5, 9, 13 on.
		await expect(
			page.getByRole("button", { name: "Step 1, on" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Step 2, off" }),
		).toBeVisible();

		// Toggling a step dispatches through the command layer and is visible
		// immediately.
		await page.getByRole("button", { name: "Step 2, off" }).click();
		await expect(
			page.getByRole("button", { name: "Step 2, on" }),
		).toBeVisible();

		// Undo reverts it through the same shared history the toggle used.
		await page.getByRole("button", { name: /^Undo/ }).click();
		await expect(
			page.getByRole("button", { name: "Step 2, off" }),
		).toBeVisible();
	});

	// `ARR-001`: the arrangement shell is a bounded strip above the step editor.
	// Real layout is the only place this can be proved — jsdom has no layout, so
	// a shell that overflowed its panel would look fine to the component tests
	// while silently covering the workspace and swallowing its clicks.
	test("keeps the arrangement shell inside its panel, above the step grid", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		const shell = page.getByTestId("arrangement-view-ready");
		await expect(shell).toBeVisible();

		const panelBox = await page.locator(".arrangement-panel").boundingBox();
		const shellBox = await shell.boundingBox();
		const gridBox = await page
			.getByRole("group", { name: "16-step sequence" })
			.boundingBox();
		expect(panelBox).not.toBeNull();
		expect(shellBox).not.toBeNull();
		expect(gridBox).not.toBeNull();
		if (!panelBox || !shellBox || !gridBox) return;

		// The shell fills its panel and stops there.
		expect(shellBox.height).toBeLessThanOrEqual(panelBox.height + 1);
		expect(shellBox.y + shellBox.height).toBeLessThanOrEqual(
			panelBox.y + panelBox.height + 1,
		);
		// ...and the step grid below it is clear of the panel entirely.
		expect(gridBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
	});
});

// `LOOP-001`: the dashboard's project-management surface — blank creation,
// rename, duplicate, and confirmed delete — against the in-memory mock
// backend. See `e2e-emulator/dashboard.spec.ts` for the access-control and
// persisted-delete coverage a real backend is needed to prove.
test.describe("dashboard project management", () => {
	test("creates a genuinely empty project via Blank Project", async ({
		page,
	}) => {
		await page.goto("/dashboard");

		await page.getByRole("button", { name: "Blank Project" }).click();

		await expect(page).toHaveURL(/\/projects\/prj_/);
		await expect(
			page.getByText("This project has no sampler track yet."),
		).toBeVisible();
	});

	test("renames, duplicates, and deletes a project from the dashboard", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);

		// Return to the dashboard via the editor's client-side "Projects" link,
		// NOT page.goto("/dashboard"). A full page load would drop the in-memory
		// mock store (see playwright.config.ts), losing the project just created;
		// the router link keeps the same page alive so the new project is listed.
		await page.getByRole("link", { name: /projects/i }).click();
		await expect(page).toHaveURL(/\/dashboard$/);
		await expect(page.getByText("Untitled Project")).toBeVisible();

		// Rename.
		await page.getByRole("button", { name: /rename/i }).click();
		await page
			.getByRole("textbox", { name: /rename untitled project/i })
			.fill("My First Groove");
		await page.getByRole("button", { name: /^save$/i }).click();
		await expect(page.getByText("My First Groove")).toBeVisible();
		await expect(page.getByText("Untitled Project")).not.toBeVisible();

		// Duplicate: an independent second project appears alongside it.
		await page.getByRole("button", { name: /duplicate/i }).click();
		await expect(page.getByText("My First Groove copy")).toBeVisible();
		await expect(
			page.getByText("My First Groove", { exact: true }),
		).toBeVisible();

		// Delete requires confirmation. Only the duplicate's card is targeted
		// (its text is a superset of the original's, so filtering on the full
		// "... copy" text is what tells the two cards apart).
		const duplicateCard = page
			.locator(".project-card")
			.filter({ hasText: "My First Groove copy" });
		await duplicateCard.getByRole("button", { name: /^delete$/i }).click();
		const dialog = page.getByRole("alertdialog", {
			name: /delete this project/i,
		});
		await expect(dialog).toBeVisible();

		// Cancelling keeps it.
		await dialog.getByRole("button", { name: /^cancel$/i }).click();
		await expect(page.getByText("My First Groove copy")).toBeVisible();

		// Confirming removes only that one.
		await duplicateCard.getByRole("button", { name: /^delete$/i }).click();
		await page
			.getByRole("alertdialog", { name: /delete this project/i })
			.getByRole("button", { name: /^delete$/i })
			.click();
		await expect(page.getByText("My First Groove copy")).not.toBeVisible();
		await expect(
			page.getByText("My First Groove", { exact: true }),
		).toBeVisible();
	});
});

// `LOOP-014`: the KEY-01 registry and the KEY-02 mapping guide, in a real
// browser — where keyboard layout, focus, and the browser's own defaults are
// real rather than simulated.
test.describe("keyboard shortcuts", () => {
	test("plays from the keyboard and opens the mapping guide with ?", async ({
		page,
		browserName,
	}) => {
		// Playback is asserted in Chromium only — the same known, tracked gap
		// `e2e-emulator/slice.spec.ts` documents: in Firefox here
		// `AudioContext.resume()` is refused, so the transport button never flips.
		// `LOOP-003` bounded that refusal with a timeout so it now reports
		// `audio_start_failed` instead of hanging, but a bounded failure is still
		// a failure — the cause is `HARD-001`'s real-browser pass. Not a
		// shortcut-dispatch problem; the `?` guide, the text-entry coverage below
		// and the `transport bar` block all run in every gating browser.
		// See docs/testing.md, "Playback is asserted in Chromium only".
		const canAssertPlayback = browserName === "chromium";
		test.info().annotations.push({
			type: canAssertPlayback ? "playback-asserted" : "playback-skipped",
			description: canAssertPlayback
				? `playback asserted in ${browserName}`
				: `playback not asserted in ${browserName}: AudioContext.resume() is refused here — see HARD-001`,
		});

		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(
			page.getByRole("group", { name: "16-step sequence" }),
		).toBeVisible();

		// Space toggles playback from the registry, not from a component's own
		// listener, and the transport button reflects it.
		if (canAssertPlayback) {
			await page.keyboard.press("Space");
			await expect(
				page.getByRole("button", { name: "Stop playback" }),
			).toBeVisible();
			await page.keyboard.press("Space");
			await expect(
				page.getByRole("button", { name: "Start playback" }),
			).toBeVisible();
		}

		// `?` opens the guide, generated from the registry.
		await page.keyboard.press("?");
		const guide = page.getByRole("dialog");
		await expect(guide).toBeVisible();
		await expect(
			guide.getByRole("heading", { name: "Keyboard shortcuts" }),
		).toBeVisible();
		await expect(
			guide.getByRole("heading", { name: "Transport" }),
		).toBeVisible();

		// Searching filters it, and the search field is where focus landed.
		await page.keyboard.type("quantize");
		await expect(guide.locator("[data-action]")).toHaveCount(1);
		await expect(guide.locator('[data-action="clip.quantize"]')).toBeVisible();

		// Escape closes it from inside its own search box, and playback is
		// untouched.
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(
			page.getByRole("button", { name: "Start playback" }),
		).toBeVisible();
	});

	// The guide's search box is the only text input this slice renders while a
	// controller is attached, so it is where text-entry suppression is provable
	// in a real browser: the characters typed here are all live mappings.
	test("types shortcut characters into a focused text field instead of firing them", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(
			page.getByRole("group", { name: "16-step sequence" }),
		).toBeVisible();

		await page.keyboard.press("?");
		const guide = page.getByRole("dialog");
		await expect(guide).toBeVisible();
		const search = guide.getByRole("searchbox", { name: "Search shortcuts" });
		await expect(search).toBeFocused();

		// Space, ?, q, e and o are all registered combinations. Typed into a text
		// input they are text: every character lands, the guide `?` would have
		// re-opened stays open, and playback never starts.
		await page.keyboard.type("space ? q e o");
		await expect(search).toHaveValue("space ? q e o");
		await expect(guide).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(
			page.getByRole("button", { name: "Start playback" }),
		).toBeVisible();
	});

	// Not a text-entry test: `useShortcuts` attaches to the window for the
	// lifetime of the editor, so this is what proves the listener is detached on
	// unmount and editor mappings do not follow the user to the dashboard.
	test("editor shortcuts stop working after leaving the editor", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);
		await page.getByRole("link", { name: /projects/i }).click();
		await expect(page).toHaveURL(/\/dashboard$/);

		// `?` opened the guide one route ago. With the editor unmounted there is
		// no controller on the window at all, so it does nothing.
		await page.keyboard.press("?");
		await expect(page.getByRole("dialog")).toHaveCount(0);

		// And the dashboard's own text entry keeps every character.
		await page.getByRole("button", { name: /rename/i }).click();
		const nameField = page.getByRole("textbox", { name: /rename/i });
		await nameField.fill("");
		await nameField.type("space ? test");
		await expect(nameField).toHaveValue("space ? test");
	});

	// `ConfirmDialog` has no keyboard listener of its own: Escape reaches it as
	// `view.close_surface` from the same registry the editor uses.
	test("closes the delete confirmation with Escape through the registry", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(page).toHaveURL(/\/projects\/prj_/);
		await page.getByRole("link", { name: /projects/i }).click();
		await expect(page.getByText("Untitled Project")).toBeVisible();

		await page.getByRole("button", { name: /^delete$/i }).click();
		const dialog = page.getByRole("alertdialog", {
			name: /delete this project/i,
		});
		await expect(dialog).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		// Cancelled, not deleted.
		await expect(page.getByText("Untitled Project")).toBeVisible();
	});
});

// `LOOP-003`: the transport bar, in every gating browser. Playback itself is
// still Chromium-only (see `docs/testing.md`, "Playback is asserted in Chromium
// only"), but none of the surface below needs the context to unlock — the tempo
// command, the toggles' pressed state, the fixed 4/4 display, and text-entry
// suppression inside the BPM input are all assertable in Firefox and WebKit
// today, and they are the parts of this task whose claim is cross-browser.
test.describe("transport bar", () => {
	test("edits tempo through a command, toggles loop and metronome, and shows 4/4", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(
			page.getByRole("group", { name: "16-step sequence" }),
		).toBeVisible();

		// The fixed 4/4 display and the bar.beat playhead at the arrangement start.
		await expect(page.getByTitle("Time signature (fixed at 4/4)")).toHaveText(
			"Time signature 4/4",
		);
		await expect(page.getByTitle("Playhead (bar.beat)")).toHaveText(
			"Playhead at bar 1.1",
		);

		// Tempo round-trips through the shared command layer: the input reads back
		// from `song.tempo`, and undo names the command that wrote it.
		const tempo = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
		await expect(tempo).toHaveValue("120");
		await tempo.fill("144");
		await tempo.blur();
		await expect(tempo).toHaveValue("144");
		await expect(
			page.getByRole("button", { name: "Undo Set Tempo to 144 BPM" }),
		).toBeEnabled();

		// Above the AUD-02 supported range the surface clamps before dispatching.
		await tempo.fill("999");
		await tempo.blur();
		await expect(tempo).toHaveValue("240");

		// Undo restores the previous tempo, so the transport bar is on the same
		// history as every other edit.
		await page.getByRole("button", { name: /^Undo Set Tempo/ }).click();
		await expect(tempo).toHaveValue("144");

		// Loop and metronome are toggles with real pressed state, and neither
		// needs playback to be running.
		const loop = page.getByRole("button", { name: "Enable loop" });
		await expect(loop).toHaveAttribute("aria-pressed", "false");
		await loop.click();
		await expect(
			page.getByRole("button", { name: "Disable loop" }),
		).toHaveAttribute("aria-pressed", "true");

		const metronome = page.getByRole("button", { name: "Enable metronome" });
		await expect(metronome).toHaveAttribute("aria-pressed", "false");
		await metronome.click();
		await expect(
			page.getByRole("button", { name: "Disable metronome" }),
		).toHaveAttribute("aria-pressed", "true");
	});

	// `Space` is `transport.play_stop` and `O` is `transport.metronome`. Inside
	// the BPM input they are text and a spinbutton keystroke, not transport
	// commands — the focus-safe half of the AUD-01 criterion, and it is provable
	// in every gating browser because it never unlocks the context.
	test("Space and O inside the tempo input do not reach the transport", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New Project" }).click();
		await expect(
			page.getByRole("group", { name: "16-step sequence" }),
		).toBeVisible();

		const tempo = page.getByRole("spinbutton", { name: "Tempo (BPM)" });
		await tempo.focus();
		await expect(tempo).toBeFocused();

		await page.keyboard.press("Space");
		await page.keyboard.press("o");

		// Neither mapping fired: playback never started and the click stayed off.
		await expect(
			page.getByRole("button", { name: "Start playback" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Enable metronome" }),
		).toBeVisible();
	});
});
