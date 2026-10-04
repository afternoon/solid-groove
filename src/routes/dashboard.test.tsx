import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "./dashboard";

vi.mock("../auth/AuthProvider", () => ({
  AuthProvider: () => null,
}));
vi.mock("../components/Dashboard", () => ({ default: () => null }));

describe("DashboardPage", () => {
  it("names the tab Projects", async () => {
    render(() => <DashboardPage />);
    await vi.waitFor(() => expect(document.title).toBe("Projects – Groove"));
  });
});
