---
name: implement-feature
description: Implement one Solid Groove GitHub issue end to end with the core-flow-first pipeline — verify the prework is done, run the feature workflow, then verify the resulting PR stack is correctly stacked, formatted, and carries a rendering walkthrough. Use when asked to implement a specific issue, e.g. "/implement-feature #123", "implement issue 123", or "build #123".
---

# Implement a feature

Takes one GitHub issue in `afternoon/solid-groove` and drives it through the
core-flow-first pipeline: **verify the prework → run the workflow → verify the
result**. You are the bookend around
`.claude/workflows/solid-groove-feature.js`; the workflow does the building.

Read `CLAUDE.md` ("Core flows are the acceptance contract") and
`docs/core-flows.md` before you start, so the checks below mean something to you
rather than being a list you tick.

## Hard rules

These are not preferences. Each one exists because breaking it is silent and
expensive.

1. **Never edit `.claude/workflows/solid-groove-feature.js`, or any file in
   `.claude/agents/`.** They are human-approved definitions. If the workflow is
   wrong, broken, or missing a stage, **stop and report it** — describe what you
   would change and why, and let the human decide. Do not "just fix it".
2. **Do not route around rule 1.** Copying the script somewhere and running it
   with `scriptPath`, running the stages by hand as individual agents, or
   inlining a modified version all defeat the approval gate as thoroughly as
   editing the file would. If the workflow will not run, that is a report, not an
   obstacle to work around.
3. **Never write `docs/core-flows.md` or `docs/prd.md`.** They belong to the
   product owner. If the preflight fails because a flow is missing or thin, say
   so and stop — **do not make the check pass by authoring the missing flow
   yourself.** A flow you invented is a specification nobody agreed to, and
   everything downstream would then be measured against it.
4. **Never edit a flow spec** (`tests/e2e/emulator/flows/`) during the
   postflight. If a spec is wrong, report it.
5. **Report honestly.** A failed preflight is a normal, useful outcome. A
   preflight you quietly loosened to get to the fun part is not.

## GitHub access

Use whichever this session actually has — the `gh` CLI if it is installed and
authenticated, otherwise the GitHub MCP tools (`mcp__github__*`). Check rather
than assume; both are common and neither is guaranteed. Every command below is
written with `gh` for brevity; the MCP equivalent is fine.

The repository is always `afternoon/solid-groove`.

---

## Stage 1 — Preflight

Resolve the issue number from the argument (`#123`, `123`, or a full issue URL).
If no issue was given, ask for one — do not guess from context.

Then check all of the following. **Every one is blocking.** Run them all before
reporting, so the human gets the complete list of what is missing rather than
one item at a time.

| # | Check | How |
| --- | --- | --- |
| 1 | The issue exists and is **open** | `gh issue view <n> --json number,state,title,body,labels` |
| 2 | Its title is `TASK-ID - Title` | e.g. `LOOP-004 - Synth and one-shot sampler` |
| 3 | It links **at least one** core flow ID matching `CF-\d{3}` | search the body |
| 4 | **Every** linked flow is registered in `docs/core-flows.md` on the **current `main`** | `git fetch origin main` first, then read the file at `origin/main` — not your working copy, which may be stale or carry local edits |
| 5 | Each registered flow entry is **complete**, not a stub: it names an entrypoint, has numbered steps, and states an outcome | read the entries, per the anatomy in `docs/core-flows.md` |
| 5a | Each linked flow has a **spec file on `main`** — `tests/e2e/emulator/flows/<ID>.spec.ts` | the workflow does not write specs; it refuses to start without them, so this is where a missing one surfaces early |
| 6 | The issue has acceptance criteria (checkboxes) | search the body |
| 7 | Every issue in its `blocked_by` graph is **closed** | `gh api repos/afternoon/solid-groove/issues/<n>/dependencies/blocked_by --paginate`, then each blocker's state |
| 8 | It is **not** labelled `human-input-required` | that label marks a decision only a human resolves |
| 9 | No open PR already references or closes it | `gh pr list --search "<n>" --state open` |
| 10 | `bun run verify:core-flows` passes at `origin/main` | a register already out of sync with its specs will only get worse — and since the workflow no longer authors specs, this check is what guarantees the contract exists at all |

Two soft signals worth reporting but not blocking on: the issue carrying the
`blocked` label with an open `DEC-*` blocker (the workflow handles it — the
implementer is told not to guess the decision, and the unmet criteria come back
in the result), and a flow whose steps mention behavior you cannot find anywhere
in the register, the issue, or the code.

**If any blocking check fails**, stop. Report exactly which failed, quote the
relevant part of the issue or register, and say precisely what the human needs to
add — a flow entry, a missing acceptance criterion, a `blocked_by` edge to close.
Do not start the workflow, and do not fix the gap yourself.

**If everything passes**, say so in one short line per check and continue.

---

## Stage 2 — Run the workflow

Invoke the approved workflow, unmodified:

- **Workflow name:** `solid-groove-feature`
- **Args:** `{ "issue": <n> }`

That is the whole of this stage. The workflow verifies that every linked flow is
registered and specced on `main`, implements against that frozen contract,
reviews for up to two rounds, opens the stack, captures the walkthrough and
requests the preview deploy.

It does **not** write the flow specs. The product owner lands the flow entry and
its `test.fixme` spec together in their own reviewed PR before this runs, which
is why preflight checks 4, 5, 5a and 10 are the gate they are. If a linked flow
has no spec on `main`, the workflow returns `blocked-on-missing-contract` without
building anything. It runs in the background and takes a long time — a real feature is
tens of minutes, not seconds.

While it runs: **do not** start your own agents to "help", do not begin
implementing anything, and do not poll it in a loop. Wait for the completion
notification.

If the workflow returns a `status` of `blocked-on-missing-contract` or
`blocked-on-review`, it stopped on purpose. Skip Stage 3, report the blocking findings it returned
verbatim, name the branch it left open, and stop. Do not implement the fixes
yourself and do not re-run the workflow hoping for a different outcome.

---

## Stage 3 — Postflight

The workflow returns the PRs it opened. Verify the stack is actually reviewable —
the workflow's agents report their own work, and this stage exists because a
self-report is a claim.

### The stack

1. **Ordering and bases.** PR 1 is the first implementation slice and has base
   `main` — the flow specs are not part of this stack, having merged separately
   before the run. Every later PR's base is the **previous PR's branch**, not
   `main`. Confirm with `gh pr view <n> --json baseRefName,headRefName` for each.
2. **Issue references.** Every PR body says `Refs #<n>` **except the last**,
   which says `Closes #<n>`. Exactly one PR closes the issue.
3. **Title format.** Every title reads `Implement #<issue> (i/N): Title` — the
   action word, the issue number with its `#`, the PR's 1-based position in the
   stack out of `N`, a colon, then what that slice does. A three-PR stack for
   issue 123 runs `Implement #123 (1/3): ...` through `Implement #123 (3/3): ...`;
   a single-PR task is `(1/1)`. `gh pr view <n> --json title`. Each body also
   names its place ("2/3, builds on #NNN").
4. **Size.** Each PR is ≤400 changed lines, excluding generated files, lockfiles
   and vendored assets. `gh pr view <n> --json additions,deletions`. Report any
   PR over the ceiling — that is a re-slice, and the human's call.
5. **Template sections.** Each body has the sections from
   `.github/pull_request_template.md`, filled in: **What & why**, **Core flows**,
   **Walkthrough**, **Evidence**, **Acceptance criteria met**. An empty section
   or a leftover `<!-- walkthrough pending -->` placeholder is a failure.

### The contract

6. **The specification was not edited.** Across the whole stack,
   `git diff origin/main..<top-branch> -- docs/core-flows.md docs/prd.md` must be
   **empty**. If it is not, that is the most serious thing you can find here:
   report it loudly and do not paper over it.
7. **The flows are live.** On the top branch, `bun run verify:core-flows` passes
   and reports **no** flow still at `test.fixme` for the issue's flow IDs.
8. **The specs were not weakened, or added to.**
   `git diff origin/main..<top-branch> -- tests/e2e/emulator/flows` shows
   only removed `test.fixme` markers, plus any mechanical change the PR body
   explicitly called out and justified. A changed assertion that the body does
   not mention is a failure — and so is a **new** flow spec file, since the
   contract is written before the run, never during it.

### The walkthrough

9. **It is present.** The closing PR's Walkthrough section contains Markdown
   images, unless the stack genuinely changes nothing a user sees — in which case
   it says "No UI change" and the issue's flows should have made that impossible,
   so question it.
10. **The images actually render.** This is the check most worth doing properly,
    because a broken `raw.githubusercontent.com` link renders as a broken-image
    icon and looks, at a glance, like a walkthrough. Extract every image URL from
    the body and fetch each one:

    ```sh
    curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' <url>
    ```

    Every one must be `200`. A `404` usually means `walkthrough:publish` did not
    push, or the branch/issue path in the URL is wrong.

    (This works because `afternoon/solid-groove` is a **public** repository, so
    GitHub's image proxy can fetch the raw URLs anonymously. If the repo is ever
    made private these links will break for everyone — that is a real limitation
    of the mechanism, and worth raising rather than working around.)
11. **The captions match the flow.** Skim them against the flow's numbered steps
    in `docs/core-flows.md`. They should read as the same journey.
12. **The preview was requested.** The closing PR carries the `deploy-preview`
    label, **or** the workflow reported a stated reason it was withheld. The one
    legitimate reason is that the stack touches `firestore.rules` or
    `storage.rules` — a preview runs against production's *current* rules and
    cannot prove a rules change. If the stack does touch either file and the label
    was added anyway, say so: that is a finding, not a nit.

### CI

13. Check the CI status of every PR in the stack (`gh pr checks <n>`). Report
    what is red. Remember that only Chromium runs in an agent container, so CI is
    the cross-browser gate and its result is the real evidence.

---

## What you may fix, and what you may not

**You may fix, then re-verify** — these are mechanical PR metadata, not work:

- a wrong base branch (`gh pr edit <n> --base <branch>`)
- a missing or wrong `Refs`/`Closes` line, or a missing stack position
- a title that does not read `Implement #<issue> (i/N): Title`
  (`gh pr edit <n> --title`)
- a missing `deploy-preview` label on the closing PR, **only** once CI is green
  and only if the stack does not touch `firestore.rules` or `storage.rules`
- a walkthrough that failed to publish: re-run `bun run walkthrough:capture` and
  `bun run walkthrough:publish -- --issue <n>` on the top branch and paste the
  Markdown in

**Report and stop** — these are decisions, not repairs:

- any diff to `docs/core-flows.md`, `docs/prd.md`, or a flow spec's assertions
- a PR over 400 lines, or one doing several unrelated things
- a flow still at `test.fixme` on the closing PR
- red CI that needs a code change
- anything at all that would require editing the workflow or an agent definition

---

## Report

Finish with a compact report the human can act on:

- **Issue** and task ID, one line on what was built.
- **The stack**: each PR as `#N — purpose — base — ±lines — CI status`, in order,
  marking which closes the issue.
- **Postflight**: each numbered check above as pass/fail, with the evidence for
  any failure (the actual diff, the actual HTTP code).
- **Anything the workflow reported as unmet**, verbatim — do not summarise away an
  acceptance criterion the implementer honestly could not close.
- **What to do next**: merge order (bottom of the stack first), and the preview
  URL if the deploy commented one.

End any comment you post on GitHub with a blank line, a `---` rule, then
`_Generated by [Claude Code](https://claude.ai/code)_`.
