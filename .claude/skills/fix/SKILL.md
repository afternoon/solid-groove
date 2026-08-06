---
name: fix
description: Fix one Solid Groove bug issue end to end — triage it for ambiguity, run the fix workflow (reproduce with a failing test, fix, adversarial review), then verify the resulting PR before handing it back. Use when asked to fix a specific bug issue, e.g. "/fix #123", "fix issue 123", or "fix the bug in #123".
---

# Fix a bug

Takes one GitHub issue in `afternoon/solid-groove` that reports a bug and drives
it through **triage → run the workflow → verify the result**. You are the bookend
around `.claude/workflows/solid-groove-fix.js`; the workflow does the fixing.

This is the bug counterpart of `/implement-feature`, and the difference is where
the contract comes from. A feature is measured against core-flow specs written
*before* it. A bug is measured against a regression test written *during* the
fix — so the thing this pipeline protects, everywhere, is that the test genuinely
failed before the fix and failed for the right reason. A test written after a fix,
against the fixed code, tends to assert what the code now does rather than what it
should do; it would have passed before the fix too, and it will not catch the
regression it exists to catch. Most of what follows is in service of that.

Read `CLAUDE.md` ("Landing work", "Definition of done for every task") before you
start, so the checks below mean something to you rather than being a list you tick.

## Hard rules

1. **Never edit `.claude/workflows/solid-groove-fix.js` or any file in
   `.claude/agents/`.** They are human-approved definitions. If the workflow is
   wrong, broken, or missing a stage, **stop and report it** — describe what you
   would change and why, and let the human decide. Do not "just fix it".
2. **Do not route around rule 1.** Copying the script elsewhere and running it
   with `scriptPath`, running the stages by hand as individual agents, or inlining
   a modified version all defeat the approval gate as thoroughly as editing the
   file would. If the workflow will not run, that is a report, not an obstacle.
3. **Never write `docs/prd.md` or `docs/core-flows.md`, and never edit a flow
   spec.** They belong to the product owner. If the bug turns out to be *in* the
   specification, that is the finding — report it.
4. **Do not fix the bug yourself.** Not during triage, not while the workflow
   runs, not to "unblock" a postflight failure. If the pipeline stops, it stopped
   for a reason, and a fix you write by hand skips the adversarial review that is
   the point of the whole thing.
5. **Report honestly.** An ambiguous issue, an unreproducible bug, and a review
   that still requests changes are all normal, useful outcomes. A triage you
   quietly loosened to get to the fun part is not.

## GitHub access

Use whichever this session actually has — the `gh` CLI if it is installed and
authenticated, otherwise the GitHub MCP tools (`mcp__github__*`). Check rather
than assume. Every command below is written with `gh` for brevity; the MCP
equivalent is fine.

The repository is always `afternoon/solid-groove`.

---

## Stage 1 — Triage

Resolve the issue number from the argument (`#123`, `123`, or a full issue URL).
If no issue was given, ask for one — do not guess from context.

Then check all of the following. **Every one is blocking.** Run them all before
reporting, so the human gets the complete list rather than one item at a time.

| # | Check | How |
| --- | --- | --- |
| 1 | The issue exists and is **open** | `gh issue view <n> --json number,state,title,body,labels,comments` |
| 2 | It reports a **bug**, not a feature request | the code does something other than what it was specified to do — if the code does what it was specified to do and the issue wants it specified differently, that is a feature, and `/implement-feature` is the pipeline |
| 3 | It names an **observable wrong behavior** | not "playback feels off"; something you could write an assertion about |
| 4 | The **correct** behavior is stated or derivable | from `docs/prd.md`, a domain invariant in `CLAUDE.md`, or a registered core flow. Quote the source. If nothing says which side of the divergence is right, this is a product decision wearing a bug's clothes — stop |
| 5 | It is **one** bug | several bugs in one issue need one regression test and one PR each; ask for them to be split |
| 6 | It is **not** labelled `human-input-required`, and no open `DEC-*` gates the answer | `gh api repos/afternoon/solid-groove/issues/<n>/dependencies/blocked_by --paginate` |
| 7 | No open PR already fixes it | `gh pr list --search "<n>" --state open` |
| 8 | No branch is already open for it | `git ls-remote --heads origin 'claude/fix-<n>-*'` — a leftover branch from a previous run means the workflow stopped somewhere; find out where before starting again |

**Terseness is not ambiguity.** A two-line report against code where the defect
is obvious is perfectly actionable. Missing reproduction steps only block if you
also could not reproduce it from the description — try first. What blocks is not
knowing the *target*, never not knowing the *cause*: finding the cause is the job.

Do not read the whole codebase here. Read enough to answer checks 2–4 honestly.
The workflow re-triages with its own agent and a full repository read; you are
catching the issues that should never have reached it.

**If any check fails**, stop. Say which failed, quote the relevant part of the
issue, and state precisely what the human needs to add or decide — a stated
expected behavior, a PRD reference, a split into separate issues. Do not start
the workflow, do not fix the gap yourself, and do not post the questions on the
issue unless asked.

**If everything passes**, say so in one short line per check and continue.

---

## Stage 2 — Run the workflow

Invoke the approved workflow, unmodified:

- **Workflow name:** `solid-groove-fix`
- **Args:** `{ "issue": <n> }`

That is the whole of this stage. The workflow triages for ambiguity again, then
reproduces the bug with a failing test, fixes the cause, and runs an adversarial
Opus review with up to two fix rounds — the reviewer independently reverts the
source change and confirms the regression test goes red. Then it opens the PR
ready for review.

It runs in the background and takes a while. While it runs: **do not** start your
own agents to "help", do not begin investigating the bug, and do not poll it in a
loop. Wait for the completion notification.

Three `status` values mean it stopped on purpose. In each case, skip Stage 3,
report what it returned verbatim, and stop:

- **`blocked-on-ambiguous-issue`** — the bug cannot be acted on as written.
  Report the questions it returned, each of which is phrased so a one-line answer
  unblocks the work. Nothing was built and nothing was written to GitHub.
  Answering on the issue and re-running is the next step. **Do not answer the
  questions yourself** — every one of them exists because guessing it produces a
  confident wrong fix with a regression test defending it.
- **`not-reproduced`** — the bug could not be reproduced at any layer. Report
  what was tried and what was observed instead. This is a real finding about the
  report, not a failure of the pipeline, and the right next step is usually more
  detail on the issue, not another run.
- **`blocked-on-review`** — the fix still had blocking findings after two fix
  rounds. The branch is pushed and left open, no PR was opened, and the findings
  were already commented on the issue. Report them verbatim, name the branch, and
  **notify the human directly** — this is the case they asked to hear about. Do
  not implement the fixes yourself and do not re-run hoping for a different
  outcome; a bug that survives two adversarial rounds usually has an undecided
  question underneath it.

---

## Stage 3 — Postflight

The workflow returns the PR it opened. Verify it is actually reviewable — the
workflow's agents report their own work, and a self-report is a claim.

### The evidence

1. **The regression test exists**, at the path the workflow reported, and is part
   of the PR's diff. `gh pr diff <n>` — a fix with no test in the same PR is the
   failure this whole pipeline exists to prevent.
2. **The reviewer verified the red.** The workflow's result carries
   `redVerifiedByReviewer`. It must be `true`. If it is `false` or `null`, the
   central claim of the PR is unverified: say so plainly and treat the PR as not
   ready, whatever else looks fine.
3. **The PR body carries the red→green evidence.** Its **Evidence** section
   contains the verbatim pre-fix failure output, the command that produced it,
   and a statement that the reviewer reproduced it independently. A paraphrase
   ("test failed before the fix") is not evidence.
4. **It is a fix, not a disguise.** Read the diff yourself against the reported
   root cause. A null check on a value that should never have been null, a
   swallowed error, a clamp over a bad upstream computation — each leaves the
   defect in place. If the diff only defends at the boundary, report it; that is
   a decision for the human, not something you repair.

### The PR

5. **Base and state.** Base is `main` (or the previous branch, for a stack), and
   the PR is **ready for review, not draft**. `gh pr view <n> --json baseRefName,isDraft,headRefName`
6. **Title format.** The title reads `Fix #<n> (i/N): Title` — the action word,
   the issue number with its `#`, the PR's 1-based position in the stack out of
   `N`, a colon, then what was broken, not which file changed. A lone PR is still
   numbered `Fix #<n> (1/1): ...`. `gh pr view <n> --json title`.
7. **Issue reference.** The body says `Closes #<n>` — exactly once, on the PR that
   completes the fix. A stack uses `Refs #<n>` on the earlier PRs.
8. **Size and purpose.** ≤400 changed lines excluding generated files, lockfiles
   and vendored assets (`gh pr view <n> --json additions,deletions`), doing one
   thing. A bug fix over the ceiling has usually grown a refactor — report it as a
   re-slice, which is the human's call.
9. **Template sections.** **What & why**, **Core flows**, **Walkthrough**,
   **Evidence**, **Acceptance criteria met**, all filled in. An empty section or a
   leftover `<!-- walkthrough pending -->` placeholder is a failure.

### The specification

10. **Nothing frozen was touched.**
    `git diff origin/main..<branch> -- docs/prd.md docs/core-flows.md e2e/flows e2e-emulator/flows`
    must be **empty**. A bug fix does not edit the specification and does not remove
    a `test.fixme` marker — that belongs to the feature delivering the flow. If it
    is not empty, that is the most serious thing you can find here: report it
    loudly and do not paper over it.
11. **`bun run verify:core-flows` passes** on the branch, with no flow newly
    parked.

### The walkthrough

12. **Present if the fix changes anything a user sees.** If it does not, the
    section says "No UI change" — check that claim against the diff rather than
    accepting it, since it is the cheap way out of this check.
13. **The images render.** A broken `raw.githubusercontent.com` link shows as a
    broken-image icon and looks, at a glance, like a walkthrough. Extract every
    image URL from the body and fetch each:

    ```sh
    curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' <url>
    ```

    Every one must be `200`. A `404` usually means `walkthrough:publish` did not
    push, or the branch/issue path in the URL is wrong.

### CI

14. Check CI (`gh pr checks <n>`) and report what is red. Only Chromium runs in
    an agent container, so CI is the cross-browser gate and its result is the real
    evidence — a green local run is a pre-flight, never gating evidence.

---

## What you may fix, and what you may not

**You may fix, then re-verify** — these are mechanical PR metadata, not work:

- a PR left as a draft (`gh pr ready <n>`)
- a wrong base branch (`gh pr edit <n> --base <branch>`)
- a missing or wrong `Refs`/`Closes` line
- a title that does not read `Fix #<issue> (i/N): Title` (`gh pr edit <n> --title`)
- a missing `deploy-preview` label, **only** once CI is green and only if the
  branch does not touch `firestore.rules` or `storage.rules`
- a walkthrough that failed to publish: re-run `bun run walkthrough:capture` and
  `bun run walkthrough:publish -- --issue <n>` on the branch and paste the
  Markdown in

**Report and stop** — these are decisions, not repairs:

- `redVerifiedByReviewer` not `true`, or a regression test missing from the diff
- a fix that guards the symptom rather than the cause
- any diff to `docs/prd.md`, `docs/core-flows.md`, or a flow spec
- a PR over 400 lines, or one doing several unrelated things
- red CI that needs a code change
- anything at all that would require editing the workflow or an agent definition

---

## Report

Finish with a compact report the human can act on:

- **Issue**, one line on the symptom and the **root cause** the fix identified.
- **The regression test**: path, name, the layer it runs at, and whether the
  reviewer independently reproduced its red. Say it plainly if it did not.
- **The PR**: `#N — purpose — base — ±lines — CI status`, ready or draft.
- **Postflight**: each numbered check above as pass/fail, with the evidence for
  any failure (the actual diff, the actual HTTP code).
- **Anything reported as unresolved**, verbatim — including the same defect found
  elsewhere and deliberately left for its own issue. Do not summarise away a
  known-remaining problem.
- **What to do next**: what a reviewer should look at first, and the preview URL
  if the deploy commented one.

End any comment you post on GitHub with a blank line, a `---` rule, then
`_Generated by [Claude Code](https://claude.ai/code)_`.
