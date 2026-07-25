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

## Sounds

The app ships a starter library of 200 one-shots — drums, bass, tonal material, textures, and transitions — synthesized from code rather than downloaded, so it is reproducible in CI and unambiguous to redistribute. Alongside it there is an acquisition path for CC0 content from vetted sources, where each file is individually selected, checksum-pinned, and reviewed.

```sh
bun run library:acquire -- --plan   # approved CC0 sources and what is pinned
bun run library:build               # render + merge the library and its manifest
bun run library:validate            # build and validate without writing (the CI gate)
bun run library:upload              # publish to Cloud Storage
```

See [`docs/sample-library.md`](./docs/sample-library.md) section 15 for what it contains and how it is delivered, and [`docs/licenses/starter-library-v1.md`](./docs/licenses/starter-library-v1.md) for its rights position.
