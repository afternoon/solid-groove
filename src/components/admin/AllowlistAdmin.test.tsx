import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessRepository } from "../../access/accessRepository";
import { createInMemoryAccessRepository } from "../../access/inMemoryAccessRepository";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import { memoryStorage } from "../../testing/storage";
import AllowlistAdmin from "./AllowlistAdmin";

afterEach(() => {
  cleanup();
});

function renderAdmin(repository: AccessRepository = createInMemoryAccessRepository()) {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  render(() => (
    <AllowlistAdmin
      repository={async () => repository}
      analytics={analytics}
      now={() => 1_700_000_000_000}
    />
  ));
  return { transport, repository };
}

const textarea = () => screen.getByLabelText("Email addresses");
const approveButton = () => screen.getByRole("button", { name: "Approve" });

async function paste(text: string) {
  fireEvent.input(textarea(), { target: { value: text } });
  flush();
  fireEvent.click(approveButton());
  await screen.findByRole("status");
}

describe("AllowlistAdmin (#854)", () => {
  it("shows both empty states before anyone is listed or refused", async () => {
    renderAdmin();
    expect(await screen.findByText("Nobody has been turned away.")).toBeInTheDocument();
    expect(screen.getByText("Nobody is on the allowlist yet.")).toBeInTheDocument();
  });

  it("approves a pasted batch in one go and reports added, already listed and invalid", async () => {
    const repository = createInMemoryAccessRepository({
      allowlist: [{ email: "b@example.com", addedAt: 1 }],
    });
    renderAdmin(repository);
    await screen.findByRole("table", { name: "Allowlist" });

    await paste("Email\nA@example.com, b@example.com\nnot an address\nc@example.com");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Added 2");
    expect(status).toHaveTextContent("Already listed 1");
    expect(status).toHaveTextContent("Invalid 1");
    expect(status).toHaveTextContent("not an address");
    // What did not parse stays in the box to fix; the rest is done.
    expect(textarea()).toHaveValue("not an address");

    const list = await screen.findByRole("table", { name: "Allowlist" });
    await waitFor(() =>
      expect(within(list).getByText("a@example.com")).toBeInTheDocument(),
    );
    expect(within(list).getByText("c@example.com")).toBeInTheDocument();
    expect((await repository.listAllowlist()).map((e) => e.email).sort()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("approves a blocked sign-in in one click, which takes it off the blocked list", async () => {
    const repository = createInMemoryAccessRepository({
      attempts: [
        { email: "grace@example.com", firstAttemptAt: 1, lastAttemptAt: 2, count: 3 },
      ],
    });
    renderAdmin(repository);
    const blocked = await screen.findByRole("table", { name: "Blocked sign-ins" });
    expect(within(blocked).getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve grace@example.com" }));

    expect(await screen.findByText("Nobody has been turned away.")).toBeInTheDocument();
    const list = screen.getByRole("table", { name: "Allowlist" });
    expect(within(list).getByText("grace@example.com")).toBeInTheDocument();
    expect(await repository.listAttempts()).toEqual([]);
  });

  it("removes an address from the list", async () => {
    const repository = createInMemoryAccessRepository({
      allowlist: [{ email: "ada@example.com", addedAt: 1 }],
    });
    renderAdmin(repository);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove ada@example.com" }),
    );
    expect(
      await screen.findByText("Nobody is on the allowlist yet."),
    ).toBeInTheDocument();
    expect(await repository.listAllowlist()).toEqual([]);
  });

  it("logs one allowlist_approved per approval, with counts and never an address", async () => {
    const { transport } = renderAdmin(
      createInMemoryAccessRepository({
        attempts: [
          { email: "grace@example.com", firstAttemptAt: 1, lastAttemptAt: 2, count: 1 },
        ],
      }),
    );
    await screen.findByRole("table", { name: "Blocked sign-ins" });

    await paste("a@example.com\nnope");
    expect(transport.named("allowlist_approved")).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          source: "paste",
          added_count: 1,
          already_listed_count: 0,
          invalid_count: 1,
        }),
      }),
    ]);

    const approveGrace = screen.getByRole("button", {
      name: "Approve grace@example.com",
    });
    await waitFor(() => expect(approveGrace).toBeEnabled());
    fireEvent.click(approveGrace);
    await waitFor(() => expect(transport.named("allowlist_approved")).toHaveLength(2));
    expect(transport.named("allowlist_approved")[1].params).toMatchObject({
      source: "attempt",
      added_count: 1,
    });

    const firstUse = transport
      .named("feature_first_use")
      .filter((event) => event.params.feature === "allowlist_admin");
    expect(firstUse).toHaveLength(1);

    const everyValue = transport.events.flatMap((event) => Object.values(event.params));
    expect(everyValue.some((value) => String(value).includes("@"))).toBe(false);
  });

  it("says a failed approval changed nothing, and keeps the paste", async () => {
    const repository = createInMemoryAccessRepository();
    repository.commit = vi.fn().mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderAdmin(repository);
    await screen.findByText("Nobody is on the allowlist yet.");

    fireEvent.input(textarea(), { target: { value: "a@example.com" } });
    flush();
    fireEvent.click(approveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't approve those addresses. Nothing was changed.",
    );
    expect(textarea()).toHaveValue("a@example.com");
  });

  it("offers a retry when the lists cannot be loaded", async () => {
    const repository = createInMemoryAccessRepository();
    const listAllowlist = repository.listAllowlist;
    repository.listAllowlist = vi.fn().mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderAdmin(repository);

    expect(await screen.findByText("Couldn't load the allowlist.")).toBeInTheDocument();
    repository.listAllowlist = listAllowlist;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Nobody is on the allowlist yet."),
    ).toBeInTheDocument();
  });
});
