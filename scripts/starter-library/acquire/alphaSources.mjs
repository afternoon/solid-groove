// Private-alpha drum-machine kits (DEC-010, docs/sample-library.md section 3.2).
//
// Every source here has an informal or unconfirmed rights grant, so every one
// ships under the `private-alpha` rights position into its own pack. That
// position is only approved while release.config.mjs says Groove is a
// not-for-profit private alpha; leaving the alpha makes library:build reject
// these, and CNT-003 replaces or removes them. Deleting this file (and its
// import in bulkSources.mjs) removes all of them at once.

import { repoBank } from "./repoBank.mjs";

const ALPHA = { licenseId: "private-alpha", pack: "alpha-drum-machines" };

/** Taxonomy for a drum-machine hit, read from its file or folder name. */
function drumRole(path) {
  const name = path.toLowerCase();
  const rules = [
    [/kick|(^|\/)bd|bassdrum|\/bt/, "kick"],
    [/clap|(^|\/)cp|handclp/, "clap"],
    [/rim|stick|(^|\/)rs/, "rim"],
    [/snare|shortsn|(^|\/)sd|(^|\/)st\d|univox-sd/, "snare"],
    [/open|ohihat|hhopen|(^|\/)oh|univox-oh|hhod|opcl|clop/, "open-hat"],
    [/hat|hithat|chihat|hhclosed|(^|\/)ch|univox-ch|hhcd/, "closed-hat"],
    [/crash|cymbal|cymball|ride|(^|\/)cy|cshd|rided/, "cymbal"],
    [/tom|(^|\/)(lt|mt|ht)/, "tom"],
  ];
  const role = rules.find(([pattern]) => pattern.test(name))?.[1] ?? "percussion";
  return { family: "drums", role };
}

const hit = (file, name, genres) => ({
  file,
  name,
  ...drumRole(file),
  genres,
  characters: ["punchy", "short"],
});

const HOUSE = ["house", "techno"];
const ELECTRO = ["hip-hop", "trap", "techno"];
const RETRO = ["electronic-pop", "breakbeat", "lofi"];

const ROB_ROY_909 = "tr-909/TR909all/";
const FISCHER_808 = "tr-808/TR808WAV/";

/** The Rob Roy Recordings TR-909 set (Jason Baker, 1995), recorded from a real 909. */
const tr909 = repoBank({
  owner: "fluid-music",
  repo: "open-drums",
  branch: "main",
  sourceId: "open-drums",
  id: "open-drums:tr-909",
  name: "TR-909",
  licenseFile: `${ROB_ROY_909}TR909SET.TXT`,
  idBase: 7600,
  ...ALPHA,
  rightsNote:
    "Recorded from a real TR-909 by Jason Baker (Rob Roy Recordings, 1995). Free, not-for-profit copying is permitted; modification and subsetting are not. Admitted for the private alpha only.",
  rightsQuote:
    "Please feel free to copy or distribute the set in any way. Please DO NOT change samples, add samples, delete samples, or modify this text file in any way. Respect the work. This sample set is FREE. You may not distribute these samples for profit!!",
  take: [
    ["BT3A0D3.WAV", "TR-909 Kick"],
    ["BT0A0DA.WAV", "TR-909 Kick Long"],
    ["BTAA0D7.WAV", "TR-909 Kick Tuned"],
    ["ST3T3S7.WAV", "TR-909 Snare"],
    ["ST7T0SA.WAV", "TR-909 Snare Bright"],
    ["HANDCLP1.WAV", "TR-909 Clap"],
    ["HANDCLP2.WAV", "TR-909 Clap 2"],
    ["RIM127.WAV", "TR-909 Rim"],
    ["HHCD4.WAV", "TR-909 Closed Hat"],
    ["HHOD6.WAV", "TR-909 Open Hat"],
    ["CSHD8.WAV", "TR-909 Crash"],
    ["RIDEDA.WAV", "TR-909 Ride"],
    ["LT3D7.WAV", "TR-909 Low Tom"],
    ["MT3D7.WAV", "TR-909 Mid Tom"],
    ["HT3D7.WAV", "TR-909 High Tom"],
  ].map(([file, name]) => hit(`${ROB_ROY_909}${file}`, name, HOUSE)),
});

/** Michael Fischer's TR-808 set (Technopolis, 1994), recorded from a real 808. */
const tr808 = repoBank({
  owner: "fluid-music",
  repo: "open-drums",
  branch: "main",
  sourceId: "open-drums",
  id: "open-drums:tr-808",
  name: "TR-808",
  licenseFile: `${FISCHER_808}TR808.TXT`,
  idBase: 7650,
  ...ALPHA,
  rightsNote:
    "Recorded from a real TR-808 (serial 103852) by Michael Fischer, Technopolis, 1994. Offered free with no written redistribution grant. Admitted for the private alpha only.",
  rightsQuote:
    'And best of all, and very unlike many of the "competiting" samples, these samples are ABSOLUTELY FREE!',
  take: [
    ["BD/BD5050.WAV", "TR-808 Kick"],
    ["BD/BD2575.WAV", "TR-808 Kick Long"],
    ["BD/BD0010.WAV", "TR-808 Kick Short"],
    ["SD/SD5050.WAV", "TR-808 Snare"],
    ["SD/SD2575.WAV", "TR-808 Snare Snappy"],
    ["CP/CP.WAV", "TR-808 Clap"],
    ["RS/RS.WAV", "TR-808 Rim"],
    ["CL/CL.WAV", "TR-808 Clave"],
    ["CB/CB.WAV", "TR-808 Cowbell"],
    ["MA/MA.WAV", "TR-808 Maracas"],
    ["CH/CH.WAV", "TR-808 Closed Hat"],
    ["OH/OH50.WAV", "TR-808 Open Hat"],
    ["CY/CY5050.WAV", "TR-808 Cymbal"],
    ["LT/LT50.WAV", "TR-808 Low Tom"],
    ["MT/MT50.WAV", "TR-808 Mid Tom"],
    ["HT/HT50.WAV", "TR-808 High Tom"],
    ["LC/LC50.WAV", "TR-808 Low Conga"],
    ["HC/HC50.WAV", "TR-808 High Conga"],
  ].map(([file, name]) => hit(`${FISCHER_808}${file}`, name, ELECTRO)),
});

const title = (text) =>
  text
    .replace(/^DT_/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One machine from smpldsnds/drum-machines. The host's README calls the whole
 * collection "public domain samples" but names no recordists, so every kit
 * here is private-alpha content.
 */
function smpldsndsMachine(dir, label, files, idBase, genres) {
  return repoBank({
    owner: "smpldsnds",
    repo: "drum-machines",
    branch: "main",
    sourceId: "smpldsnds",
    id: `smpldsnds:${dir.toLowerCase()}`,
    name: label,
    licenseFile: "README.md",
    idBase,
    ...ALPHA,
    rightsNote:
      "Hosted by smpldsnds/drum-machines, whose README calls the collection public domain without naming the recordists. Unconfirmed; admitted for the private alpha only.",
    rightsQuote: "A collection of public domain samples of different drum machines",
    take: files.map((file) =>
      hit(`${dir}/${file}.ogg`, `${label} ${title(file)}`, genres),
    ),
  });
}

export const ALPHA_SOURCES = [
  tr909,
  tr808,
  smpldsndsMachine(
    "LM-2",
    "LinnDrum LM-2",
    [
      "kick",
      "snare-m",
      "clap",
      "stick-m",
      "hhclosed",
      "hhopen",
      "crash",
      "ride",
      "tom-h",
      "tom-m",
      "tom-l",
      "cowbell",
      "tambourine",
      "cabasa",
      "conga-h",
      "conga-l",
    ],
    7700,
    RETRO,
  ),
  smpldsndsMachine(
    "Roland-CR-8000",
    "CR-8000",
    [
      "kick",
      "snare",
      "clap",
      "rimshot",
      "hihat-closed",
      "hihat-open",
      "cymball",
      "tom-high",
      "tom-low",
      "cowbell",
      "clave",
      "conga-high",
      "conga-low",
    ],
    7720,
    RETRO,
  ),
  smpldsndsMachine(
    "Sequential-Circuits-Drumtraks",
    "Drumtraks",
    [
      "DT_Kick",
      "DT_Snare",
      "DT_Clap",
      "DT_Rimshot",
      "DT_Closedhat",
      "DT_Openhat",
      "DT_Crash",
      "DT_Ride",
      "DT_Tom01",
      "DT_Tom02",
      "DT_Cowbell",
      "DT_Tamborine",
      "DT_Cabasa",
    ],
    7740,
    RETRO,
  ),
  smpldsndsMachine(
    "Casio-RZ1",
    "Casio RZ-1",
    [
      "kick",
      "snare",
      "clap",
      "hihat-closed",
      "hihat-open",
      "crash",
      "ride",
      "tom-1",
      "tom-2",
      "tom-3",
      "cowbell",
      "clave",
    ],
    7760,
    RETRO,
  ),
  smpldsndsMachine(
    "Yamaha-MR10",
    "Yamaha MR-10",
    [
      "kick",
      "kick1",
      "snare",
      "shortsn",
      "chihat",
      "ohihat",
      "crash",
      "cymbal",
      "hitom",
      "midtom",
      "lowtom",
      "shaker",
      "brush",
    ],
    7780,
    RETRO,
  ),
  smpldsndsMachine(
    "MFB-512",
    "MFB-512",
    [
      "kick",
      "snare",
      "clap",
      "hihat-closed",
      "hihat-open",
      "cymbal",
      "tom-hi",
      "tom-mid",
      "tom-low",
    ],
    7800,
    HOUSE,
  ),
  smpldsndsMachine(
    "808-mini",
    "808 Mini",
    [
      "kick",
      "snare-1",
      "snare-2",
      "hhclosed-1",
      "hhopen-1",
      "crash",
      "ride",
      "tom-high",
      "tom-mid",
      "tom-low",
    ],
    7820,
    ELECTRO,
  ),
  smpldsndsMachine(
    "Casio-SK1",
    "Casio SK-1",
    ["kick", "snare", "hithat", "hihat-open", "tom-hi", "tom-low"],
    7840,
    RETRO,
  ),
  smpldsndsMachine(
    "Micro-Rhythmer-12",
    "Micro-Rhythmer 12",
    ["univox-sd", "univox-ch", "univox-oh"],
    7860,
    RETRO,
  ),
];
