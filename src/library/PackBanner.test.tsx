import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_PACK_INDEX_DOC, fixtureFetcher } from "./__fixtures__/fixtures";
import { LibraryClient } from "./libraryClient";
import PackBanner from "./PackBanner";

afterEach(cleanup);

const [drums] = FIXTURE_PACK_INDEX_DOC.packs;

function renderBanner(slug: string, projectPackIds: readonly string[]) {
  return render(() => (
    <PackBanner
      client={new LibraryClient(fixtureFetcher())}
      slug={slug}
      projectPackIds={projectPackIds}
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
    expect(await screen.findByText(/\d+ categories/)).toBeVisible();
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

  it("renders nothing for a pack the index does not list", async () => {
    const { container } = renderBanner("no-such-pack", []);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector(".pack-banner")).toBeNull();
  });
});
