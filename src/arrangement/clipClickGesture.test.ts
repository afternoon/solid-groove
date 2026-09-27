import { describe, expect, it } from "vitest";
import { clipClickGesture } from "./clipClickGesture";

const keys = (held: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey", boolean>>) => ({
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...held,
});

describe("the gesture a modifier-click on a clip makes (#405)", () => {
  it("toggles with Cmd on macOS and Ctrl elsewhere, never the other one", () => {
    expect(clipClickGesture(keys({ metaKey: true }), "mac")).toBe("toggle");
    expect(clipClickGesture(keys({ ctrlKey: true }), "other")).toBe("toggle");
    expect(clipClickGesture(keys({ ctrlKey: true }), "mac")).toBe("replace");
    expect(clipClickGesture(keys({ metaKey: true }), "other")).toBe("replace");
  });

  it("extends with Shift, and replaces with nothing held", () => {
    expect(clipClickGesture(keys({ shiftKey: true }), "mac")).toBe("extend");
    expect(clipClickGesture(keys({ shiftKey: true }), "other")).toBe("extend");
    expect(clipClickGesture(keys({}), "other")).toBe("replace");
  });
});
