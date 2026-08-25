import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import UpgradeAccountPrompt from "./UpgradeAccountPrompt";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const { linkWithGoogle } = vi.hoisted(() => ({
  linkWithGoogle: vi.fn(),
}));

vi.mock("../auth/authService", () => ({
  authService: {
    linkWithGoogle: (...args: unknown[]) => linkWithGoogle(...args),
  },
}));

function renderPrompt() {
  const transport = createRecordingTransport();
  const consent = new ConsentStore(memoryStorage());
  const analytics = new Analytics({
    transport,
    consent,
    storage: memoryStorage(),
  });
  render(() => <UpgradeAccountPrompt analytics={analytics} />);
  return { transport };
}

describe("UpgradeAccountPrompt", () => {
  it("states the anonymous retention window and the upgrade promise", () => {
    renderPrompt();

    expect(
      screen.getByText(/kept for 180 days after you last open them/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/keep your work indefinitely and open it on any device/i),
    ).toBeInTheDocument();
  });

  it("logs account_upgraded with method: google after a successful link", async () => {
    linkWithGoogle.mockResolvedValue(undefined);
    const { transport } = renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: /sign up with google/i }));

    await screen.findByRole("button", { name: /sign up with google/i });
    expect(transport.named("account_upgraded")).toHaveLength(1);
    expect(transport.named("account_upgraded")[0]?.params).toMatchObject({
      method: "google",
    });
  });

  it("does not log account_upgraded when linking fails", async () => {
    linkWithGoogle.mockRejectedValue(new Error("already in use"));
    const { transport } = renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: /sign up with google/i }));

    await screen.findByText(/could not link a google account/i);
    expect(transport.named("account_upgraded")).toHaveLength(0);
  });
});
