import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { seedRegisteredSession } from "./support/authSession";
import { backToArrangement, expectView, pressView, sequenceView } from "./support/views";

/**
 * Records the home page's hero video and captures its stills (#1135).
 *
 *     bun run landing:capture
 *
 * Kept in the repository (unlike a scratch `*.screens.spec.ts`) so the
 * pictures on `/` can be re-recorded whenever the editor changes: every image
 * and the video in `public/landing/` is the real app, driven against the
 * emulator with a seeded demo song (`support/landingDemoHarness.ts`), never a
 * mock panel. The one exception is the AI producer's placeholder, which is a
 * capture of its design study (`docs/assistant-panel.html`) and is captioned
 * as one on the page.
 *
 * It writes into `public/`, so it only runs when asked: an ordinary run of the
 * emulator suite skips it.
 *
 * ## What it writes
 *
 * - `hero.webm`: 10–20 s, muted, of a loop being edited and played, the
 *   arrangement it sits in, and a stereo export. Playwright records it as
 *   VP8 WebM, and its own bundled ffmpeg trims the run down to that segment,
 *   so re-recording needs nothing installed beyond `bun run
 *   test:browser:install`.
 * - `hero-poster.jpg`: the arrangement, shown before the video plays, with
 *   reduced motion, and in the prerendered page.
 * - `og.jpg`: the same view at 1200×630 for link previews.
 * - `arrange.jpg`, `play.jpg`, `shape.jpg`, `finish.jpg`: the four "in the
 *   studio today" rows.
 * - `assistant-study.jpg`: the AI producer's design study.
 */

const CAPTURING = process.env.CAPTURE_LANDING === "1";
const OUT = resolve("public/landing");
const VIDEO_TMP = join(tmpdir(), "groove-landing-video");
const VIEWPORT = { width: 1280, height: 800 } as const;
const HARNESS = "/tests/e2e/emulator/support/landingDemoHarness.ts";
const JPEG = { type: "jpeg", quality: 82 } as const;
/** One bar of 4/4 at 192 PPQ (`src/domain/time.ts`). */
const TICKS_PER_BAR = 4 * 192;

/** Playwright's own ffmpeg build: VP8 in WebM, trim and scale, and nothing else. */
function playwrightFfmpeg(): string {
  const root = join(
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
      join(process.env.HOME ?? "", ".cache", "ms-playwright"),
  );
  const dir = readdirSync(root).find((name) => name.startsWith("ffmpeg"));
  if (!dir) throw new Error(`no ffmpeg under ${root}; run bun run test:browser:install`);
  const binary = join(
    root,
    dir,
    process.platform === "darwin" ? "ffmpeg-mac" : "ffmpeg-linux",
  );
  if (!existsSync(binary)) throw new Error(`${binary} is missing`);
  return binary;
}

/** A video's length in seconds, as ffmpeg reports it. */
function videoDuration(path: string): number {
  // `ffmpeg -i` with no output exits non-zero; the header on stderr is the point.
  const result = spawnSync(playwrightFfmpeg(), ["-hide_banner", "-i", path], {
    encoding: "utf8",
  });
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(result.stderr);
  if (!match) throw new Error(`could not read the duration of ${path}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function seedDemo(page: Page, label: string): Promise<string> {
  const session = await seedRegisteredSession(page, { label });
  // The dashboard first, so the SDK has restored the session before the
  // harness writes as it.
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  return page.evaluate(
    async ({ harness, uid }) => {
      const module: typeof import("./support/landingDemoHarness") = await import(
        /* @vite-ignore */ harness
      );
      return module.seedLandingDemoProject(uid);
    },
    { harness: HARNESS, uid: session.uid },
  );
}

async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("arrangement-view-ready").waitFor();
  await expect(
    page.getByRole("list", { name: "Arrangement tracks" }).getByRole("listitem"),
  ).toHaveCount(4);
  // Let the canvas, the meters and the fonts settle.
  await page.waitForTimeout(800);
}

/** Where a clip is drawn, by its bar and track row, through the published scale. */
async function clipPosition(page: Page, bar: number, row: number) {
  const root = page.getByTestId("arrangement-view-ready");
  const pixelsPerTick = Number(await root.getAttribute("data-pixels-per-tick"));
  const rulerHeight = Number(await root.getAttribute("data-ruler-height"));
  const rowHeight = Number(await root.getAttribute("data-row-height"));
  return {
    x: (bar * TICKS_PER_BAR + TICKS_PER_BAR / 2) * pixelsPerTick,
    y: rulerHeight + row * rowHeight + rowHeight / 2,
  };
}

const timeline = (page: Page) => page.locator(".arrangement-layer-interactive");

/** Selects a track by clicking one of its clips. */
async function selectClipAt(page: Page, bar: number, row: number): Promise<void> {
  await timeline(page).click({ position: await clipPosition(page, bar, row) });
}

/** Opens a clip in the sequence view. */
async function openClipAt(page: Page, bar: number, row: number): Promise<void> {
  await timeline(page).dblclick({ position: await clipPosition(page, bar, row) });
  await expectView(page, "Sequence");
}

/** Moves the playhead to the start of a bar (1-based, as the header shows it). */
async function seekToBar(page: Page, bar: number): Promise<void> {
  const field = page
    .getByRole("group", { name: "Playhead" })
    .getByRole("spinbutton", { name: "Bar" });
  await field.fill(String(bar));
  await field.press("Enter");
  await field.evaluate((element) => (element as HTMLInputElement).blur());
  await expect(page.getByText(`Playhead at bar ${bar}.1`)).toBeAttached();
}

/** Shows the whole song, and moves the pointer off every control. */
async function zoomToSong(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Zoom to arrangement" }).click();
  await page.mouse.move(VIEWPORT.width / 2, 2);
  await page.waitForTimeout(500);
}

test.describe("landing page assets", () => {
  test.skip(!CAPTURING, "writes public/landing; run with bun run landing:capture");
  test.setTimeout(240_000);

  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test("stills", async ({ page }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    const projectId = await seedDemo(page, `landing-stills-${testInfo.project.name}`);
    await openProject(page, projectId);
    await zoomToSong(page);

    // Arrange: the whole song, its sections and every track's clips.
    await page.screenshot({ path: join(OUT, "arrange.jpg"), ...JPEG });

    // Play: a synth's faceplate, where the envelopes and filter draw their shape.
    await selectClipAt(page, 2, 2);
    await pressView(page, "Instrument");
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "play.jpg"), ...JPEG });

    // Shape: the mixer while the Drop plays, so the meters are moving.
    await pressView(page, "Mixer");
    await seekToBar(page, 13);
    await page.getByRole("button", { name: "Start playback" }).click();
    await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: join(OUT, "shape.jpg"), ...JPEG });
    await page.getByRole("button", { name: "Stop playback" }).click();

    // Finish: the library, aimed at the loop track, opens on loops near the
    // song's tempo.
    await pressView(page, "Arrangement");
    await zoomToSong(page);
    await selectClipAt(page, 14, 3);
    await pressView(page, "Library");
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: join(OUT, "finish.jpg"), ...JPEG });

    // The link preview: the arrangement at 1200x630.
    await pressView(page, "Arrangement");
    await page.setViewportSize({ width: 1200, height: 630 });
    await zoomToSong(page);
    await page.screenshot({ path: join(OUT, "og.jpg"), ...JPEG });
  });

  test("assistant design study", async ({ page }) => {
    // The AI producer has not shipped, so its placeholder is the design study
    // the panel is being built to, at its "Preview a change" step.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(pathToFileURL(resolve("docs/assistant-panel.html")).href);
    await page.locator('[data-go="4"]').click();
    const editor = page.locator("#ed");
    await expect(page.locator("#asst")).toBeVisible();
    await page.waitForTimeout(800);
    await editor.screenshot({ path: join(OUT, "assistant-study.jpg"), ...JPEG });
  });

  test("hero video", async ({ browser, browserName, baseURL }) => {
    rmSync(VIDEO_TMP, { recursive: true, force: true });
    // A context of its own, so only this test is on the tape.
    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext({
        baseURL,
        viewport: VIEWPORT,
        recordVideo: { dir: VIDEO_TMP, size: VIEWPORT },
      });
      const page = await context.newPage();
      const startedAt = Date.now();
      const at = () => (Date.now() - startedAt) / 1000;

      const projectId = await seedDemo(page, `landing-video-${browserName}`);
      await openProject(page, projectId);
      await zoomToSong(page);

      // 1. The loop: the Drop's beat in the step sequencer, playing, with a
      //    few steps added by hand.
      await seekToBar(page, 13);
      // A beat on the whole song first. It also leaves room for the tape's
      // own start-up, which the offset below only approximates.
      const from = at();
      await page.waitForTimeout(2_000);
      await openClipAt(page, 12, 0);
      await page.getByRole("button", { name: "Start playback" }).click();
      await expect(page.getByRole("button", { name: "Stop playback" })).toBeVisible();
      await page.waitForTimeout(1_200);
      for (const step of [8, 11, 16]) {
        const button = sequenceView(page).getByRole("button", {
          name: `SD, step ${step}, off`,
        });
        if ((await button.count()) === 0) continue;
        await button.click();
        await page.waitForTimeout(700);
      }
      await page.waitForTimeout(1_200);

      // 2. The arrangement it sits in, still playing.
      await backToArrangement(page);
      await zoomToSong(page);
      await page.screenshot({ path: join(OUT, "hero-poster.jpg"), ...JPEG });
      await page.waitForTimeout(2_500);
      await page.getByRole("button", { name: "Stop playback" }).click();

      // 3. The export: a stereo WAV of the whole song.
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Export" });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(1_200);
      await dialog.getByRole("radio", { name: "Stems (ZIP)" }).check();
      await page.waitForTimeout(1_500);
      await dialog.getByRole("radio", { name: "Stereo WAV" }).check();
      await page.waitForTimeout(800);
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      await page.waitForTimeout(4_000);
      const to = at();

      const video = page.video();
      if (!video) throw new Error("no video was recorded");
      const closedAt = at();
      await context.close();
      context = null;
      const raw = join(VIDEO_TMP, "raw.webm");
      await video.saveAs(raw);

      // The recording starts a moment after the page is created, so the
      // clock above runs ahead of the tape. Its end is the context closing,
      // which lines the two up.
      const offset = videoDuration(raw) - closedAt;

      const duration = Math.min(20, Math.max(10, to - from));
      execFileSync(
        playwrightFfmpeg(),
        [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          Math.max(0, from + offset).toFixed(2),
          "-i",
          raw,
          "-t",
          duration.toFixed(2),
          "-an",
          "-c:v",
          "libvpx",
          "-b:v",
          "1200k",
          "-crf",
          "10",
          "-qmin",
          "4",
          "-qmax",
          "40",
          "-auto-alt-ref",
          "0",
          join(OUT, "hero.webm"),
        ],
        { stdio: "inherit" },
      );
    } finally {
      await context?.close();
    }
  });
});
