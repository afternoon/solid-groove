// The approved acquisition sources, and what may be taken from each.
//
// This file is the curation gate. docs/sample-library.md section 4.2 is explicit
// that intake must not "bulk-import search results blindly": nothing is fetched
// unless it is declared here, reviewed by a person, and pinned to a checksum in
// `sources.lock.json`. A crawler, a search API, or a "download everything under
// this tag" mode would defeat the point of the section 3 policy, so the fetcher
// has no such capability.
//
// Adding a source is a rights decision, not a coding one. Section 3.2 accepts
// exactly four routes, and only two of them apply to downloadable content:
// CC0 1.0 from a credible rights holder with recorded provenance, or a written
// OEM grant. Everything else — CC-BY, CC-BY-SA, CC-BY-NC, CC-ND, GPL audio,
// custom attribution terms — is rejected by `APPROVED_LICENSES` below, however
// permissive it looks.

/**
 * Licence identifiers that may be bundled.
 *
 * `CC0-1.0` is the only third-party licence on the list. `solid-groove-owned`
 * covers the synthesized library. Commissioned and OEM content will add their
 * own identifiers alongside an agreement ID when section 3.2's third and fourth
 * routes are first used.
 */
export const APPROVED_LICENSES = ["CC0-1.0", "solid-groove-owned"];

/**
 * Licences that are *specifically* rejected, so a validation failure explains
 * itself instead of just saying "unknown licence". These are all licences a
 * well-meaning contributor might reasonably think are fine.
 */
export const REJECTED_LICENSES = {
  "CC-BY-4.0":
    "requires user-facing attribution Solid Groove cannot carry through stem and Ableton export",
  "CC-BY-3.0":
    "requires user-facing attribution Solid Groove cannot carry through stem and Ableton export",
  "CC-BY-SA-4.0": "share-alike would attach to user projects",
  "CC-BY-NC-4.0": "non-commercial conflicts with a paid product",
  "CC-BY-ND-4.0": "no-derivatives conflicts with sampler use and processing",
  "GPL-3.0": "copyleft audio would attach to user projects",
  "royalty-free":
    "standard royalty-free terms permit use in a composition but prohibit redistributing raw files (section 3.1)",
};

/**
 * Intake tiers from sections 4.1 and 4.2.
 *
 * `tier-1` sources publish a library-wide CC0 clearance, so provenance review
 * is per pack. `tier-2` sources host per-asset licences and mixed uploads, so
 * every selected file needs its own uploader and provenance review before it is
 * pinned — a site-wide claim is not evidence for an individual file.
 */
export const TIERS = ["tier-1", "tier-2"];

/**
 * @typedef {object} Source
 * @property {string} id                Stable source ID; appears in provenance.
 * @property {string} name              Human name.
 * @property {string} tier              tier-1 | tier-2.
 * @property {string} homepage          Where a reviewer starts.
 * @property {string} licenseId         Licence every selection from this source must carry.
 * @property {string} licenseUrl        Canonical licence statement, archived at fetch time.
 * @property {string} rightsNote        Why this source clears section 3.2, in one sentence.
 * @property {string} reviewNote        What a reviewer must check before pinning a selection.
 * @property {string[]} take            What to select from this source.
 * @property {string[]} avoid           What must not be selected, and why.
 * @property {number} maxSelections     Ceiling from the section 14 acquisition backlog.
 */

/** @type {Source[]} */
export const SOURCES = [
  {
    id: "producer-space",
    name: "Producer Space",
    tier: "tier-1",
    homepage: "https://producerspace.com/",
    licenseId: "CC0-1.0",
    licenseUrl: "https://producerspace.com/license",
    rightsNote:
      "The official clearance places the entire library under CC0 and expressly grants reproduction, modification, and distribution.",
    reviewNote:
      "Audit pack authorship. Quarantine anything vocal until a performer release is on file (section 3.3).",
    take: ["electronic one-shots", "percussion", "house material", "non-vocal loops"],
    avoid: [
      "vocals and speech — no performer release",
      "anything credited to a third-party pack",
    ],
    maxSelections: 40,
  },
  {
    id: "freepats",
    name: "FreePats",
    tier: "tier-1",
    homepage: "https://freepats.zenvoid.org/",
    licenseId: "CC0-1.0",
    // FreePats states licences per bank, so the per-bank page is the
    // evidence, not the site root.
    licenseUrl: "https://freepats.zenvoid.org/licenses.html",
    rightsNote:
      "Licences are stated per bank; only banks explicitly released under CC0 are eligible.",
    reviewNote:
      "Confirm the CC0 statement on the specific bank page before pinning. A CC0 bank sitting beside a CC-BY bank is normal here.",
    take: [
      "electronic percussion",
      "synth bass multisamples",
      "synth pads",
      "tuned percussion",
    ],
    avoid: ["any bank whose page does not state CC0", "sampled commercial instruments"],
    maxSelections: 40,
  },
  {
    id: "vcsl",
    name: "Versilian Community Sample Library",
    tier: "tier-1",
    homepage: "https://versilian-studios.com/vcsl/",
    licenseId: "CC0-1.0",
    licenseUrl: "https://versilian-studios.com/vcsl/",
    rightsNote:
      "Published under CC0, with the publisher explicitly permitting commercial software, DAWs, granular synths, and samplers.",
    reviewNote:
      "Select a small electronic-production subset. Do not ingest the full multi-gigabyte library (section 4.1).",
    take: [
      "organic percussion",
      "mallets",
      "unusual resonances",
      "experimental instruments",
      "textures",
    ],
    avoid: [
      "full orchestral multisample sets",
      "anything that blows the section 12 payload budget",
    ],
    maxSelections: 50,
  },
  {
    id: "signature-sounds",
    name: "Signature Sounds",
    tier: "tier-2",
    homepage: "https://signaturesounds.org/",
    licenseId: "CC0-1.0",
    licenseUrl: "https://signaturesounds.org/",
    rightsNote: "The site states its packs include CC0 licence files.",
    reviewNote:
      "Verify the licence file, creator, and provenance inside every selected pack. A site-wide claim is not sufficient evidence on its own (section 4.2).",
    take: [
      "tuned long basses",
      "organic percussion",
      "ambience",
      "drones",
      "impacts",
      "bells",
    ],
    avoid: [
      "packs with no matching CC0 licence file",
      "anything with unclear authorship",
    ],
    maxSelections: 40,
  },
  {
    id: "freesound",
    name: "Freesound",
    tier: "tier-2",
    homepage: "https://freesound.org/",
    licenseId: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    rightsNote:
      "Individual sounds may be released under CC0; the catalogue also holds CC-BY and CC-BY-NC.",
    reviewNote:
      "Record sound ID, uploader, and licence. Assess provenance manually — an uploader may have re-uploaded a commercial pack. Avoid recognizable media. Never bulk-import a search result page (section 4.2).",
    take: [
      "foley",
      "field recordings",
      "mechanical sounds",
      "percussion",
      "ambience",
      "noise",
    ],
    avoid: [
      "anything not marked CC0",
      "recognizable music, film, or game audio",
      "identifiable speech or people (section 3.3)",
      "sensitive-context field recordings",
    ],
    maxSelections: 50,
  },
  {
    id: "kenney",
    name: "Kenney",
    tier: "tier-2",
    homepage: "https://www.kenney.nl/assets",
    licenseId: "CC0-1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    rightsNote: "Kenney states its asset-page downloads are CC0.",
    reviewNote:
      "Useful for interface and transition effects rather than core musical identity. Confirm the CC0 statement on the asset page.",
    take: ["interface sounds", "impacts", "short effects", "raw sound-design material"],
    avoid: ["anything intended to carry a genre's musical identity"],
    maxSelections: 25,
  },
];

export function findSource(id) {
  return SOURCES.find((source) => source.id === id) ?? null;
}

/** Why a licence is not bundleable, or null if it is approved. */
export function licenseRejectionReason(licenseId) {
  if (APPROVED_LICENSES.includes(licenseId)) return null;
  return (
    REJECTED_LICENSES[licenseId] ??
    `"${licenseId}" is not an approved licence; docs/sample-library.md section 3.2 accepts ${APPROVED_LICENSES.join(" or ")}`
  );
}
