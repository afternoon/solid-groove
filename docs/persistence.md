# Schema-v1 persistence

| Field | Value |
| --- | --- |
| Status | Implemented (`FND-004`) |
| Scope | The Firestore document layout, the repository boundary, optimistic autosave, and the migration harness |

Related documents: [Product principles](./prd.md), [core flows](./core-flows.md), [testing](./testing.md)

Code: [`src/persistence/`](../src/persistence). The canonical domain model it stores is [`src/domain/`](../src/domain); persistence never redefines a domain rule, it only decides where bytes live.

## Document layout

`src/persistence/documents.ts` is the checked-in mapping. Nothing else may build a Firestore path or document body for a project.

| Path | Contents | Written when |
| --- | --- | --- |
| `projects/{projectId}` | Name, owner, collaborators, created/modified time, schema version, current revision, template/genre, the pack dependency list (`packDependencies`: one pack ID and version per pack the project's assets resolve from), and the pack shelf (`addedPacks`: the packs the user has added to this project, a superset of the dependency list — [LIB-08](#packs-and-pack-qualified-assets)) | Metadata edits, and every `saveSong` — the dependency list is derived from the song's assets. The dashboard reads only this tier. |
| `projects/{projectId}/song/current` | Tempo, time signature, sections, tracks with instrument state, device chains, sends, mixer state, return buses, master, assets, and — while it fits — arrangement placements and automation | Structural and arrangement edits |
| `projects/{projectId}/clips/{clipId}` | One clip and its note or audio-loop content | Note and clip-content edits |
| `projects/{projectId}/arrangement/{trackId}` | One track's placements and its track-owned automation lanes | Only when the song document exceeds its budget |

Conventions that hold on every tier:

- **Ownership** lives on the metadata document alone (`ownerId`, `collaboratorIds`). Child documents inherit it and the security rules resolve the parent, so no tier can hold an owner its project disagrees with.
- **Schema version** (`schemaVersion`) is written on every document, so no reader can silently accept state it does not understand.
- **Revision** is on every document. Metadata holds the project's current revision; a child holds the revision it was written at; arrangement chunks always share their song document's revision, which makes a torn multi-document write detectable on read.
- **Timestamps** are integer epoch milliseconds (`createdAt`/`modifiedAt` on metadata, `updatedAt` on children), never Firestore `Timestamp`s — a Firebase type must never reach the domain model, and an integer field still sorts and queries.
- **`projectId`** is repeated on every child document, so a document copied between projects is rejected by both the rules and the decoder.
- The project ID is **not** duplicated as a metadata field: the document path already carries it, and a second copy could disagree.
- **Pack dependencies** belong on the metadata tier for the same reason ownership does: the dashboard, export, and a missing-pack warning need to know what a project requires without loading song state or clip content. See [Packs and pack-qualified assets](#packs-and-pack-qualified-assets) below.

`encodeProject` produces these documents from a `Project`; `decodeProject` reassembles one and runs it through the domain's `parseProject`, so persistence has no second, weaker definition of a valid project.

## Packs and pack-qualified assets

Library content is organized into **packs** (domain invariant 12), and `FND-002b` put that in schema v1. The domain model owns the rules; this section records where the bytes live.

The domain side, in [`src/domain/packs.ts`](../src/domain/packs.ts) and [`entities.ts`](../src/domain/entities.ts):

- A **`Pack`** has a `pak_` ID, name, `major.minor.patch` version, publisher, kind (`factory`, `user`, `third-party`), description, and one rights position covering every asset in it. A pack version is immutable content: republished audio or metadata is a new version. Packs are *library* entities — a project never stores pack records, so nothing in a stored project has to be kept in step with a catalogue.
- An **`Asset`** names its owning `packId` and the `packVersion` it resolved from. Asset identity is therefore pack-qualified: two packs may hold a sound of the same name without collision, and neither is renamed to avoid the other. The storage reference is still not identity (invariant 8).
- A project's **pack dependency list** is `metadata.packDependencies`: one `{ packId, version }` per pack its assets resolve from, at most one version per pack. It is *derived*, by `derivePackDependencies(song)`, and `parseProject` enforces both directions — an asset whose pack is undeclared, a declared version that disagrees with the asset, and a declared pack no asset uses are all rejected. Drift is an invalid project, not a project that quietly over-reports.
- A project's **pack shelf** is `metadata.addedPacks`: the packs the user has *added to this project*, as `{ packId, version }` entries, one version per pack. It answers a different question from the dependency list — "which packs has the user put on the shelf?" rather than "which packs does the project need to open?" — so a user can add a pack, browse it, and not yet use a sound from it, and that pack survives a reload. Unlike `packDependencies` the shelf is *maintained*, by the `pack.add`/`pack.remove` commands, not derived. But it is not free-form: `parseProject` requires it to be a **superset** of the dependency list at matching versions, so every used pack is always shelved. Adding an asset from a new pack shelves that pack automatically (`withDerivedPackDependencies` reconciles the shelf alongside the derived list); removing a pack whose assets are in use is refused, not silently dropped.
- An **unavailable pack** is a reported state, never a dangling reference or a substitution. `resolvePackAvailability(project, availablePacks)` returns the missing packs with the affected tracks and clips named, distinguishes "no version of this pack" from "not the version this project pinned", and never falls back to a version that happens to exist. Presenting that state is `LOOP-013`.

Where a dependency is recomputed:

| Layer | What happens |
| --- | --- |
| Commands | `executeTransaction` re-derives the list once per transaction, before the invariant check, so the recompute is atomic with the edit that changed which packs the project uses. Undo and redo replay through the same path. An unchanged list is passed through by object identity, so a note edit is not mistaken for a metadata change. |
| Persistence | `saveSong` writes the derived list to the metadata document in the same revision-checked write as the song, so the two tiers can never disagree, and reconciles the shelf against it so a newly-used pack is shelved in the same revision. `saveMetadata` cannot set `packDependencies` — `ProjectMetadataPatch` has no such field — but it *can* set `addedPacks`, which is how a `pack.add`/`pack.remove` that touches no song state persists. |
| Rules | `firestore.rules` accepts `packDependencies` and `addedPacks` as lists. It cannot check either against the project's assets without reading the song document, so those checks belong to `decodeProject`/`parseProject`. |
| Dashboard | `buildProjectSummaryProjection` exposes it, so a project row or an export can warn about a missing pack from metadata alone. |

Delivering the shipped library as packs is `CNT-000b`; browsing by pack is `LOOP-013`. Nothing here models installation, entitlement, or purchase — the alpha's packs are all bundled factory packs.

## Size budget and the chunk boundary

`FND-004` owns these numbers; they live in `src/persistence/documentSize.ts`.

| Budget | Value | Why |
| --- | --- | --- |
| Firestore hard limit | 1,048,576 bytes | Platform limit; a larger write always fails |
| Song document | 262,144 bytes (256 KiB) | A quarter of the hard limit. The song document holds the structure a project keeps growing, so a budget near the limit would leave a project one edit away from being unwritable. |
| Arrangement chunk | 262,144 bytes | One track's arrangement is the smallest unit this layout can split, so the budget detects a track that has outgrown the layout rather than triggering a further split |
| Clip document | 262,144 bytes | The highest-frequency write path; kept small on purpose |

Sizes are measured with Firestore's own accounting (document name + field names and values + 32 bytes per document), not with JSON length, so a budget assertion means what it says.

**The chunk boundary.** The song document is built whole. If it exceeds its budget, *all* per-track arrangement content — placements, and automation lanes targeting a track, a device on a track, or one of its sends — moves into `arrangement/{trackId}` documents written at the same revision, and the song document records `arrangementChunked: true` plus the `chunkTrackIds` it wrote. The split is all-or-nothing so a reader has exactly one rule to follow. Automation on returns and the master bus stays in the song document: it is bounded by the number of buses and has no per-track chunk to live in.

Measured against the PRD reference project (50 tracks, ten minutes, 2,500 placements, 100 automation lanes), asserted in `src/persistence/songBudget.test.ts`:

| Document | Bytes |
| --- | --- |
| Song document if the arrangement stayed inline | ~534,000 (over budget — chunking is exercised, not hypothetical) |
| Song document after chunking | 13,501 |
| Largest of the 50 arrangement chunks | 10,718 |
| Largest clip document | 1,408 |
| Metadata document | 309 (including its pack dependency list) |
| `FND-009` slice fixture's song document | 1,078 (no chunks) |

If a *single track* ever exceeds the chunk budget, the write fails with `document_too_large` rather than being silently truncated or split further. Sub-chunking one track's arrangement is deliberately not implemented: no fixture reaches it, and an unproven mechanism is worse than an explicit failure.

## Repository boundary

`ProjectRepository` (`src/persistence/projectRepository.ts`) has two implementations — `InMemoryProjectRepository` for unit, component, and browser tests, and `FirestoreProjectRepository` for production — and both run the same contract suite (`projectRepositoryContract.ts`, executed by `src/persistence/inMemoryProjectRepository.test.ts` and `tests/emulator/firestoreProjectRepository.emulator.test.ts`). The in-memory store keeps *encoded* documents at their real paths, so it exercises the same encoding, chunking, and revision logic; only the transport differs.

Two rules shape the interface:

- **Every write is revision-checked.** The caller states the revision it wrote against; the repository applies the write and returns the new revision, or reports `revision_conflict` and changes nothing.
- **Tiers are written independently.** `saveClip` writes one clip document plus the metadata revision — never song structure.

`FirestoreProjectRepository` runs each revision-checked write in a Firestore transaction so the tier document and the revision bump commit together. Creating a project takes two steps — claim the metadata document, then write the remaining tiers — because the security rules resolve a child's owner from its parent and rule `get()`s see the database as it was before the write commits. If the second step fails, the claimed metadata document is removed rather than left as a project with no song.

Reads report a permission denial as `not_found`, so the API never confirms the existence of a project the caller may not see. A listing the caller is not entitled to comes back empty rather than as an error.

## Autosave

`ProjectAutosave` (`src/persistence/autosave.ts`) implements PRJ-03 and has no SolidJS dependency — it exposes a plain listener a provider can adapt into a signal.

- **Coalescing.** Edits are queued per entity (`song`, `clip:{id}`, `metadata`); a second edit to the same entity replaces the first, so a slider drag produces one write with the final value. The window defaults to 400 ms and uses an injectable `Scheduler` (`src/shared/scheduler.ts`) so tests drive it deterministically.
- **Save state.** `idle → pending → saving → saved`, or `failed` with the underlying failure. `flush()` writes everything immediately and is what a `pagehide` handler calls.
- **Retryable local state.** A failed write stays queued with its value and the drain stops there, so later writes do not burn revisions past a gap. `retry()` writes exactly what the user last saw.
- **Echo rejection.** A remote snapshot at or below the local revision is this client's own echo; one that arrives while a local edit is queued would overwrite state the user can still see. Both are ignored, and the caller is told which.

## Migrations

The current schema is **v2**. v1 was the first production schema; **v2 ([LIB-08](#packs-and-pack-qualified-assets)) added `metadata.addedPacks`, the pack shelf.** `src/persistence/migrations.ts` provides the mechanism and its rules:

- A **newer** schema version is never read and never overwritten — it is reported so the UI can ask the user to update.
- An **older** version is upgraded by applying every registered migration in order; a gap in the chain is an error, not a partial upgrade.
- Migration is pure documents-to-documents, and the result still goes through `decodeProject`.

**Load-time application.** `decodeStoredProject` migrates a stored project forward and then decodes it, and both repositories' `loadProject` call it, so opening a project saved before a field was added never fails just because it predates the field. The dashboard reads only the metadata tier, so `decodeStoredProjectMetadata` applies the metadata half of each migration for `listProjects`/`loadProjectMetadata`/`watchProject`, and a pre-existing project still lists. Migration is read-time and pure: the upgraded project persists at the new version the next time it is saved, not as a side effect of loading.

**The v1 → v2 migration** bumps the `schemaVersion` envelope on every stored tier (metadata, song, arrangement chunks, clips) in lockstep and seeds `addedPacks` from the packs the project already depends on (`metadata.packDependencies`, which v1 stored). A migrated v1 project therefore starts with exactly its used packs on the shelf — satisfying the "every used pack is shelved" invariant on the first read, before any `pack.add`/`pack.remove` runs.

**Fixture convention.** Stored-state fixtures live at `public/fixtures/persistence/v{version}-{name}.json` and hold the `RawProjectDocuments` shape exactly as it was stored; load them with `loadStoredProjectFixture` from `src/testing/fixtures.ts`. `v2-slice-project.json` pins today's wire format — if encoding changes shape, that file stops decoding and the change has to become a deliberate migration. `v1-slice-project.json` is the v1 source fixture the v1 → v2 migration is tested against. `v3-future-project.json` is the unreadable-future-version case. Every migration added after v1 ships a fixture for each supported source version and tests that migrating it produces a valid project (PRJ-04).

## Security rules and indexes

`firestore.rules` enforces the layout: owner-or-collaborator access resolved from the metadata document, no ownership reassignment, no backwards revision, a `song` collection that only accepts `current`, clip and chunk documents whose ID matches their path, and a `projectId` that must match the path a document is written to. Structurally wrong writes — unknown schema version, missing revision, missing pack dependency list or shelf, unexpected metadata field — are rejected by the rules as well as by the decoder. Each child write costs one document read for the parent lookup, which is the price of not duplicating ownership onto every tier.

Anonymous Firebase identities are ordinary identities here (PRJ-01): they own projects exactly like registered users, and upgrading an account keeps the same uid, so no rule distinguishes them.

`firestore.indexes.json` carries the dashboard's composite index (`ownerId` ascending, `modifiedAt` descending) and is wired into `firebase.json`.

Coverage lives in `tests/emulator/` (`bun run test:emulator`): `firestoreRules.emulator.test.ts` for owner, collaborator, anonymous, unauthenticated, deletion, malformed-write, and cross-project cases, and `firestoreProjectRepository.emulator.test.ts` for the repository contract against a real Firestore instance.
