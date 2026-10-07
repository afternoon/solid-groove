# Linear: the board, and how it drives the automation

Work is tracked as issues in Linear, team **GRV**, project **Groove**
(`https://linear.app/ben2/project/groove-f835b9ea1a25`). The code, the pull
requests and the Actions stay on GitHub. This page is the operator's view: how
the two are wired, how to set a workspace up, how the GitHub issues were
migrated, and what to do when the poll is behind. The rules of the board
itself are in [`CLAUDE.md`](../CLAUDE.md#the-board).

## How Linear and GitHub are wired

Linear cannot call GitHub Actions, and the product side is deliberately not
coupled to the dev side (an outage in one must not take the other down), so
nothing listens for Linear webhooks. Instead `.github/workflows/board.yml`
**polls Linear every five minutes** (`.github/scripts/board.mjs poll`) and
starts whatever the columns ask for. Every rule is stateless: it reads the
card's own column, history and comments, so a poll that runs twice does the
work once.

| You do, in Linear | Within five minutes |
| --- | --- |
| Move a card to **Ready** | It moves to In Progress, a "Picking this up" comment appears on it, and `/ship` runs on it in Actions |
| Move a card to **Approved** | Every open PR that refers to it (`Closes`, `Completes`, `Refs GRV-<n>`) is labelled `status:approved` and queued to merge |
| Move a card with open PRs back to **In Progress** (from QA, Ready For Review or Blocked) | A rework agent fixes those PRs in place, after announcing itself on the card |
| Comment `@claude …` on a card | A Claude run replies "Picking this up" under your comment and does what it asks |
| File a bug with no milestone | A short run puts it on the milestone of its area |

GitHub events move cards the other way, at once (`board.mjs pr`, `merge.mjs`,
`ci-failure.sh`): a PR whose body `Closes GRV-<n>` opening moves the card to
QA (Ready For Review if it changes the security rules); a PR that `Completes
GRV-<n>` merging moves it to QA; a PR that `Closes GRV-<n>` merging moves it
to Done; a gated PR opening moves it to Ready For Review; a merge-queue
failure moves it to In Progress. The QA bot ([`docs/qa-bot.md`](./qa-bot.md))
moves a card out of QA.

Everything that reads or writes Linear goes through
`.github/scripts/linear.mjs`, a small GraphQL client that is also the CLI the
agents use (`node .github/scripts/linear.mjs issue GRV-12`, `comment`, `state`,
`create`, …; run it with no arguments for the list). It needs `LINEAR_API_KEY`.

**Latency.** Five minutes is the shortest schedule GitHub runs, and a busy
hour can stretch it. If a card you moved shows no "Picking this up" comment
after ten minutes, look at the Board workflow's runs; "Run workflow" on it
polls at once.

**Identity.** The key is a personal API key, so the automation's comments and
moves appear under that person's name. The comments it writes all start with
"**Picking this up**", which is how the poll tells its own announcements from
yours. Do not start a comment of your own with those words.

## Columns

The team's workflow states, in order, are the board's columns: Backlog, Ready,
In Progress, Blocked, QA, Ready For Review, Approved, Done (completed),
Canceled (canceled) and Duplicate (duplicate). Their names are a contract:
`.github/scripts/linear.mjs` lists them in `STATES`, and a renamed column
breaks the poll. The set is per team, which is why Groove has a team of its
own.

Milestones are **project milestones** on the Groove project (`M1: …`, `M2:
…`). A feature with no milestone is unscheduled; a bug always gets one.

A card labelled `qa-sweep` is a record, not work: the QA sweep's run log.
Leave it in Backlog; the poll and the sweep ignore it.

## Labels

Team labels carry over from GitHub: `bug` (Linear's built-in `Bug`; the scripts match labels ignoring case), `polish`, `refactor`, `contract`,
`decision`, `documentation`, `needs-shaping`, `human-input-required`,
`parked`, `qa-sweep`. `status:*` labels no longer exist: the column is the
status. On GitHub, `status:approved`, `needs-approval`, `hold`,
`deploy-preview` and `merge-conflict` are still **PR** labels, and mean what
they always did.

## Setting up

1. **Linear.** Create (or pick) a team dedicated to the project and a project
   in it. Make a personal API key (Settings → Security & access → Personal API
   keys). Then:

   ```sh
   LINEAR_API_KEY=… node scripts/linear/setup-team.mjs --dry-run   # what it would change
   LINEAR_API_KEY=… node scripts/linear/setup-team.mjs             # states, default state, milestones, labels
   ```

   `LINEAR_TEAM` (default `GRV`) and `LINEAR_PROJECT` (the project's slug id,
   the hex after the project name in its URL; default `f835b9ea1a25`) point
   the scripts elsewhere.

2. **GitHub.** Add the key as the repository secret `LINEAR_API_KEY`
   (Settings → Secrets and variables → Actions). Every workflow that touches
   a card reads it: `board.yml`, `merge.yml`, `ci-failure.yml`, `ci.yml`
   (the daily browser-pass report) and `qa-sweep.yml`. The existing
   `RESTACK_TOKEN` is still what pushes and labels PRs.

3. **Linear's GitHub integration** (Settings → Integrations → GitHub),
   installed on `trygroove/groove`, so a PR whose title, body or branch
   mentions `GRV-<n>` shows on the card. Under its **workflow automation**
   settings switch **off** every state change it offers (on PR open, review,
   merge): the board moves cards by its own rules, and the integration's
   would fight them (it would mark a `Completes` PR's card done on merge,
   skipping QA). Linking only.

4. **Claude Code cloud sessions** that work cards need `LINEAR_API_KEY` in the
   environment's secrets; a session started after it was added picks it up.

5. **The QA bot** needs its own key and the instructions in
   [`docs/qa-bot.md`](./qa-bot.md).

## Migrating from GitHub issues

`scripts/linear/migrate-from-github.mjs` copies every open GitHub issue into
the team, once, and can be run again after a partial run (an issue already
migrated is updated, not duplicated). It keeps the title, body and creation
date, folds the GitHub comments into the description under "Notes from
GitHub", copies labels and the milestone, sets the column from the `status:*`
label, rewrites `#123` references to the migrated card's identifier, turns
the `blocked_by` graph into blocking relations, and links back to the GitHub
issue in a footer. `status:ready` becomes Backlog unless `--keep-ready`: the
cutover must not start a build nobody asked for that day.

```sh
LINEAR_API_KEY=… node scripts/linear/migrate-from-github.mjs --dry-run
LINEAR_API_KEY=… node scripts/linear/migrate-from-github.mjs
```

It needs `gh` with read access to the repository (REST only).

**Cutover order.** (1) Run `setup-team.mjs`. (2) Run the migration. (3) Add
the repository secret. (4) Merge the PR that carries this page: from then on
`board.yml` polls Linear and the `status:*` labels on GitHub do nothing. (5)
Install the GitHub integration, linking only. (6) Give the QA bot its key and
new instructions. The GitHub issues can be closed or left as an archive at
leisure; nothing reads them any more.

**What the migration does not carry.** Closed issues (a blocker that was
closed is done, so the relation is dropped), the pinned Board issue, GitHub
reactions and assignees, and the per-comment identity of the automation's
own comments (they read as notes from the account that posted them).
