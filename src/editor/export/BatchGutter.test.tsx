import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import BatchGutter, { type BatchGutterProps } from "./BatchGutter";

afterEach(cleanup);

const rowIds = ["a", "b", "c", "d"];

function brackets(props: Partial<BatchGutterProps> = {}) {
  const { container } = render(() => (
    <BatchGutter rowIds={rowIds} batches={[["a", "b"], ["c"], ["d"]]} {...props} />
  ));
  return [...container.querySelectorAll<HTMLElement>(".batch-bracket")];
}

describe("BatchGutter", () => {
  it("numbers one bracket per batch beside the rows it holds", () => {
    const all = brackets();
    expect(all.map((b) => b.textContent)).toEqual(["1", "2", "3"]);
    expect(all[0]?.style.top).toBe("3px");
    expect(all[0]?.style.height).toBe("42px");
    expect(all[2]?.style.top).toBe("75px");
  });

  it("shows nothing for a single batch", () => {
    expect(brackets({ batches: [rowIds] })).toHaveLength(0);
    expect(brackets({ batches: [] })).toHaveLength(0);
  });

  it("marks finished batches done and the printing one now", () => {
    const all = brackets({ doneBatches: [0], printingBatch: 1 });
    expect(all.map((b) => b.dataset.state)).toEqual(["done", "now", "waiting"]);
  });

  it("is decorative and as tall as the list", () => {
    const { container } = render(() => <BatchGutter rowIds={rowIds} batches={[]} />);
    const gutter = container.querySelector<HTMLElement>(".batch-gutter");
    expect(gutter).toHaveAttribute("aria-hidden", "true");
    expect(gutter?.style.height).toBe("96px");
  });
});
