# Solid Groove

So many people want to make music, but learning music production is hard. Let’s make it easier.

The music production tool of the future:

* Is easy to use, with a simple, intuitive interface
* Runs in a browser so you can get started quickly
* Tightly integrates AI, like having your favourite producer right there next to you
* Generates new ideas that you can build on
* Has a library of sounds and other elements
* Is collaborative, so you can work on projects with friends

Let's build it!

## Documentation

| Document | What it covers |
| --- | --- |
| [`CLAUDE.md`](./CLAUDE.md) | Stack, project structure, commands, and code style |
| [`docs/prd.md`](./docs/prd.md) | Product requirements — authoritative for scope and acceptance criteria |
| [`docs/backlog.md`](./docs/backlog.md) | Implementation order, dependencies, and definition of done per task |
| [`docs/sample-library.md`](./docs/sample-library.md) | Sound library plan, licensing policy, and the shipped starter library |
| [`docs/testing.md`](./docs/testing.md) | Which test suite to run, and how |

## Getting started

```sh
bun install
cp .env.example .env   # fill in your Firebase project's values
bun run dev
```

Without a Firebase project of your own, set `VITE_MOCK_BACKEND=true` in `.env` instead — the app runs entirely against in-memory mock services (the same mode the browser E2E suite uses), so local UI work needs no Firebase project at all.

## Deployment

The private alpha has exactly one hosted environment — the **production** Firebase project — deployed to Firebase Hosting from CI on every merge to `main`, never from a developer machine. `bun run deploy` is the one documented command (it builds, scans the build for secrets, then ships Hosting, Firestore rules/indexes, and Storage rules together so a failing rules step fails the whole deploy); `.github/workflows/ci.yml`'s `deploy` job runs it automatically and follows it with a post-deploy smoke test against the real hosted URL. See [`docs/testing.md`](./docs/testing.md#deploy) for the full pipeline, the CI secrets/variables it needs, rollback, and how to get a local build talking to the right project.

## Sounds

The app ships a starter library of 200 one-shots — drums, bass, tonal material, textures, and transitions — synthesized from code rather than downloaded, so it is reproducible in CI and unambiguous to redistribute. Alongside it there is an acquisition path for CC0 content from vetted sources, where each file is individually selected, checksum-pinned, and reviewed.

Content is organized into **packs** — named, versioned collections such as "Techno Drums" or "Orchestral Sounds" that a user browses and a project depends on. The shipped library predates that model and is still one flat collection; [`docs/sample-library.md`](./docs/sample-library.md) section 5.1 defines the model and section 15.7 covers the move.

```sh
bun run library                     # print the whole workflow and what's on disk
bun run library:build               # render + merge the library and its manifest
bun run library:audition            # listen to it at http://127.0.0.1:4180
bun run library:validate            # build and validate without writing (the CI gate)
bun run library:upload              # publish to Cloud Storage
```

Start with `bun run library` — it prints the ordered steps and reports what has
been built, pinned, and ingested so far. Always audition before uploading: the
validator checks that a sound is *well-formed*, only your ears check that it is
*right*.

See [`docs/sample-library.md`](./docs/sample-library.md) section 15 for what it contains and how it is delivered, and [`docs/licenses/starter-library-v1.md`](./docs/licenses/starter-library-v1.md) for its rights position.
