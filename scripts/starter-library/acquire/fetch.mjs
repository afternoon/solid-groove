// Downloading, quarantine, and licence-evidence capture.
//
// docs/sample-library.md section 11 puts a quarantine state between "we found
// this" and "we prepared this": the original is downloaded, hashed, and kept
// isolated from any production manifest. This module owns that boundary.
// Nothing here decodes audio or writes a manifest entry — it only produces
// verified bytes plus the evidence record section 3.4 requires.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Refuse anything larger than this rather than filling the disk on a bad URL. */
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 120_000;

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Fetch a URL to bytes.
 *
 * `file:` is supported so the whole pipeline — fetch, verify, extract, decode,
 * prepare, ingest — can be exercised end to end in tests and offline, against
 * fixtures we build ourselves. Everything downstream is identical either way,
 * so the offline path tests the real code rather than a stub of it.
 */
export async function download(url, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (url.startsWith("file://")) {
    return readFileSync(fileURLToPath(url));
  }
  if (!url.startsWith("https://")) {
    // Plain HTTP would let a network position swap the audio for something
    // with different rights. The checksum pin would catch it, but there is
    // no reason to accept the weaker channel in the first place.
    throw new Error(`refusing to download over a non-https URL: ${url}`);
  }

  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "follow",
    headers: { "user-agent": "solid-groove-library-ingest/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `${url} declares ${declared} bytes, over the ${MAX_DOWNLOAD_BYTES} limit`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `${url} returned ${bytes.length} bytes, over the ${MAX_DOWNLOAD_BYTES} limit`,
    );
  }
  return bytes;
}

/**
 * Download into quarantine and verify against the pinned checksum.
 *
 * A mismatch is a hard failure, never a warning and never a re-pin: the file
 * that a person reviewed is not the file that arrived, and which of the two is
 * wrong is not something this script can decide.
 */
export async function fetchToQuarantine(
  selection,
  { quarantineDir, fetchImpl, pin = false },
) {
  const bytes = await download(selection.downloadUrl, { fetchImpl });
  const hash = sha256(bytes);

  if (!pin) {
    if (!selection.sha256) {
      throw new Error(
        `${selection.id} has no pinned sha256; run with --pin, review the result, and commit it`,
      );
    }
    if (hash !== selection.sha256) {
      throw new Error(
        `${selection.id} checksum mismatch\n  expected ${selection.sha256}\n  received ${hash}\n` +
          "  The bytes at this URL are not the bytes that were reviewed. Re-review before re-pinning.",
      );
    }
  }

  const path = join(
    quarantineDir,
    selection.sourceId,
    `${hash}-${selection.originalFilename}`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { bytes, sha256: hash, path };
}

/**
 * Capture the licence statement as it stood at acquisition time.
 *
 * Section 3.4: "If the evidence disappears later, the archived record must
 * still establish what was granted at acquisition time." A URL in a manifest is
 * not evidence — sites are edited, reorganized, and taken down — so the page
 * body is stored and hashed alongside the audio.
 */
export async function captureLicenseEvidence(source, { evidenceDir, fetchImpl, now }) {
  const retrievedAt = now;
  let body;
  let status = "captured";
  try {
    const bytes = await download(source.licenseUrl, { fetchImpl });
    body = bytes.toString("utf8");
  } catch (error) {
    // A capture failure must not be silent, and must not look like a
    // successful capture later. Record the failure as the evidence.
    status = "unavailable";
    body = `Capture failed at ${retrievedAt}: ${error instanceof Error ? error.message : error}\n`;
  }

  const record = [
    `# Licence evidence: ${source.name}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Source ID | \`${source.id}\` |`,
    `| Tier | ${source.tier} |`,
    `| Licence | ${source.licenseId} |`,
    `| Licence URL | ${source.licenseUrl} |`,
    `| Homepage | ${source.homepage} |`,
    `| Retrieved | ${retrievedAt} |`,
    `| Capture | ${status} |`,
    `| Body SHA-256 | ${sha256(Buffer.from(body))} |`,
    "",
    `Rights position: ${source.rightsNote}`,
    "",
    `Review requirement: ${source.reviewNote}`,
    "",
    "## Captured licence statement",
    "",
    "```",
    body.trim(),
    "```",
    "",
  ].join("\n");

  const relative = join("licenses", "sources", `${source.id}.md`);
  const path = join(evidenceDir, `${source.id}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, record);
  return { path, evidencePath: `docs/${relative}`, status, retrievedAt };
}
