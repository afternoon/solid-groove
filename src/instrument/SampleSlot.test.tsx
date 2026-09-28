import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickAndFlush } from "../testing/events";
import SampleSlot from "./SampleSlot";

afterEach(cleanup);

describe("SampleSlot (#447)", () => {
  it("names the sound it holds, and opens the library when pressed", () => {
    const onBrowse = vi.fn();
    render(() => (
      <SampleSlot label="Sample for Kick" name="Deep Kick" onBrowse={onBrowse} />
    ));
    const slot = screen.getByRole("button", { name: "Sample for Kick" });
    expect(slot).toHaveTextContent("Deep Kick");
    clickAndFlush(slot);
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it("says when it is empty", () => {
    render(() => <SampleSlot label="Sample" name={null} onBrowse={() => {}} />);
    expect(screen.getByRole("button", { name: "Sample" })).toHaveTextContent(
      "No sample loaded",
    );
  });
});
