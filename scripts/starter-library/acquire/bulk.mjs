// The trusted-bulk-archive ingest path.
//
// This is VCSL's pattern (vcsl.mjs) for a downloaded .zip instead of a git repo:
// a source whose whole archive shares one CC0 licence (a Producer Space pack, a
// FreePats CC0 bank — see bulkSources.mjs) is ingested as a unit, with the
// archive-wide licence captured once as evidence, rather than pinned file by file
// in sources.lock.json. Every audio member is decoded, prepared to the section 10
// standard, and emitted in the exact shape ingest.mjs produces, so there is one
// validator and one delivery layout downstream.
//
// The rights posture is identical to VCSL's: `reviewState: "bulk-cc0"`, the
// archive-wide statement as evidence, and IDs in a disjoint range. The honesty
// boundary (one archive == one CC0 licence) lives in bulkSources.mjs; this module
// assumes it and takes the whole archive.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packBySlug, packRef, RESERVED_CC0_PACK_SLUG } from "../packs.mjs";
import { analyze, encodeWav, sha256, storageKeyFor, waveformPeaks } from "../wav.mjs";
import { isArchive, listArchiveMembers, unsupportedArchiveReason } from "./archive.mjs";
import { decodeToSamples, prepareOneShot } from "./audio.mjs";
import { isPlaceholderArchiveUrl, mapBulkMember } from "./bulkSources.mjs";
import { download } from "./fetch.mjs";
import { writeAcquiredBundle } from "./ingest.mjs";

const AUDIO_MEMBER = /\.(wav|flac|aiff?|ogg)$/i;

export function bulkAssetId(source, family, role, index) {
  return `sg-one-shot-${family}-${role}-${String(source.idBase + index + 1).padStart(4, "0")}`;
}

const slug = (text) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Human name for a member: its basename, title-cased, prefixed by the source. */
function memberName(source, memberPath) {
  const base = memberPath
    .split("/")
    .pop()
    .replace(AUDIO_MEMBER, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const titled = base.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${source.name.split("—").pop().trim()} ${titled}`.trim();
}

/**
 * Decode and prepare one archive member into a manifest-shaped asset, in the
 * exact shape ingest.mjs produces. `reviewState: "bulk-cc0"` and the archive-wide
 * evidence path mirror VCSL: the rights review is the archive's own CC0 licence,
 * not a per-file human pass.
 */
export async function ingestMember(source, member, { archiveUrl, index, evidencePath }) {
  const mapped = mapBulkMember(source, member.name);
  const decoded = await decodeToSamples(member.bytes);
  const prepared = prepareOneShot(decoded.channels, { peakDbfs: -1.5 });
  const master = encodeWav(prepared);
  const hash = sha256(master);

  const pack = packBySlug(RESERVED_CC0_PACK_SLUG);
  if (!pack) {
    throw new Error(
      `bulk source "${source.id}" destination pack "${RESERVED_CC0_PACK_SLUG}" is not registered`,
    );
  }

  return {
    bytes: master,
    asset: {
      id: bulkAssetId(source, mapped.family, mapped.role, index),
      version: 1,
      pack: packRef(pack),
      name: memberName(source, member.name),
      type: "one-shot",
      family: mapped.family,
      role: mapped.role,
      files: {
        master: {
          storageKey: storageKeyFor(hash),
          sha256: hash,
          bytes: master.length,
          format: "wav",
        },
      },
      audio: {
        ...analyze(prepared),
        rootNote: null,
        tuningCents: null,
        bpm: null,
        bars: null,
        loopable: false,
        chokeGroup: null,
        chokeRole: null,
      },
      waveform: { buckets: 64, peaks: waveformPeaks(prepared, 64) },
      tags: {
        genres: [...mapped.genres].sort(),
        characters: [...mapped.characters].sort(),
        intensity: mapped.intensity,
        sourceTypes: ["recorded"],
      },
      license: {
        id: "CC0-1.0",
        creator: source.name,
        sourceUrl: source.licenseUrl,
        retrievedAt: null,
        evidencePath,
        rawRedistributionAllowed: true,
        agreementId: null,
      },
      provenance: {
        sourceType: "recorded",
        sourceId: source.sourceId,
        downloadUrl: archiveUrl,
        originalFilename: member.name.split("/").pop(),
        originalSha256: sha256(member.bytes),
        archiveMember: member.name,
        memberSha256: sha256(member.bytes),
        sourceSampleRate: decoded.sampleRate,
        sourceChannels: decoded.channels.length,
        modifications: [
          "decode",
          ...(decoded.sampleRate === 48000 ? [] : ["resample-48000"]),
          ...(decoded.channels.length > prepared.length ? ["downmix-mono"] : []),
          "dc-offset-removal",
          "lead-trim",
          "tail-trim",
          "peak-normalize",
          "edge-fades",
        ],
        // The rights review is the archive-wide CC0 licence, captured as
        // evidence, not a per-file human pass. Same posture as VCSL.
        reviewState: "bulk-cc0",
        reviewer: `${source.sourceId}-cc0-bulk`,
        reviewedAt: null,
      },
    },
  };
}

/**
 * Write the archive-wide licence evidence for a bulk source: the archive URL,
 * where the CC0 statement lives, the download checksum, and the rights position.
 * For a bulk CC0 source this record stands in for the per-file pins, exactly as
 * captureLicenseEvidence does for VCSL.
 */
export function captureBulkEvidence(
  evidenceDir,
  source,
  { archiveUrl, archiveSha256, now },
) {
  const evidenceSlug = slug(source.id);
  const record = [
    `# Licence evidence: ${source.name}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Bulk source ID | \`${source.id}\` |`,
    `| Parent source | \`${source.sourceId}\` |`,
    "| Licence | CC0-1.0 |",
    `| Archive | ${archiveUrl} |`,
    `| Archive SHA-256 | ${archiveSha256} |`,
    `| Licence statement | ${source.licenseUrl} |`,
    `| Retrieved | ${now.slice(0, 10)} |`,
    "",
    `Rights position: ${source.rightsNote}`,
    "",
    "As a bulk CC0 source, the confirmation is this archive-wide dedication",
    "rather than a per-file pin in sources.lock.json. The archive was confirmed",
    "CC0 on its licence page before ingest; every member shares the one licence.",
    "",
  ].join("\n");
  const path = join(evidenceDir, `${evidenceSlug}.md`);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path, record);
  return {
    path,
    evidencePath: `docs/licenses/sources/${evidenceSlug}.md`,
  };
}

/**
 * The whole bulk path for one source: download the archive, ingest every audio
 * member, capture the archive-wide licence as evidence, and write the acquired
 * bundle. `downloadImpl` is injectable so tests pass archive bytes without the
 * network. Refuses a placeholder archive URL — a real acquisition needs the
 * exact .zip the curator confirmed CC0, not the page they found it on.
 */
export async function acquireBulkSource(
  source,
  {
    acquiredDir,
    evidenceDir,
    now,
    log = () => {},
    downloadImpl = download,
    archiveBytes: providedBytes,
  } = {},
) {
  const timestamp = now ?? new Date().toISOString();
  const archiveUrl = source.archiveUrl;

  if (!providedBytes && isPlaceholderArchiveUrl(archiveUrl)) {
    throw new Error(
      `bulk source "${source.id}" has a placeholder archiveUrl (${archiveUrl}). ` +
        "Confirm the pack/bank is CC0 on its page, then set archiveUrl to the exact .zip before ingesting.",
    );
  }

  let bytes = providedBytes;
  if (!bytes) {
    const unsupported = unsupportedArchiveReason(archiveUrl);
    if (unsupported) throw new Error(`bulk source "${source.id}": ${unsupported}`);
    log(`downloading ${archiveUrl} …`);
    bytes = await downloadImpl(archiveUrl);
  }
  if (!isArchive(archiveUrl) && !providedBytes) {
    throw new Error(
      `bulk source "${source.id}": archiveUrl must be a .zip (got ${archiveUrl})`,
    );
  }

  const archiveSha256 = sha256(Buffer.from(bytes));
  const members = listArchiveMembers(bytes).filter((m) => AUDIO_MEMBER.test(m.name));
  const capped = source.maxMembers ? members.slice(0, source.maxMembers) : members;
  if (source.maxMembers && members.length > source.maxMembers) {
    log(
      `archive has ${members.length} audio members; taking the first ${source.maxMembers} (maxMembers)`,
    );
  }
  log(`ingesting ${capped.length} members from ${source.name}`);

  const { extractMember } = await import("./archive.mjs");
  const evidence = captureBulkEvidence(evidenceDir, source, {
    archiveUrl,
    archiveSha256,
    now: timestamp,
  });

  const ingested = [];
  for (let i = 0; i < capped.length; i++) {
    const member = capped[i];
    try {
      const memberBytes = extractMember(bytes, member.name);
      const result = await ingestMember(
        source,
        { name: member.name, bytes: memberBytes },
        { archiveUrl, index: i, evidencePath: evidence.evidencePath },
      );
      result.asset.license.retrievedAt = timestamp.slice(0, 10);
      result.asset.provenance.reviewedAt = timestamp.slice(0, 10);
      ingested.push(result);
    } catch (error) {
      log(`  skipped ${member.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const bundleDir = join(acquiredDir, slug(source.id));
  writeAcquiredBundle(bundleDir, ingested);
  log(`ingested ${ingested.length} assets to ${bundleDir}`);
  return {
    ingested: ingested.length,
    bundleDir,
    archiveSha256,
    evidencePath: evidence.evidencePath,
  };
}
