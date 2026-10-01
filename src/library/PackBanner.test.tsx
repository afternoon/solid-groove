import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../testing/events";
import { FIXTURE_PACK_INDEX_DOC, fixtureFetcher } from "./__fixtures__/fixtures";
import { LibraryClient } from "./libraryClient";
import PackBanner from "./PackBanner";

afterEach(cleanup);

const [drums] = FIXTURE_PACK_INDEX_DOC.packs;

function renderBanner(
  slug: string,
  projectPackIds: readonly string[],
  onClose?: () => void,
) {
  return render(() => (
    <PackBanner
      client={new LibraryClient(fixtureFetcher())}
      slug={slug}
      projectPackIds={projectPackIds}
      onClose={onClose}
    />
  ));
}

describe("PackBanner", () => {
  it("names the pack, its publisher, version, counts and description", async () => {
    renderBanner(drums.slug, [drums.id]);

    const banner = await screen.findByRole("region", { name: `About ${drums.name}` });
    expect(within(banner).getByRole("heading", { name: drums.name })).toBeVisible();
    expect(banner).toHaveTextContent(drums.publisher);
    expect(banner).toHaveTextContent(`v${drums.version}`);
    expect(banner).toHaveTextContent(`${drums.assetCount} sounds`);
    expect(banner).toHaveTextContent(drums.description);
    // One paragraph: "Publisher · vX · N sounds in M categories. Description".
    const meta = await screen.findByText(/sounds in \d+ categories\. /);
    expect(meta.tagName).toBe("P");
    expect(meta).toHaveTextContent(drums.description);
  });

  it("says In this project for a pack the project has", async () => {
    renderBanner(drums.slug, [drums.id]);
    expect(await screen.findByText("In this project")).toBeVisible();
    expect(screen.queryByText(/Joins the project/)).toBeNull();
  });

  it("says a pack joins the project when a sound is inserted otherwise", async () => {
    renderBanner(drums.slug, []);
    expect(
      await screen.findByText("Joins the project when you insert a sound"),
    ).toBeVisible();
  });

  it("marks the status as a filled pill only when the pack is in the project", async () => {
    renderBanner(drums.slug, [drums.id]);
    expect(await screen.findByText("In this project")).toHaveClass("in");
    cleanup();
    renderBanner(drums.slug, []);
    expect(
      await screen.findByText("Joins the project when you insert a sound"),
    ).not.toHaveClass("in");
  });

  it("leaves the pack through its close button", async () => {
    const onClose = vi.fn();
    renderBanner(drums.slug, [], onClose);
    clickAndFlush(await screen.findByRole("button", { name: "Back to all sounds" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no close button when the host gives no way out", async () => {
    renderBanner(drums.slug, []);
    await screen.findByRole("region", { name: `About ${drums.name}` });
    expect(screen.queryByRole("button", { name: "Back to all sounds" })).toBeNull();
  });

  it("renders nothing for a pack the index does not list", async () => {
    const { container } = renderBanner("no-such-pack", []);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector(".pack-banner")).toBeNull();
  });
});
