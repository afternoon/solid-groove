import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Analytics } from "../analytics/analytics";
import { clickAndFlush } from "../testing/events";
import { FIXTURE_PACK_INDEX_DOC } from "./__fixtures__/fixtures";
import { variedPackFetcher } from "./__fixtures__/variedPackFetcher";
import { LibraryClient } from "./libraryClient";
import PacksView, { type PacksViewProps } from "./PacksView";

afterEach(cleanup);

const [first, second] = FIXTURE_PACK_INDEX_DOC.packs;

function renderPacks(overrides: Partial<PacksViewProps> = {}) {
  const onOpenPack = vi.fn();
  const logFeatureFirstUse = vi.fn();
  const rendered = render(() => (
    <PacksView
      client={new LibraryClient(variedPackFetcher())}
      analytics={{ logFeatureFirstUse } as unknown as Analytics}
      projectPackIds={[first.id]}
      keyLabel={(action) => `<${action}>`}
      onOpenPack={onOpenPack}
      {...overrides}
    />
  ));
  return { ...rendered, onOpenPack, logFeatureFirstUse };
}

/** Every cover shows its category count once every manifest has loaded. */
async function loadedCovers(count: number = FIXTURE_PACK_INDEX_DOC.packs.length) {
  await waitFor(() => {
    const covers = screen.getAllByRole("button", { name: /^Open / });
    expect(covers).toHaveLength(count);
    for (const cover of covers) expect(cover).toHaveTextContent("categories");
  });
}

describe("PacksView", () => {
  it("shows a monochrome cover per pack with its biggest categories and a key on the first nine", async () => {
    renderPacks();
    await loadedCovers();

    const open = screen.getByRole("button", { name: `Open ${first.name}` });
    expect(open).toHaveTextContent(/\+\d+ more/);
    expect(open).toHaveTextContent("CE");
    expect(open).toHaveTextContent("<library.pick_1>");
    expect(open).toHaveTextContent("In project");
    expect(screen.getByRole("button", { name: `Open ${second.name}` })).toHaveTextContent(
      "<library.pick_2>",
    );
    // Initials over waveform stripes, never artwork.
    expect(document.querySelector(".pack-cover img")).toBeNull();
    expect(document.querySelectorAll(".pack-cover path")).toHaveLength(
      FIXTURE_PACK_INDEX_DOC.packs.length * 3,
    );
  });

  it("opens a pack from its cover, and by digit through the host handle", async () => {
    const host: { openNth: ((n: number) => void) | null } = { openNth: null };
    const { onOpenPack } = renderPacks({
      onRegisterOpenNth: (open) => {
        host.openNth = open;
      },
    });
    await loadedCovers();

    clickAndFlush(screen.getByRole("button", { name: `Open ${second.name}` }));
    expect(onOpenPack).toHaveBeenLastCalledWith(second.slug);

    host.openNth?.(1);
    expect(onOpenPack).toHaveBeenLastCalledWith(first.slug);
    host.openNth?.(9);
    expect(onOpenPack).toHaveBeenCalledTimes(2);
  });

  it("narrows to packs with a family, and clears the filter again", async () => {
    renderPacks();
    await loadedCovers();
    const total = FIXTURE_PACK_INDEX_DOC.packs.length;
    expect(screen.getByText(`${total} of ${total} packs`)).toBeVisible();

    clickAndFlush(screen.getByRole("button", { name: "Bass" }));
    expect(screen.getByRole("button", { name: "Bass" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: `Open ${first.name}` })).toBeNull();
    expect(screen.getByRole("button", { name: /^Open Foundation Bass/ })).toBeVisible();

    clickAndFlush(screen.getByRole("button", { name: "Anything" }));
    expect(screen.getByRole("button", { name: `Open ${first.name}` })).toBeVisible();
  });

  it("reports pack_browser first use once", async () => {
    const { logFeatureFirstUse } = renderPacks();
    await loadedCovers();
    expect(logFeatureFirstUse).toHaveBeenCalledTimes(1);
    expect(logFeatureFirstUse).toHaveBeenCalledWith("pack_browser");
  });
});
