import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { createSeededIdFactory } from "../domain/ids";
import { createManualClock } from "../shared/clock";
import { clickAndFlush, fireAndFlush } from "../testing/events";
import { memoryStorage } from "../testing/storage";
import { USER_DATA_CAP_BYTES } from "../userData/userData";
import {
  createInMemoryUserLibraryRepository,
  type InMemoryUserLibraryRepository,
} from "../userLibrary/inMemoryUserLibraryRepository";
import type { AudioDecoder } from "../userLibrary/soundAnalysis";
import { type UserLibraryAccount, useUserLibrary } from "../userLibrary/useUserLibrary";
import MyPacks from "./MyPacks";
import type { LibraryAsset } from "./manifest";

vi.mock("../auth/authService", () => ({
  authService: { linkWithGoogle: vi.fn() },
}));

afterEach(cleanup);

const decode: AudioDecoder = async () => ({
  duration: 0.1,
  numberOfChannels: 1,
  getChannelData: () => Float32Array.from([0.2, -0.7, 0.4]),
});

const REGISTERED: UserLibraryAccount = { uid: "u1", registered: true };

/** A dropped file, as the browser hands it over. */
function audioFile(name: string, type = "audio/wav", bytes = 64): File {
  const data = new Uint8Array(bytes).fill(1);
  const file = new File([data], name, { type });
  // jsdom's File has no `arrayBuffer()`; a browser's always does.
  Object.defineProperty(file, "arrayBuffer", { value: async () => data.buffer });
  return file;
}

/** The parts of a drag event the drop targets read. */
function transfer(files: File[]) {
  return {
    files,
    types: ["Files"],
    items: files.map((file) => ({ kind: "file", type: file.type })),
    dropEffect: "none",
  };
}

function drop(target: Element, files: File[]): void {
  const dataTransfer = transfer(files);
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

function setUp(
  options: {
    account?: UserLibraryAccount | null;
    repository?: InMemoryUserLibraryRepository;
  } = {},
) {
  const repository = options.repository ?? createInMemoryUserLibraryRepository();
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  const auditioned: LibraryAsset[] = [];
  function Harness() {
    const library = useUserLibrary({
      account: () => (options.account === undefined ? REGISTERED : options.account),
      repository: async () => repository,
      analytics,
      decode,
      ids: createSeededIdFactory("my-packs"),
      clock: createManualClock(1_000),
    });
    return (
      <MyPacks
        library={library}
        selectedId={null}
        searching={false}
        onAudition={(asset) => auditioned.push(asset)}
      />
    );
  }
  render(() => <Harness />);
  return { repository, transport, auditioned };
}

/** The packs have loaded once Add pack is live. */
const loaded = () =>
  waitFor(() => expect(screen.getByRole("button", { name: "Add pack" })).toBeEnabled());

const region = () => screen.getByRole("region", { name: "My packs" });
const packItem = (name: RegExp | string) =>
  screen.getAllByRole("listitem").find((item) =>
    within(item).queryByRole("button", {
      name: typeof name === "string" ? new RegExp(name) : name,
    }),
  ) as HTMLElement;

async function addNamedPack(name: string): Promise<HTMLElement> {
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add pack" }));
  const input = await screen.findByRole("textbox", { name: "Pack name" });
  fireEvent.input(input, { target: { value: name } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Pack name" })).toBeNull(),
  );
  await screen.findByRole("button", { name: new RegExp(name) });
  return packItem(name);
}

describe("My packs", () => {
  it("makes a pack with Add pack and keeps the name typed when Return is pressed", async () => {
    const { transport } = setUp();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add pack" }));
    const input = await screen.findByRole("textbox", { name: "Pack name" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("New pack");

    await addNamedPack("Field Recordings");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Field Recordings/ })).toBeVisible(),
    );
    expect(transport.named("user_pack_created")).toEqual([
      {
        name: "user_pack_created",
        params: expect.objectContaining({ method: "button" }),
      },
      {
        name: "user_pack_created",
        params: expect.objectContaining({ method: "button" }),
      },
    ]);
  });

  it("keeps the default name when the producer clicks away", async () => {
    setUp();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Add pack" }));
    const input = await screen.findByRole("textbox", { name: "Pack name" });
    fireEvent.input(input, { target: { value: "Half typed" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /New pack/ })).toBeVisible(),
    );
    expect(screen.queryByRole("button", { name: /Half typed/ })).toBeNull();
  });

  it("imports each dropped file with its own progress, and lists it when it lands", async () => {
    const repository = createInMemoryUserLibraryRepository({ uploadMs: 30 });
    const { transport } = setUp({ repository });
    const pack = await addNamedPack("Field Recordings");

    drop(pack, [audioFile("room-tone.wav"), audioFile("tape-kick.wav")]);

    // One row per file, each with its own progress, while they upload.
    await waitFor(() =>
      expect(
        within(pack).getAllByRole("progressbar", { name: "Upload progress" }),
      ).toHaveLength(2),
    );
    await waitFor(() => {
      expect(within(pack).getAllByRole("button", { name: /^Audition / })).toHaveLength(2);
      expect(within(pack).queryByRole("progressbar")).toBeNull();
    });
    expect(
      within(pack).getByRole("button", { name: "Audition tape kick" }),
    ).toBeVisible();
    expect(transport.named("sound_imported")).toHaveLength(2);
    expect(transport.named("sound_imported")[0].params).toMatchObject({
      method: "drop",
    });
  });

  it("auditions a personal sound through the library", async () => {
    const { auditioned } = setUp();
    const pack = await addNamedPack("Field Recordings");
    drop(pack, [audioFile("tape-kick.wav")]);
    fireEvent.click(
      await within(pack).findByRole("button", { name: "Audition tape kick" }),
    );
    expect(auditioned.map((asset) => asset.name)).toEqual(["tape kick"]);
  });

  it("makes My Sounds from files dropped beside the packs", async () => {
    const { transport } = setUp();
    await loaded();
    drop(region(), [audioFile("door-slam.wav")]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /My Sounds/ })).toBeVisible(),
    );
    expect(transport.named("user_pack_created")[0].params).toMatchObject({
      method: "drop",
    });
    await waitFor(() => expect(transport.named("sound_imported")).toHaveLength(1));
  });

  it("shows a drop target that takes audio and refuses anything else", async () => {
    setUp();
    const pack = await addNamedPack("Field Recordings");
    fireAndFlush(() =>
      fireEvent.dragEnter(pack, { dataTransfer: transfer([audioFile("a.wav")]) }),
    );
    expect(pack).toHaveAttribute("data-drop", "accepted");
    fireAndFlush(() =>
      fireEvent.dragLeave(pack, { dataTransfer: transfer([audioFile("a.wav")]) }),
    );
    expect(pack).toHaveAttribute("data-drop", "none");
    fireAndFlush(() =>
      fireEvent.dragEnter(pack, {
        dataTransfer: transfer([audioFile("notes.txt", "text/plain")]),
      }),
    );
    expect(pack).toHaveAttribute("data-drop", "refused");
    expect(within(pack).getByText("Only audio files can go in a pack.")).toBeVisible();
  });

  it("explains a file it could not import, and reports the failure once", async () => {
    const { transport } = setUp();
    const pack = await addNamedPack("Field Recordings");
    drop(pack, [audioFile("notes.txt", "text/plain")]);
    expect(
      await within(pack).findByText(/Not an audio file we can import/),
    ).toBeVisible();
    expect(transport.named("sound_import_failed")).toEqual([
      {
        name: "sound_import_failed",
        params: expect.objectContaining({ error_code: "unsupported_format" }),
      },
    ]);
    clickAndFlush(within(pack).getByRole("button", { name: "Dismiss" }));
    expect(within(pack).queryByText(/Not an audio file/)).toBeNull();
  });

  it("cancels an upload, leaving nothing stored and no failure reported", async () => {
    const repository = createInMemoryUserLibraryRepository({ uploadMs: 5_000 });
    const { transport } = setUp({ repository });
    const pack = await addNamedPack("Field Recordings");
    drop(pack, [audioFile("tape-kick.wav")]);
    fireEvent.click(await within(pack).findByRole("button", { name: "Cancel upload" }));
    expect(await within(pack).findByText("Cancelled.")).toBeVisible();
    expect(repository.objects.size).toBe(0);
    expect(within(pack).queryByRole("button", { name: /^Audition / })).toBeNull();
    expect(transport.named("sound_import_failed")).toEqual([]);
  });

  it("warns as the account nears its allowance, and refuses a file that would pass it", async () => {
    const repository = createInMemoryUserLibraryRepository();
    repository.setUsage("u1", USER_DATA_CAP_BYTES - 32);
    const { transport } = setUp({ repository });
    expect(await screen.findByText(/Your library is 99% full/)).toBeVisible();
    const pack = await addNamedPack("Field Recordings");

    drop(pack, [audioFile("tape-kick.wav", "audio/wav", 64)]);

    expect(await within(pack).findByText(/Your library is full/)).toBeVisible();
    expect(repository.objects.size).toBe(0);
    expect(transport.named("sound_import_failed")[0].params).toMatchObject({
      error_code: "quota_exceeded",
    });
  });

  it("warns before deleting a sound, then deletes it", async () => {
    setUp();
    const pack = await addNamedPack("Field Recordings");
    drop(pack, [audioFile("tape-kick.wav")]);
    await within(pack).findByRole("button", { name: "Audition tape kick" });

    clickAndFlush(within(pack).getByRole("button", { name: "Delete sound" }));
    expect(within(pack).getByRole("alert")).toHaveTextContent(/report it missing/);
    clickAndFlush(within(pack).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(within(pack).queryByRole("button", { name: /^Audition / })).toBeNull(),
    );
  });

  it("renames and deletes a pack", async () => {
    setUp();
    const pack = await addNamedPack("Field Recordings");
    fireEvent.click(within(pack).getByRole("button", { name: "Rename pack" }));
    const input = await within(pack).findByRole("textbox", { name: "Pack name" });
    fireEvent.input(input, { target: { value: "Foley" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await screen.findByRole("button", { name: /Foley/ });

    const renamed = packItem("Foley");
    clickAndFlush(within(renamed).getByRole("button", { name: "Delete pack" }));
    clickAndFlush(within(renamed).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Foley/ })).toBeNull(),
    );
  });

  it("offers a guest an account instead of a pack", async () => {
    const { repository } = setUp({ account: { uid: "anon", registered: false } });
    fireEvent.click(screen.getByRole("button", { name: "Add pack" }));
    expect(await screen.findByText(/You're working as a guest/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Sign up with Google/ })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Pack name" })).toBeNull();
    expect(repository.objects.size).toBe(0);
  });

  it("offers a guest an account when they drop files", async () => {
    setUp({ account: null });
    drop(region(), [audioFile("tape-kick.wav")]);
    expect(await screen.findByText(/You're working as a guest/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /My Sounds/ })).toBeNull();
  });
});
