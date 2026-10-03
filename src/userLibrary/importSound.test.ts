import { describe, expect, it } from "vitest";
import { createSeededIdFactory, type PackId } from "../domain/ids";
import { createManualClock } from "../shared/clock";
import { MAX_IMPORT_FILE_BYTES, USER_DATA_CAP_BYTES } from "../userData/userData";
import { ImportError, type ImportFailure, importSound } from "./importSound";
import { createInMemoryUserLibraryRepository } from "./inMemoryUserLibraryRepository";
import type { AudioDecoder } from "./soundAnalysis";
import type { UserLibraryRepository } from "./userLibraryRepository";
import { newUserPack } from "./userPacks";

const UID = "u1";
const PACK_ID = "pak_importimportimportim1" as PackId;
const decode: AudioDecoder = async () => ({
  duration: 0.1,
  numberOfChannels: 1,
  getChannelData: () => Float32Array.from([0.2, -0.6]),
});

const EMPTY = { usedBytes: 0, capBytes: USER_DATA_CAP_BYTES };

function wavFile(name = "tape-kick.wav", bytes = 64, type = "audio/wav"): File {
  const data = new Uint8Array(bytes).fill(1);
  const file = new File([data], name, { type });
  // jsdom's File has no `arrayBuffer()`; a browser's always does.
  Object.defineProperty(file, "arrayBuffer", { value: async () => data.buffer });
  return file;
}

async function setUp() {
  const repository = createInMemoryUserLibraryRepository();
  await repository.createPack(UID, newUserPack(PACK_ID, "Field Recordings", 1));
  return repository;
}

function run(
  repository: UserLibraryRepository,
  file: File,
  extra: Partial<Parameters<typeof importSound>[0]> = {},
) {
  return importSound({
    repository,
    uid: UID,
    packId: PACK_ID,
    file,
    decode,
    ids: createSeededIdFactory("import"),
    clock: createManualClock(10),
    usage: EMPTY,
    ...extra,
  });
}

async function failure(promise: Promise<unknown>): Promise<ImportFailure> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ImportError);
  return (error as ImportError).reason;
}

async function storedPack(repository: UserLibraryRepository) {
  return repository.updatePack(UID, PACK_ID, (pack) => pack);
}

describe("importing a sound into a personal pack", () => {
  it("stores its audio, lists it in the pack, and reports progress", async () => {
    const repository = await setUp();
    const progress: number[] = [];
    const asset = await run(repository, wavFile(), {
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(asset).toMatchObject({
      name: "tape kick",
      role: "kick",
      contentType: "audio/wav",
      sizeBytes: 64,
      addedInVersion: "1.1.0",
      storagePath: `users/${UID}/packs/${PACK_ID}/${asset.id}`,
    });
    expect(progress).toEqual([0, 1]);
    expect(repository.objects.get(asset.storagePath)).toBe(64);
    expect((await storedPack(repository)).assets).toEqual([asset]);
  });

  it("refuses a file that is not audio, before uploading anything", async () => {
    const repository = await setUp();
    expect(await failure(run(repository, wavFile("notes.txt", 8, "text/plain")))).toBe(
      "unsupported_type",
    );
    expect(repository.objects.size).toBe(0);
  });

  it("refuses a file over the per-file limit", async () => {
    const repository = await setUp();
    const big = wavFile();
    Object.defineProperty(big, "size", { value: MAX_IMPORT_FILE_BYTES + 1 });
    expect(await failure(run(repository, big))).toBe("too_large");
    expect(repository.objects.size).toBe(0);
  });

  it("refuses a file that would take the account over its allowance", async () => {
    const repository = await setUp();
    const usage = { usedBytes: USER_DATA_CAP_BYTES - 10, capBytes: USER_DATA_CAP_BYTES };
    expect(await failure(run(repository, wavFile(), { usage }))).toBe("over_allowance");
    expect(repository.objects.size).toBe(0);
  });

  it("refuses a file that will not decode, leaving nothing unplayable behind", async () => {
    const repository = await setUp();
    const broken: AudioDecoder = async () => {
      throw new Error("EncodingError");
    };
    expect(await failure(run(repository, wavFile(), { decode: broken }))).toBe(
      "undecodable",
    );
    expect(repository.objects.size).toBe(0);
    expect((await storedPack(repository)).assets).toEqual([]);
  });

  it("leaves nothing stored when the upload is cancelled", async () => {
    const repository = await setUp();
    const controller = new AbortController();
    const pending = run(repository, wavFile(), { signal: controller.signal });
    controller.abort();
    expect(await failure(pending)).toBe("cancelled");
    expect(repository.objects.size).toBe(0);
    expect((await storedPack(repository)).assets).toEqual([]);
  });

  it("reports a refused upload by its reason", async () => {
    const repository = await setUp();
    repository.failUploads("permission_denied");
    expect(await failure(run(repository, wavFile()))).toBe("permission_denied");
    expect((await storedPack(repository)).assets).toEqual([]);
  });

  it("takes the audio back out when the pack cannot list it", async () => {
    const repository = await setUp();
    await repository.deletePack(UID, PACK_ID);
    expect(await failure(run(repository, wavFile()))).toBe("not_found");
    expect(repository.objects.size).toBe(0);
  });

  it("keeps every sound of a multi-file drop", async () => {
    const repository = await setUp();
    const ids = createSeededIdFactory("multi");
    await Promise.all(
      ["room-tone.wav", "tape-kick.wav", "door-slam.wav"].map((name) =>
        run(repository, wavFile(name), { ids }),
      ),
    );
    const pack = await storedPack(repository);
    expect(pack.assets.map((asset) => asset.name).sort()).toEqual([
      "door slam",
      "room tone",
      "tape kick",
    ]);
    expect(pack.version).toBe("1.3.0");
  });
});
