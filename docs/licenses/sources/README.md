# Captured source licence statements

This directory holds the licence evidence required by [`docs/sample-library.md` section 3.4](../../sample-library.md) for **acquired** content: one file per source, written by `bun run library:acquire` at the moment content is fetched.

Each file records the source, its tier, the licence identifier and canonical URL, the retrieval timestamp, and the licence statement itself as it read at that moment, with a SHA-256 of the captured text.

The capture is the point. Section 3.4: *"If the evidence disappears later, the archived record must still establish what was granted at acquisition time."* A URL is not evidence — sites are edited, reorganized, and taken down — so these files are committed while the downloaded audio is not.

A capture that fails is recorded as a failure and blocks ingest. It is never written in a way that could later be mistaken for a successful capture.

The directory is empty until the first CC0 selection is pinned in `scripts/starter-library/sources.lock.json` and ingested. The synthesized library's rights position is separate and lives in [`../starter-library-v1.md`](../starter-library-v1.md).
