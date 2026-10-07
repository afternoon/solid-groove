import { describe, expect, it } from "vitest";
import {
  blockerCleared,
  openBlockers,
  startOrder,
} from "../../.github/scripts/linear.mjs";

const blocker = (identifier, name, type) => ({ identifier, state: { name, type } });

describe("blockerCleared", () => {
  it("clears once the blocker's work has merged or it is closed", () => {
    expect(blockerCleared(blocker("GRV-1", "QA", "started"))).toBe(true);
    expect(blockerCleared(blocker("GRV-1", "Done", "completed"))).toBe(true);
    expect(blockerCleared(blocker("GRV-1", "Canceled", "canceled"))).toBe(true);
    expect(blockerCleared(blocker("GRV-1", "Duplicate", "duplicate"))).toBe(true);
  });

  it("holds while the blocker is unbuilt or its PRs are still open", () => {
    for (const [name, type] of [
      ["Backlog", "backlog"],
      ["Ready", "unstarted"],
      ["In Progress", "started"],
      ["Blocked", "started"],
      ["Ready For Review", "started"],
      ["Approved", "started"],
    ])
      expect(blockerCleared(blocker("GRV-1", name, type))).toBe(false);
  });
});

describe("openBlockers", () => {
  it("lists only the blockers still holding the card back", () => {
    const card = {
      blockedBy: [
        blocker("GRV-1", "QA", "started"),
        blocker("GRV-2", "In Progress", "started"),
      ],
    };
    expect(openBlockers(card).map((b) => b.identifier)).toEqual(["GRV-2"]);
  });
});

describe("startOrder", () => {
  it("starts Urgent first and no-priority last, then follows the column order", () => {
    const cards = [
      { identifier: "none", priority: 0, sortOrder: -10 },
      { identifier: "low", priority: 4, sortOrder: 1 },
      { identifier: "high-later", priority: 2, sortOrder: 5 },
      { identifier: "urgent", priority: 1, sortOrder: 9 },
      { identifier: "high-first", priority: 2, sortOrder: 2 },
    ];
    expect(startOrder(cards).map((c) => c.identifier)).toEqual([
      "urgent",
      "high-first",
      "high-later",
      "low",
      "none",
    ]);
  });
});
