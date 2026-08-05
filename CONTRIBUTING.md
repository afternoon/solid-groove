# Contributing to Solid Groove

How to get the app running locally, which backend to run it against, and the
day-to-day loop of checks before you open a pull request.

| You want to | Read |
| --- | --- |
| Get the app running | "Setup" and "Running the app" below |
| Drive the app by hand against a real backend | "Running against the Firebase Emulator" below |
| Know which test suite covers what, and how CI gates | [`docs/testing.md`](./docs/testing.md) |
| Know the stack, code style, and architecture boundaries | [`CLAUDE.md`](./CLAUDE.md) |
| Know what to build and what "done" means | [`docs/prd.md`](./docs/prd.md) and the [GitHub issues](https://github.com/afternoon/solid-groove/issues) |

## Setup

```sh
bun install
cp .env.example .env
```

This project uses **Bun** as its package manager and runtime. Never run
`npm install` — `package-lock.json` conflicts with Bun's resolution and is
gitignored for that reason.

What you put in `.env` depends on which backend you want; see the next section.
`bun run dev` regenerates the starter sound library first (via `predev`), so the
first run is slower than later ones.

### Prerequisites by task

| Doing this | Needs |
| --- | --- |
| Running the app, unit/component tests | Bun only |
| Anything with the Firebase Emulator | A JDK (the emulator runs on the JVM) — CI installs Temurin 21 |
| Browser E2E suites | `bun run test:browser:install` once, and outbound access to `cdn.playwright.dev` |
| `bun run test` on a machine with no audio hardware | A null ALSA output device — see below |

On macOS, `brew install openjdk@21` installs a JDK without needing `sudo`
(unlike the Temurin cask). It is keg-only, so put it on your `PATH` for the
shell that runs the emulator:

```sh
export PATH="$(brew --prefix openjdk@21)/bin:$PATH"
```

### A null ALSA device, on machines with no audio hardware

Do this once per machine or container before `bun run test`. Importing `tone`
creates a real (non-offline) global `AudioContext` as a side effect, and
`node-web-audio-api`'s `cpal` backend refuses to create one when the host has no
default output device. Containers, CI runners, and headless VMs have no
`/dev/snd`, so any suite that reaches Tone fails at import time with:

```
InvalidStateError: cpal backend error during default_output_config: DeviceUnavailable
```

That is an environment problem, not a test bug — do not "fix" it by mocking
Tone, skipping the file, or editing `src/audio/testAudioContext.ts`. Point
ALSA's default PCM at its built-in `null` device instead, which discards every
sample and needs neither audio hardware nor the `snd-dummy` kernel module:

```bash
# Only if the ALSA runtime library is missing (check: dpkg -l libasound2t64)
sudo apt-get update && sudo apt-get install -y libasound2t64

cat > "$HOME/.asoundrc" <<'EOF'
pcm.!default {
    type null
}
ctl.!default {
    type null
}
EOF
```

Use `/etc/asound.conf` (same contents) when the suite runs as a different user
than the one whose `$HOME` you wrote to. A machine with real audio hardware
needs none of this, and `.github/workflows/ci.yml`'s `checks` job runs exactly
these steps.

**This applies to `bun run test` only — not to the browser suites.** The problem
is specific to `node-web-audio-api` under Node, whose `cpal` backend refuses to
*construct* a context without a default output device. A real browser constructs
one regardless: in the emulator browser suite, Firefox reports a fresh
`AudioContext` at `state="suspended"` on a runner with no `/dev/snd` at all. So
if a *browser* test fails around audio, a null ALSA device will not help and its
absence is not the cause — this exact wrong turn has already cost a CI round.
See [`docs/testing.md`](./docs/testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap)
for what is actually known about that failure.

## Running the app

There are three backends you can run against. They are selected entirely by
environment variables — the application code is identical in all three.

| Mode | Backend | Use it for |
| --- | --- | --- |
| **Mock** | In-memory fake, never touches the Firebase SDK | Everyday UI work. No Firebase project, no emulator, no JDK. |
| **Emulator** | The *real* Firebase SDK against a local Firestore + Auth emulator | Anything touching persistence, auth, or security rules |
| **Real project** | A Firebase project you own | Rarely needed; the alpha's only hosted environment is production |

### Mock backend (the default for UI work)

Set `VITE_MOCK_BACKEND=true` in `.env`, then:

```sh
bun run dev     # http://localhost:3000
```

Every page load gets a fresh, empty store, so this mode **cannot** show you
anything about persistence — a reload always starts over. That is the one thing
it is structurally unable to prove, and the reason the emulator mode below
exists.

### Running against the Firebase Emulator

This points the real Firebase SDK at a local Firestore + Auth emulator, so a
genuine page reload round-trips through real persistence and real security
rules. It is distinct from `VITE_MOCK_BACKEND`, which swaps in a fake instead.

Start the emulator in one terminal and leave it running:

```sh
firebase emulators:start --only firestore,auth --project demo-solid-groove
```

The `demo-` project-ID prefix is Firebase's convention for emulator-only work:
no real GCP project, no login, and no credentials are involved, and the CLI
refuses to reach any non-emulated service for it.

Then start the dev server in a second terminal, pointed at it:

```sh
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
VITE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
VITE_FIREBASE_PROJECT_ID=demo-solid-groove \
VITE_FIREBASE_API_KEY=demo-key \
VITE_FIREBASE_APP_ID=demo-app \
bun run dev
```

Open <http://localhost:3000>, click "Start in your browser", and you are an
anonymous Firebase user in the emulator. Create a project, edit it, and reload
the page — the edit comes back from Firestore.

Some notes on the recipe, each of which is a real trap:

- **`VITE_MOCK_BACKEND` must not be `true`.** Leave it unset or set it to
  anything else; the code tests for the exact string `"true"`. If you have it
  set in `.env` for everyday work, override it on the command line.
- **The three `VITE_FIREBASE_*` values are required, and their contents do not
  matter.** `src/firebaseConfig.ts` only substitutes placeholder values in mock
  mode, so outside it `initializeApp` receives `undefined` and fails. Any
  non-empty strings work against an emulator.
- **Use `127.0.0.1`, not `localhost`.** Both emulators listen on `127.0.0.1`
  only, so on a host where `localhost` resolves to `::1` first the connection is
  refused. This is also the form `firebase.json` and the Playwright emulator
  config use.
- **The Emulator UI is off.** `firebase.json` sets `emulators.ui.enabled` to
  `false`. To browse the data, either flip that flag or query the emulator's
  REST API directly with the owner bearer token, which bypasses security rules:

  ```sh
  curl -s -H "Authorization: Bearer owner" \
    "http://127.0.0.1:8080/v1/projects/demo-solid-groove/databases/(default)/documents/projects"
  ```

  Without that header the request is subject to `firestore.rules` and is
  correctly denied — a `PERMISSION_DENIED` from plain `curl` means the rules are
  working, not that the write failed.
- **Emulator data is in memory.** Stopping the emulator discards everything. Use
  `--import`/`--export-on-exit` if you want a scenario to survive a restart.
- **The first project you open is slow.** Vite pre-bundles `tone` when the
  editor first mounts, which force-reloads the page. Give the first
  dashboard→editor navigation a few seconds before concluding something is
  broken; see [`docs/testing.md`](./docs/testing.md#why-this-suite-warms-the-dev-server-first).

### Against a real Firebase project

Fill in the `VITE_FIREBASE_*` values in `.env` from the Firebase console
(Project Settings → General → Your apps) and run `bun run dev`. You rarely want
this: the alpha's only hosted environment is production, deployment runs from CI
rather than a developer machine, and the automated suites must never write to it
(PRD `OPS-01`). Prefer the emulator.

## The day-to-day loop

```sh
bun run dev            # dev server
bun run test:watch     # unit + component tests, watching
```

Before pushing:

```sh
bun run check          # tsc --noEmit && biome check --write  (auto-fixes)
bun run test           # unit + component suites
```

`bun run check` is the local form; CI runs `check:ci`, which is the same checks
without `--write` so a violation fails loudly instead of being silently
rewritten in the runner.

Run the heavier suites when your change touches what they cover — browser,
Firebase, audio, performance, or export behavior:

```sh
bun run test:emulator          # Firestore rules + repository contract
bun run test:browser           # Playwright, mock backend
bun run test:browser:emulator  # Playwright against a real (emulated) backend
```

Both emulator suites start and stop their own emulator via
`firebase emulators:exec`, so do **not** have one already running on those ports
when you launch them. [`docs/testing.md`](./docs/testing.md) is the reference for
what each suite covers and how CI gates on them.

### Other commands

```sh
bun run build          # production build
bun run start          # serve a production build
bun run clean          # delete build/dev caches and test output
bun run library        # print the sound-library workflow and on-disk state
```

Reach for `bun run clean` when the dev server serves something that disagrees
with your checkout — most recognisably, a route that matches but renders a blank
page with no error in either the console or the terminal. Vite's pre-bundling
cache lives inside `node_modules/` and survives `git checkout`, `bun install`,
and dev-server restarts. [`docs/testing.md`](./docs/testing.md#bun-run-clean-and-the-stale-cache-failure-it-exists-for)
has the full symptom list.

## Opening a pull request

The rules that govern scope, size, and landing order live in
[`CLAUDE.md`](./CLAUDE.md#task-tracking-and-landing-work) — read that section
before starting a task, not after. In short:

- Work is tracked as **GitHub issues**; the issue is the specification and the
  live record, and readiness is its native `blocked_by` graph.
- A PR is **one reviewable unit of purpose** and at most **400 changed lines**.
  A larger task ships as a stack of such PRs.
- Tests for a slice ship **in the same PR** as that slice.
- Any change that alters the UI includes a **walkthrough** in the PR body; see
  [`.github/pull_request_template.md`](./.github/pull_request_template.md).
- Don't edit `docs/prd.md` unless the task genuinely revises product behavior.

The full definition of done, including the analytics and privacy requirements
every user-facing change carries, is in
[`CLAUDE.md`](./CLAUDE.md#definition-of-done-for-every-task).
