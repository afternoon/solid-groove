import { expect, type Page, test } from "@playwright/test";
import type * as DecodeHarness from "./support/decodeHarness";

/**
 * The cross-browser compatibility suite (#75, PRD section 10).
 *
 * Runs in every project of this config: Playwright's Chromium, branded Chrome
 * and Edge, and Firefox, all gating. Each block is one of
 * the issue's areas: capability fallbacks, audio unlock, decoding, shortcuts,
 * downloads, and Canvas at device pixel ratio 1 and 2. Firebase's failure
 * states live in `tests/e2e/emulator/firebaseFailure.spec.ts`.
 *
 * A fallback is forced by taking an API away (or making it refuse) in an init
 * script, before any app code runs: the browser then looks exactly like one
 * that never had it, which is the only honest way to test feature detection.
 */

const DECODE_HARNESS = "/tests/e2e/emulator/support/decodeHarness.ts";

/** The editor's notice of what this browser can't do (#75). */
const notice = (page: Page) => page.getByRole("region", { name: "Browser support" });

/** Fails the test on any uncaught page error, which a fallback must never cause. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openNewProject(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);
  await page.getByTestId("arrangement-view-ready").waitFor();
}

test.describe("capability fallbacks", () => {
  test("a fully capable browser shows no notice", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openNewProject(page);
    await expect(notice(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("without Web Audio the project still opens and edits, and says why it is silent", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      const host = window as unknown as Record<string, unknown>;
      for (const name of [
        "AudioContext",
        "webkitAudioContext",
        "OfflineAudioContext",
        "webkitOfflineAudioContext",
      ]) {
        delete host[name];
      }
    });
    await openNewProject(page);

    await expect(notice(page)).toContainText("This browser can't play sound.");
    await expect(notice(page)).toContainText(
      "Open Groove in the current version of Chrome, Edge or Firefox.",
    );
    await expect(notice(page)).toContainText("Export isn't available here.");
    // Decoding is implied by Web Audio, so its notice would only repeat it.
    await expect(notice(page)).not.toContainText("can't load sounds");

    // Play is answered, not crashed, and the advice is not repeated.
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
    await expect(notice(page).getByText("This browser can't play sound.")).toHaveCount(1);

    // Editing still works: add a track in the mixer.
    await page.keyboard.press("5");
    const mixer = page.getByRole("region", { name: "Mixer" });
    await expect(mixer.getByRole("button", { name: /^Mute / })).toHaveCount(1);
    await page.getByRole("button", { name: "Add sampler track" }).click();
    await expect(mixer.getByRole("button", { name: /^Mute / })).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("without offline rendering, export is explained", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      const host = window as unknown as Record<string, unknown>;
      delete host.OfflineAudioContext;
      delete host.webkitOfflineAudioContext;
    });
    await openNewProject(page);
    await expect(notice(page)).toContainText("Export isn't available here.");
    await expect(notice(page)).not.toContainText("can't play sound");

    // The Export dialog stays reachable; trying it gives the notice's advice.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "can't render audio offline, so songs and stems can't be exported. Open this project in the current version of Chrome, Edge or Firefox to export it.",
    );
    await expect(dialog.getByRole("alert")).not.toContainText("Safari");
    expect(errors).toEqual([]);
  });

  test("with site data blocked, the editor says what will not be kept", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      // What "block site data" and some private modes do: touching the store
      // throws a SecurityError.
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Site data is blocked", "SecurityError");
        },
      });
    });
    await openNewProject(page);
    await expect(notice(page)).toContainText("Site data is blocked.");
    await expect(notice(page)).toContainText("Allow site data for this site");
    expect(errors).toEqual([]);
  });

  test("with canvas blocked, the arrangement is explained and the other views work", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      // A privacy setting or extension that refuses canvas drawing.
      HTMLCanvasElement.prototype.getContext = () => null;
    });
    await openNewProject(page);
    await expect(notice(page)).toContainText("The arrangement can't be drawn.");
    await page.keyboard.press("5");
    await expect(page.getByRole("region", { name: "Mixer" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("without file downloads, export is explained", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      delete (HTMLAnchorElement.prototype as unknown as Record<string, unknown>).download;
    });
    await openNewProject(page);
    await expect(notice(page)).toContainText("Files can't be saved from here.");
    expect(errors).toEqual([]);
  });

  test("a notice can be dismissed", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).OfflineAudioContext;
    });
    await openNewProject(page);
    await notice(page)
      .getByRole("button", { name: "Dismiss: Export isn't available here" })
      .click();
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe("audio unlock", () => {
  test("Play starts sound with no notice", async ({ page, browserName }) => {
    // Playback is asserted in the Chromium family only: Firefox's context never
    // leaves `suspended` on a runner without an audio device (docs/testing.md,
    // "Playback is asserted in Chromium only", #43). The blocked path below is
    // what Firefox exercises there.
    test.skip(browserName !== "chromium", "playback is asserted in the Chromium family");
    await openNewProject(page);
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test("a browser that blocks sound is explained, and Play works once it is allowed", async ({
    page,
    browserName,
  }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => {
      // A browser whose autoplay policy refuses this page: the context stays
      // suspended and `resume()` rejects with the specified NotAllowedError.
      // `__soundAllowed` is the producer changing the site setting.
      const host = window as unknown as { __soundAllowed: boolean };
      host.__soundAllowed = false;
      const state = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "state");
      const resume = AudioContext.prototype.resume;
      Object.defineProperty(BaseAudioContext.prototype, "state", {
        configurable: true,
        get() {
          return host.__soundAllowed ? state?.get?.call(this) : "suspended";
        },
      });
      AudioContext.prototype.resume = function (this: AudioContext) {
        return host.__soundAllowed
          ? resume.call(this)
          : Promise.reject(new DOMException("Sound is blocked", "NotAllowedError"));
      };
    });
    await openNewProject(page);

    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(notice(page)).toContainText("The browser blocked sound.");
    await expect(notice(page)).toContainText("Press Play again.");
    await expect(notice(page)).toContainText("allow sound for this site");
    await expect(page.getByRole("button", { name: "Start playback" })).toBeVisible();
    expect(errors).toEqual([]);

    // Recovery needs a context that can actually run: the Chromium family.
    if (browserName !== "chromium") return;
    await page.evaluate(() => {
      (window as unknown as { __soundAllowed: boolean }).__soundAllowed = true;
    });
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe("decoding", () => {
  test("decodes a factory sound to what its manifest says", async ({ page }) => {
    await page.goto("/");
    const { outcome, expected } = await page.evaluate(async (harness) => {
      const module: typeof DecodeHarness = await import(/* @vite-ignore */ harness);
      return module.decodeFactorySound();
    }, DECODE_HARNESS);
    if (!outcome.ok) throw new Error(`decoding failed with ${outcome.code}`);
    expect(outcome.channels).toBe(expected.channels);
    // Within one 10 ms frame of the manifest: decoders resample to the
    // context's rate, which can round the length by a sample or two.
    expect(Math.abs(outcome.durationSeconds - expected.durationSeconds)).toBeLessThan(
      0.01,
    );
  });

  test("classifies audio the browser cannot decode as decode_failed", async ({
    page,
  }) => {
    await page.route("**/compat-probe/not-audio.wav", (route) =>
      route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: Buffer.from("this is not audio, whatever the extension says"),
      }),
    );
    await page.goto("/");
    const outcome = await page.evaluate(async (harness) => {
      const module: typeof DecodeHarness = await import(/* @vite-ignore */ harness);
      return module.decodeUrl("/compat-probe/not-audio.wav");
    }, DECODE_HARNESS);
    expect(outcome).toEqual({ ok: false, code: "decode_failed" });
  });
});

test.describe("shortcuts", () => {
  test("the guide, view keys and undo work on this platform's modifier", async ({
    page,
  }) => {
    await openNewProject(page);

    await page.keyboard.press("?");
    const guide = page.getByRole("dialog", { name: /shortcuts/i });
    await expect(guide).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);

    await page.keyboard.press("5");
    await expect(page).toHaveURL(/\/mixer$/);
    const mixer = page.getByRole("region", { name: "Mixer" });
    await page.getByRole("button", { name: "Add sampler track" }).click();
    await expect(mixer.getByRole("button", { name: /^Mute / })).toHaveCount(2);

    // Cmd on macOS, Ctrl elsewhere: the registry's platform mapping.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(mixer.getByRole("button", { name: /^Mute / })).toHaveCount(1);
  });
});

test.describe("downloads", () => {
  test("exporting the song downloads one WAV", async ({ page }) => {
    test.setTimeout(120_000);
    await openNewProject(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog).toBeVisible();
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.wav$/);
    expect(await download.failure()).toBeNull();
  });
});

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`canvas at device pixel ratio ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor });

    test("the arrangement's backing store matches the display, and it draws", async ({
      page,
    }) => {
      await openNewProject(page);
      const layers = page.locator("canvas.arrangement-layer");
      await expect(layers).toHaveCount(3);
      // Wait for the first frame to size and paint the layers.
      await expect
        .poll(() => layers.first().evaluate((canvas: HTMLCanvasElement) => canvas.width))
        .toBeGreaterThan(0);

      const sizes = await layers.evaluateAll((canvases) =>
        (canvases as HTMLCanvasElement[]).map((canvas) => ({
          width: canvas.width,
          height: canvas.height,
          cssWidth: Number.parseFloat(canvas.style.width),
          cssHeight: Number.parseFloat(canvas.style.height),
          dpr: window.devicePixelRatio,
        })),
      );
      for (const size of sizes) {
        expect(size.dpr).toBe(deviceScaleFactor);
        expect(size.width).toBe(Math.round(size.cssWidth * deviceScaleFactor));
        expect(size.height).toBe(Math.round(size.cssHeight * deviceScaleFactor));
      }

      // The content layer carries the starter clip: some pixels are painted.
      await expect
        .poll(() =>
          layers.nth(1).evaluate((canvas: HTMLCanvasElement) => {
            const context = canvas.getContext("2d");
            if (!context) return 0;
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let painted = 0;
            for (let index = 3; index < data.length; index += 4) {
              if (data[index] !== 0) painted++;
            }
            return painted;
          }),
        )
        .toBeGreaterThan(0);
    });
  });
}
