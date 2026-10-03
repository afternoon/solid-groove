import { describe, expect, it } from "vitest";
import { loopAsset as loop, libraryAsset as sound } from "./__fixtures__/assets";
import {
  roleLabel,
  rolesOf,
  settle,
  shelfFamilies,
  shelfFamilyOf,
  shelfRoles,
  slotSelection,
  soundsInView,
} from "./shelf";

describe("shelf", () => {
  const sounds = [
    sound({ role: "snare" }),
    sound({ role: "kick" }),
    sound({ role: "kick" }),
    sound({ family: "fx", role: "riser" }),
    sound({ family: "bass", role: "sub" }),
    loop(),
    loop({ role: "bassline" }),
    sound({ type: "preset", role: "drum-kit" }),
    sound({ family: "vocal", role: "shout" }),
  ];

  it("lists families with sounds in stable order, Loops last, with counts", () => {
    expect(shelfFamilies(sounds).map((f) => [f.key, f.count])).toEqual([
      ["drums", 3],
      ["bass", 1],
      ["fx", 1],
      ["loops", 2],
    ]);
  });

  it("omits presets and families outside the taxonomy", () => {
    expect(shelfFamilyOf(sounds[7])).toBeNull();
    expect(shelfFamilyOf(sounds[8])).toBeNull();
    expect(shelfFamilies([sounds[7], sounds[8]])).toEqual([]);
  });

  it("keeps every family in scope, at zero when the matches leave it nothing (#878)", () => {
    const matches = [sounds[1], sounds[2]];
    expect(shelfFamilies(matches, sounds).map((f) => [f.key, f.count])).toEqual([
      ["drums", 2],
      ["bass", 0],
      ["fx", 0],
      ["loops", 0],
    ]);
    expect(shelfFamilies([], sounds).map((f) => f.count)).toEqual([0, 0, 0, 0]);
  });

  it("lists a family's roles in taxonomy order, omitting empty ones", () => {
    expect(shelfRoles(sounds, "drums").map((r) => [r.key, r.count])).toEqual([
      ["kick", 2],
      ["snare", 1],
    ]);
    expect(shelfRoles(sounds, "loops").map((r) => r.key)).toEqual([
      "full-loop",
      "bassline",
    ]);
    expect(shelfRoles(sounds, "tonal")).toEqual([]);
  });

  it("keeps an unknown role visible, after the taxonomy's", () => {
    expect(rolesOf("drums", ["zap"]).at(-1)).toBe("zap");
    expect(
      shelfRoles([sound({ role: "zap" }), sound()], "drums").map((r) => r.key),
    ).toEqual(["kick", "zap"]);
  });

  it("labels roles in the singular", () => {
    expect(roleLabel("closed-hat")).toBe("Closed hat");
  });

  it("narrows the list to a family and role", () => {
    expect(soundsInView(sounds, { family: "drums", role: "kick" })).toHaveLength(2);
    expect(soundsInView(sounds, { family: "drums", role: null })).toHaveLength(3);
    expect(soundsInView(sounds, { family: "loops", role: null })).toHaveLength(2);
  });
});

describe("settle", () => {
  const sounds = [sound({ role: "kick" }), sound({ family: "fx", role: "riser" })];
  it("keeps a valid selection", () => {
    expect(settle(sounds, { family: "fx", role: "riser" })).toEqual({
      family: "fx",
      role: "riser",
    });
  });
  it("falls back to the first family with sounds", () => {
    expect(settle(sounds, { family: "loops", role: "full-loop" })).toEqual({
      family: "drums",
      role: null,
    });
    expect(settle([sounds[1]], { family: "drums", role: "kick" })).toEqual({
      family: "fx",
      role: null,
    });
  });
  it("holds a just-chosen family with no sounds, on all its roles (#878)", () => {
    expect(settle(sounds, { family: "bass", role: "sub" }, true)).toEqual({
      family: "bass",
      role: null,
    });
  });
  it("falls back to all roles when the role has no sounds", () => {
    expect(settle(sounds, { family: "drums", role: "snare" })).toEqual({
      family: "drums",
      role: null,
    });
  });
  it("leaves the selection alone when nothing is in view", () => {
    const selection = { family: "bass", role: "sub" } as const;
    expect(settle([], selection)).toBe(selection);
  });
});

describe("slot pre-filter", () => {
  it("opens a pad on drums and the role of the sound it holds", () => {
    expect(
      slotSelection({ kind: "drum-pad", sound: sound({ role: "closed-hat" }) }),
    ).toEqual({
      family: "drums",
      role: "closed-hat",
    });
  });
  it("opens an empty pad or an unplaceable sound on drums, all roles", () => {
    expect(slotSelection({ kind: "drum-pad", sound: null })).toEqual({
      family: "drums",
      role: null,
    });
    expect(
      slotSelection({
        kind: "drum-pad",
        sound: sound({ family: "vocal", role: "shout" }),
      }),
    ).toEqual({ family: "drums", role: null });
    expect(slotSelection({ kind: "drum-pad", sound: sound({ type: "preset" }) })).toEqual(
      {
        family: "drums",
        role: null,
      },
    );
  });
  it("opens a sampler on tonal and a loop track on loops", () => {
    expect(slotSelection({ kind: "sampler" })).toEqual({ family: "tonal", role: null });
    expect(slotSelection({ kind: "loop-track" })).toEqual({
      family: "loops",
      role: null,
    });
  });
});
