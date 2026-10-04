import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAccessUrl } from "../../site.config.mjs";
import { NOT_ON_ALLOWLIST } from "../access/allowlist";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import UpgradeAccountPrompt from "./UpgradeAccountPrompt";

afterEach(() => {
  cleanup();
  // `resetAllMocks`, not `restoreAllMocks`: the mocks here are module-level
  // `vi.fn()`s (see the `vi.hoisted` block below), and from Vitest 4
  // `restoreAllMocks` only restores spies created with `vi.spyOn` — it no
  // longer clears a plain `vi.fn()`'s calls or implementation. There are no
  // spies in this file, so it had become a no-op and call counts leaked from
  // one test into the next. `resetAllMocks` clears both, which is what this
  // teardown always meant.
  vi.resetAllMocks();
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

  it("tells a guest whose Google account is not on the alpha list, and offers Request access (#854)", async () => {
    linkWithGoogle.mockRejectedValue(
      Object.assign(
        new Error(`BLOCKING_FUNCTION_ERROR_RESPONSE : ((${NOT_ON_ALLOWLIST}))`),
        {
          code: "auth/internal-error",
        },
      ),
    );
    const { transport } = renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: /sign up with google/i }));

    expect(await screen.findByText(/isn't on the alpha list yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request access" })).toHaveAttribute(
      "href",
      requestAccessUrl,
    );
    expect(
      screen.queryByText(/could not link a google account/i),
    ).not.toBeInTheDocument();
    expect(transport.named("account_upgraded")).toHaveLength(0);
    expect(transport.named("sign_in_blocked")).toHaveLength(1);
    expect(transport.named("sign_in_blocked")[0].params).toMatchObject({
      source: "upgrade",
    });
  });
});
