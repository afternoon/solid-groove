import { describe, expect, it } from "vitest";
import { assistantLibraryContextSchema } from "../../assistant/protocol";
import { fixtureFetcher } from "../../library/__fixtures__/fixtures";
import { LibraryClient } from "../../library/libraryClient";
import { createStarterProject } from "../starterProject";
import { createAssistantLibrary, libraryContext } from "./assistantLibrary";

const STARTER_KICK = "sg-one-shot-drums-kick-0001";

async function loaded() {
  const library = createAssistantLibrary(new LibraryClient(fixtureFetcher()));
  const catalog = await library.load();
  if (!catalog) throw new Error("the fixture library did not load");
  return { library, catalog };
}

describe("the assistant's library (GRV-23)", () => {
  it("loads every published pack once, with the sounds a slot can play", async () => {
    let fetches = 0;
    const fetcher = fixtureFetcher();
    const library = createAssistantLibrary(
      new LibraryClient((url) => {
        fetches += 1;
        return fetcher(url);
      }),
    );
    expect(library.current()).toBeNull();
    const [first, second] = await Promise.all([library.load(), library.load()]);
    expect(first).toBe(second);
    expect(library.current()).toBe(first);
    const before = fetches;
    await library.load();
    expect(fetches).toBe(before);
    const sounds = first?.packs.flatMap((entry) => entry.sounds) ?? [];
    expect(first?.packs.map((entry) => entry.pack.name)).toContain(
      "Core Electronic Drums",
    );
    // A preset has no audio of its own to try.
    expect(sounds.some((sound) => sound.type === "preset")).toBe(false);
    expect(sounds.some((sound) => sound.id === STARTER_KICK)).toBe(true);
  });

  it("resolves to null when the index will not load, and asks again next time", async () => {
    let fail = true;
    const fetcher = fixtureFetcher();
    const library = createAssistantLibrary(
      new LibraryClient((url) =>
        fail ? Promise.reject(new Error("offline")) : fetcher(url),
      ),
    );
    expect(await library.load()).toBeNull();
    fail = false;
    expect(await library.load()).not.toBeNull();
  });

  it("sends names, roles, tags and IDs, and what the project already uses", async () => {
    const { catalog } = await loaded();
    const project = createStarterProject("uid-1");
    const context = libraryContext(catalog, project);
    expect(assistantLibraryContextSchema.safeParse(context).success).toBe(true);

    const drums = context.packs.find((pack) => pack.name === "Core Electronic Drums");
    expect(drums?.inProject).toBe(true);
    expect(drums?.publisher).toBe("Groove");
    const starter = drums?.sounds.find((sound) => sound.id === STARTER_KICK);
    expect(starter).toMatchObject({ role: "kick", type: "one-shot", inProject: true });
    expect(starter?.tags).toEqual(expect.arrayContaining(["house", "clean"]));
    expect(drums?.sounds.filter((sound) => sound.inProject)).toHaveLength(1);
    const bass = context.packs.find((pack) => pack.name === "Foundation Bass");
    expect(bass?.inProject).toBe(false);
  });

  it("never sends a URL or where a sound is stored", async () => {
    const { catalog } = await loaded();
    const sent = JSON.stringify(libraryContext(catalog, createStarterProject("uid-1")));
    expect(sent).not.toMatch(/https?:|\.wav|sha256|samples\/|storage/i);
  });
});
