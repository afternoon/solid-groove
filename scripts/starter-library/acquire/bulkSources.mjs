// Trusted bulk CC0 archive sources.
//
// VCSL (vcsl.mjs) proved the pattern: when a whole collection shares one CC0
// dedication, reviewing it file-by-file in `library:manage` is busywork — the
// confirmation is the collection's own licence, captured once, not a per-file
// pin. This generalizes that to two more section 4.1 sources whose CC0 clearance
// is archive-wide, not per file:
//
//   - Producer Space packs: docs/sample-library.md section 4.1 records that the
//     official /license clearance places the ENTIRE library under CC0 with an
//     express redistribution grant. A downloaded pack .zip is therefore a bulk
//     CC0 unit — every member shares the one licence.
//   - FreePats banks: FreePats states its licence PER BANK. A bank whose page
//     states CC0 is a bulk CC0 unit for that bank; the whole bank archive shares
//     the one licence, so its members do not each need a separate pin.
//
// This is the honesty boundary, and it is narrow on purpose. A bulk source is
// ONLY valid where one archive == one CC0 licence. A mixed-licence host (a
// Freesound search, a Signature Sounds pack that bundles a stray CC-BY file)
// must NOT be declared here — it stays on the per-file `library:manage` path,
// where a person confirms each file. Section 4.2 is explicit that a site-wide
// claim is not evidence for an individual file; a bulk source is the opposite
// case — a genuinely archive-wide dedication — not a loophole around it.
//
// Adding a bulk source is a rights decision: it asserts "this exact archive is
// entirely CC0, and here is where that is stated." The curator confirms the
// licence on the page before running the ingest; the ingest then captures that
// statement as the section 3.4 evidence and takes the whole archive.

import { CC0_PACK_SLUGS } from "../packs.mjs";
import { ALPHA_SOURCES } from "./alphaSources.mjs";
import { repoBank } from "./repoBank.mjs";

/**
 * @typedef {object} BulkArchiveMapping
 * @property {RegExp} match       Member-path test that selects into this rule.
 * @property {string} family      Taxonomy family.
 * @property {string} role        Taxonomy role.
 * @property {string[]} genres    Seed genres.
 * @property {string[]} characters Seed characters.
 * @property {string} [intensity] Defaults to "medium".
 * @property {string} [rootNote]  The pitch a tonal member was sampled at, e.g. "C3".
 * @property {string} [name]      The asset's display name, instead of one derived from the path.
 */

/**
 * @typedef {object} BulkSource
 * @property {string} id            Stable id; e.g. "producer-space:tech-house-drums".
 * @property {string} sourceId      The parent source in sources.mjs (rights owner).
 * @property {string} name          Human name for the archive.
 * @property {string} archiveUrl    The exact .zip a curator confirmed is CC0.
 * @property {string} licenseUrl    Where the archive-wide CC0 statement lives.
 * @property {string} rightsNote    One sentence: why this whole archive is CC0.
 * @property {number} idBase        Asset-ID base; disjoint from every other path.
 * @property {string} defaultFamily Fallback family when no mapping rule matches.
 * @property {string} defaultRole   Fallback role.
 * @property {string[]} defaultGenres
 * @property {string[]} defaultCharacters
 * @property {BulkArchiveMapping[]} [mappings] Ordered; first match wins.
 * @property {number} [maxMembers]  Ceiling, so a huge archive cannot dump.
 * @property {string} pack          Destination pack slug (packs.mjs).
 * @property {string} [repoUrl]     A git repository to clone instead of a .zip;
 *                                  the resolved commit is the pin.
 * @property {RegExp} [include]     Only repo paths matching this are ingested.
 */

/**
 * Asset-ID ranges, disjoint from the synthesized catalogue (base <5000), the
 * lockfile ingest (base 5000), and VCSL (base 6000). Each bulk source gets its
 * own 1000-wide window so no two acquisition paths can ever collide.
 */
export const BULK_ID_BASE = {
  "producer-space": 7000,
  freepats: 8000,
  karoryfer: 9000,
};

/** @type {BulkSource[]} */
export const BULK_SOURCES = [
  {
    id: "producer-space:tech-house-essentials",
    pack: CC0_PACK_SLUGS.percussion,
    sourceId: "producer-space",
    name: "Producer Space — Tech House Essentials",
    // The curator pins the exact pack .zip they confirmed on the page. This is
    // a placeholder pointing at the source's pack index until a specific pack
    // is chosen; `--list` prints it and the ingest refuses a placeholder URL.
    archiveUrl: "https://producerspace.com/free-samples/",
    licenseUrl: "https://producerspace.com/license",
    rightsNote:
      "Producer Space's official clearance places the entire library under CC0 with an express redistribution grant (section 4.1).",
    idBase: BULK_ID_BASE["producer-space"],
    defaultFamily: "drums",
    defaultRole: "percussion",
    defaultGenres: ["house", "techno"],
    defaultCharacters: ["clean"],
    maxMembers: 60,
    mappings: [
      {
        match: /kick|\bbd\b|bass ?drum/i,
        family: "drums",
        role: "kick",
        genres: ["house", "techno"],
        characters: ["punchy", "clean"],
      },
      {
        match: /snare|\bsd\b/i,
        family: "drums",
        role: "snare",
        genres: ["house", "techno"],
        characters: ["tight", "clean"],
      },
      {
        match: /clap|\bcp\b/i,
        family: "drums",
        role: "clap",
        genres: ["house"],
        characters: ["bright", "short"],
      },
      {
        match: /open.?hat|\boh\b/i,
        family: "drums",
        role: "open-hat",
        genres: ["house", "techno"],
        characters: ["bright", "metallic"],
      },
      {
        match: /closed.?hat|\bch\b|\bhh\b|hi.?hat/i,
        family: "drums",
        role: "closed-hat",
        genres: ["house", "techno"],
        characters: ["bright", "short"],
      },
      {
        match: /rim|rimshot/i,
        family: "drums",
        role: "rim",
        genres: ["house"],
        characters: ["short", "clean"],
      },
      {
        match: /perc|shaker|tamb|conga|bongo/i,
        family: "drums",
        role: "percussion",
        genres: ["house", "techno"],
        characters: ["clean", "short"],
      },
      {
        match: /sub|\b808\b/i,
        family: "bass",
        role: "sub",
        genres: ["house", "techno", "hip-hop"],
        characters: ["deep", "sub-heavy"],
      },
      {
        match: /bass/i,
        family: "bass",
        role: "sustained",
        genres: ["house", "techno"],
        characters: ["warm", "round"],
      },
    ],
  },
  {
    id: "freepats:electric-percussion",
    pack: CC0_PACK_SLUGS.percussion,
    sourceId: "freepats",
    name: "FreePats — Electric Percussion (CC0 bank)",
    // FreePats mirrors each bank to GitHub; the README there states CC0 for
    // the whole bank, and the cloned commit is the pin.
    archiveUrl: "https://freepats.zenvoid.org/Percussion/electric-percussion.html",
    repoUrl: "https://github.com/freepats/synthesizer-percussion.git",
    include: /^samples\//,
    licenseUrl:
      "https://github.com/freepats/synthesizer-percussion/blob/master/README.md",
    rightsNote:
      "This specific FreePats bank states CC0 on its own page; the whole bank archive shares that one licence (section 4.1).",
    idBase: BULK_ID_BASE.freepats,
    defaultFamily: "drums",
    defaultRole: "percussion",
    defaultGenres: ["techno", "house"],
    defaultCharacters: ["clean"],
    maxMembers: 60,
    mappings: [
      {
        match: /kick|bass ?drum/i,
        family: "drums",
        role: "kick",
        genres: ["techno", "house"],
        characters: ["clean", "punchy"],
      },
      {
        match: /snare/i,
        family: "drums",
        role: "snare",
        genres: ["techno"],
        characters: ["clean", "tight"],
      },
      {
        match: /clap/i,
        family: "drums",
        role: "clap",
        genres: ["house"],
        characters: ["bright", "short"],
      },
      {
        match: /open.?hat/i,
        family: "drums",
        role: "open-hat",
        genres: ["techno", "house"],
        characters: ["bright", "metallic"],
      },
      {
        match: /tom/i,
        family: "drums",
        role: "tom",
        genres: ["techno", "house"],
        characters: ["clean", "round"],
      },
      {
        match: /cymbal/i,
        family: "drums",
        role: "cymbal",
        genres: ["techno", "house"],
        characters: ["bright", "metallic"],
      },
      {
        match: /hat|hi.?hat|cymbal/i,
        family: "drums",
        role: "closed-hat",
        genres: ["techno", "house"],
        characters: ["bright", "short"],
      },
    ],
  },
];

/**
 * A FreePats pitched bank taken as one representative note: the note the
 * sampler plays at its recorded pitch, so the whole bank is one playable sound.
 */
function freepatsNote({ repo, name, note, file, idBase, ...tags }) {
  return repoBank({
    repo,
    name: `FreePats — ${name}`,
    pack: CC0_PACK_SLUGS.synth,
    idBase,
    take: [{ file: `samples/${file}`, note, name, ...tags }],
  });
}

const note = (repo, name, n, family, role, genres, characters, idBase) =>
  freepatsNote({
    repo,
    name,
    note: n,
    file: `${n}.flac`,
    family,
    role,
    genres,
    characters,
    idBase,
  });

const perc = (name, file, role = "percussion", characters = ["organic", "dry"]) => ({
  name,
  file: `samples/${file}`,
  family: "drums",
  role,
  genres: ["house", "hip-hop", "lofi"],
  characters,
});

const cosmonaut = (name, file, n, family, role, genres, characters) => ({
  name: `Caveman Cosmonaut ${name}`,
  file: `Samples/${file}`,
  note: n,
  family,
  role,
  genres,
  characters,
});

BULK_SOURCES.push(
  note(
    "synth-bass-1",
    "Synth Bass 1",
    "C3",
    "bass",
    "sustained",
    ["house", "techno", "electronic-pop"],
    ["warm", "round"],
    8100,
  ),
  freepatsNote({
    repo: "fm-piano1",
    name: "FM Piano 1",
    note: "C4",
    file: "C4v80.flac",
    family: "tonal",
    role: "key",
    genres: ["house", "lofi", "uk-garage"],
    characters: ["bright", "tuned"],
    idBase: 8200,
  }),
  note(
    "sweep-pad",
    "Sweep Pad",
    "C4",
    "tonal",
    "chord",
    ["ambient", "trance"],
    ["long", "soft"],
    8300,
  ),
  note(
    "synth-bass-lead",
    "Synth Bass & Lead",
    "C3",
    "bass",
    "stab",
    ["trance", "dubstep", "electronic-pop"],
    ["bright", "gritty"],
    8400,
  ),
  note(
    "synth-square",
    "Synth Lead Square",
    "C4",
    "tonal",
    "pluck",
    ["electronic-pop", "trance"],
    ["bright", "tuned"],
    8410,
  ),
  note(
    "synth-fifths",
    "Synth Fifths",
    "C4",
    "tonal",
    "stab",
    ["techno", "trance", "dubstep"],
    ["bright", "layered"],
    8420,
  ),
  note(
    "new-age",
    "New Age Pad",
    "C4",
    "tonal",
    "chord",
    ["ambient", "lofi"],
    ["long", "soft"],
    8430,
  ),
  note(
    "synth-strings-1",
    "Synth Strings 1",
    "C4",
    "tonal",
    "chord",
    ["trance", "ambient", "electronic-pop"],
    ["long", "warm"],
    8440,
  ),
  note(
    "synth-brass-1",
    "Synth Brass 1",
    "C4",
    "tonal",
    "stab",
    ["house", "electronic-pop"],
    ["bright", "punchy"],
    8450,
  ),
  note(
    "synth-crystal",
    "Synth Crystal",
    "C4",
    "tonal",
    "bell",
    ["ambient", "trance"],
    ["glassy", "bright"],
    8460,
  ),
  note(
    "synth-scifi",
    "Synth Sci-Fi",
    "C4",
    "texture",
    "drone",
    ["ambient", "dubstep"],
    ["experimental", "resonant"],
    8470,
  ),
  note(
    "synth-soundtrack",
    "Synth Soundtrack",
    "C4",
    "texture",
    "ambience",
    ["ambient"],
    ["long", "layered"],
    8480,
  ),
  repoBank({
    repo: "world-percussion",
    name: "FreePats — World Percussion",
    pack: CC0_PACK_SLUGS.percussion,
    idBase: 8500,
    take: [
      perc("Bongo", "Bongos/1_01.flac"),
      perc("Cajon", "CajonFlamenco/101.flac", "percussion", ["wooden", "roomy"]),
      perc("Castanets", "Castanets/01.flac", "percussion", ["wooden", "short"]),
      perc("Claves", "Claves/01.flac", "percussion", ["wooden", "short"]),
      perc("Conga", "Conga/v2_01_01.flac"),
      perc("Darbuka Doum", "Darbuka/doom_01_01.flac"),
      perc("Egg Shaker", "EggShaker/fast_01.flac", "percussion", ["short", "bright"]),
      perc("Hand Clap", "HandClap/01_02.flac", "clap", ["organic", "roomy"]),
      perc("High Conga", "HighConga/v2_01_01.flac"),
      perc("Low Conga", "LowConga/v3_01_01.flac"),
      perc("Maracas", "Maracas/01_01.flac", "percussion", ["short", "bright"]),
      perc("Muted Conga", "MutedConga/High_v2_01_01.flac", "percussion", [
        "organic",
        "tight",
      ]),
      perc("Tambourine", "Tambourine/01_01.flac", "percussion", ["bright", "metallic"]),
    ],
  }),
  repoBank({
    owner: "sfzinstruments",
    repo: "karoryfer.caveman-cosmonaut",
    sourceId: "karoryfer",
    pack: CC0_PACK_SLUGS.synth,
    name: "Karoryfer — Caveman Cosmonaut",
    licenseFile: "LICENSE",
    idBase: 9000,
    take: [
      cosmonaut(
        "Full Bass",
        "bass_all_c3.wav",
        "C3",
        "bass",
        "sustained",
        ["techno", "electronic-pop"],
        ["warm", "layered"],
      ),
      cosmonaut(
        "8' Bass",
        "bass_8_c3.wav",
        "C3",
        "bass",
        "sustained",
        ["house", "techno"],
        ["round", "warm"],
      ),
      cosmonaut(
        "Full Stack",
        "all_all_all_c4.wav",
        "C4",
        "tonal",
        "chord",
        ["electronic-pop", "trance"],
        ["layered", "bright"],
      ),
      cosmonaut(
        "Tremolo",
        "tremolo_c4.wav",
        "C4",
        "tonal",
        "key",
        ["lofi", "ambient"],
        ["warm", "resonant"],
      ),
      cosmonaut(
        "Violin Stop",
        "violin_c4.wav",
        "C4",
        "tonal",
        "key",
        ["ambient", "electronic-pop"],
        ["bright", "tuned"],
      ),
    ],
  }),
);

BULK_SOURCES.push(...ALPHA_SOURCES);

export function findBulkSource(id) {
  return BULK_SOURCES.find((source) => source.id === id) ?? null;
}

/**
 * Map one archive member path onto a taxonomy (family, role) and seed tags using
 * the source's ordered rules; first match wins, else the source defaults. Every
 * member of a bulk source is ingested (the whole archive is CC0), so this never
 * returns null the way the VCSL per-instrument mapping can — it classifies, it
 * does not gate.
 */
export function mapBulkMember(source, memberPath) {
  for (const rule of source.mappings ?? []) {
    if (rule.match.test(memberPath)) {
      return {
        family: rule.family,
        role: rule.role,
        genres: rule.genres,
        characters: rule.characters,
        intensity: rule.intensity ?? "medium",
        rootNote: rule.rootNote ?? null,
        name: rule.name ?? null,
      };
    }
  }
  return {
    family: source.defaultFamily,
    role: source.defaultRole,
    genres: source.defaultGenres,
    characters: source.defaultCharacters,
    intensity: "medium",
  };
}

/**
 * A URL is a placeholder (a landing/index/HTML page) rather than a pinned
 * archive if it is not a direct archive download. The ingest refuses to run
 * against a placeholder: a real acquisition needs the exact .zip the curator
 * confirmed, not the page they found it on.
 */
export function isPlaceholderArchiveUrl(url) {
  return !/\.zip($|\?)/i.test(url);
}
