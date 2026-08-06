export const meta = {
  name: 'solid-groove-fix',
  description:
    'Fix one Solid Groove bug issue: triage it for ambiguity, reproduce it with a failing test, fix the cause, survive an adversarial review, and open the PR',
  whenToUse:
    'Run to fix ONE bug issue in afternoon/solid-groove. Pass the issue number: { issue: 123 } (or just 123). The pipeline reads the issue and stops if the bug is ambiguous rather than guessing what "correct" means; then a fixer reproduces it with a test that fails first, fixes the root cause, and an adversarial Opus review runs with up to two fix rounds. If the review still requests changes after those rounds it stops, leaves the branch open and comments the findings on the issue. Otherwise it opens the PR. Use solid-groove-feature for a feature task with core flows, not this.',
  phases: [
    { title: 'Triage', detail: 'read the issue; stop if the bug is ambiguous' },
    { title: 'Fix', detail: 'reproduce with a failing test, then fix the cause' },
    { title: 'Review', detail: 'adversarial Opus review, up to two fix rounds' },
    { title: 'Land', detail: 'open the pull request' },
    { title: 'Walkthrough', detail: 'capture screenshots if the fix changes the UI' },
  ],
}

// Why this is a separate pipeline from `solid-groove-feature`, rather than a flag
// on it: a feature is measured against a contract written before it (the core
// flows), and a bug fix is measured against a contract written *during* it (the
// regression test). Those need opposite safeguards. The feature workflow's whole
// job around the contract is to check it already exists and refuse to author it;
// this workflow's job is to make sure the test gets authored at all, is red for
// the right reason before the fix, and is verified as red by someone other than
// the agent that wrote it.
//
// The failure mode that motivates the red-first rule: an agent writes the fix,
// then writes a test that passes, and reports both. A test written after a fix,
// against the fixed code, routinely asserts what the code now does rather than
// what it should do — and it would have passed before the fix too. It reads as
// coverage and is worth nothing. So the fixer is required to keep the *verbatim*
// failure output, and the reviewer is required to reproduce that red itself by
// reverting the source change and running the test.
const BASE_BRANCH = 'main'

// Two fix rounds, i.e. up to three reviews: review -> fix -> review -> fix ->
// review. If the third review still has blocking findings the pipeline stops
// rather than grinding — a bug that survives two adversarial rounds is usually
// mis-scoped or has an undecided answer underneath it, and another round of the
// same loop will not surface that. A human will.
const MAX_FIX_ROUNDS = 2

// Agents read their own definition from the repo: the agent registry is read once
// at session start, so `agentType` cannot resolve a definition added or edited in
// the same session, and these are edited often.
const FIXER = '.claude/agents/solid-groove-bug-fixer.md'
const REVIEWER = '.claude/agents/solid-groove-reviewer.md'
const brief = (path) => `Read \`${path}\` and follow it as your operating instructions for this task.\n\n`

// Kept verbatim from solid-groove-feature.js so the workflows cannot drift on
// environment facts. Each of these four traps has already cost a run.
const WORKTREE = `## Your worktree

You are in a git worktree, not the main checkout. Two things follow:

- \`cd "$(git rev-parse --show-toplevel)"\` first, and use paths relative to that root. An absolute \`/home/user/solid-groove/...\` path points at a different checkout and will silently mislead you.
- Your worktree starts at an older commit than \`${BASE_BRANCH}\`, and a branch already checked out in the main worktree cannot be checked out here at all. Always branch from a remote ref, never from a local branch and never from wherever your worktree happens to start. Confirm before you start work that your base is an ancestor of HEAD, and never pipe a git command through \`tail\` or \`head\` in an \`&&\` chain — it hides the exit code and a failed checkout looks like a success.

## Environment setup, before your first test run

- **\`bun install\` in your worktree.** A fresh worktree has no \`node_modules\`, and the failure does not look like a missing install: \`bun run typecheck\` reports \`TS2688: Cannot find type definition file for '@testing-library/jest-dom'\`, which reads like a broken tsconfig. It is not. Never "fix" it by editing \`tsconfig.json\`'s \`types\` array.
- **Audio tests need a default ALSA device.** Importing \`tone\` on a host with no \`/dev/snd\` throws \`InvalidStateError: cpal backend error during default_output_config: DeviceUnavailable\` and fails ~8 suites under \`src/audio/\` at load time. \`.claude/hooks/session-start.sh\` writes a null-PCM \`~/.asoundrc\` at session start; if those suites fail that way, recreate it:
  \`\`\`sh
  printf 'pcm.!default {\\n    type null\\n}\\nctl.!default {\\n    type null\\n}\\n' > ~/.asoundrc
  \`\`\`
  This is an environment gap, never a defect in the code under test. Do not skip, delete, or weaken an audio suite to get a green run.
- **Only Chromium runs here; CI is the browser gate.** This container cannot reach Playwright's CDN, so Firefox and WebKit cannot be installed. Run \`bun run test:browser:chromium\` and \`bun run test:browser:emulator:chromium\`. CI runs the full matrix on every push to \`${BASE_BRANCH}\` and \`claude/**\`, so **pushing your branch is the cross-browser check**. A green Chromium-only run is a pre-flight, never PRD section 10 gating evidence — do not report it as one.

`

const attribution = `End every issue comment and PR body with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.`

const gh = `Use the **\`gh\` CLI** for every GitHub read and write — it is already authenticated. There is no GitHub MCP server in this environment; do not look for \`mcp__github__*\` tools.`

const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['issue', 'title', 'slug', 'ambiguous', 'ambiguities', 'expected', 'actual', 'reproduction', 'changesUi'],
  properties: {
    issue: { type: 'number' },
    title: { type: 'string' },
    slug: {
      type: 'string',
      description: 'Short lowercase kebab-case summary of the bug for the branch name, e.g. "loop-length-off-by-one". No issue number.',
    },
    ambiguous: {
      type: 'boolean',
      description: 'True if the issue cannot be acted on without a human answering something. See the listed tests.',
    },
    ambiguities: {
      type: 'array',
      description: 'One entry per thing a human must answer. Empty if ambiguous is false.',
      items: {
        type: 'object',
        required: ['question', 'why'],
        properties: {
          question: { type: 'string', description: 'The question, asked so a one-line answer unblocks the fix' },
          why: { type: 'string', description: 'What cannot be decided without it, and what would go wrong if it were guessed' },
        },
      },
    },
    expected: { type: 'string', description: 'The correct behavior, and where it is stated (PRD requirement, invariant, flow step)' },
    actual: { type: 'string', description: 'The reported wrong behavior' },
    reproduction: { type: 'string', description: 'How to observe it, and the lowest layer at which it is observable' },
    suspects: { type: 'array', description: 'Files or modules the defect plausibly lives in', items: { type: 'string' } },
    changesUi: { type: 'boolean', description: 'True if fixing it will change something a user sees' },
    flows: {
      type: 'array',
      description: 'Core flow IDs (CF-nnn) whose behavior this bug affects, whether or not the issue names them',
      items: { type: 'string' },
    },
    decisionBlockers: { type: 'array', description: 'Open DEC-* decision issues gating this, by DEC id', items: { type: 'string' } },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  required: ['reproduced', 'branch', 'rootCause', 'summary', 'regressionTest', 'checksRun', 'unresolved'],
  properties: {
    reproduced: { type: 'boolean', description: 'False if the bug could not be reproduced at any layer' },
    branch: { type: 'string', description: 'The branch pushed. Empty if nothing was pushed.' },
    extraBranches: {
      type: 'array',
      description: 'Further branches, in stack order, only if the fix genuinely could not fit in one ≤400-line PR',
      items: { type: 'string' },
    },
    rootCause: { type: 'string', description: 'The cause in one sentence, naming the file and the defect' },
    summary: { type: 'string', description: 'What was changed and why that is the cause, not the symptom' },
    regressionTest: {
      type: 'object',
      required: ['path', 'name', 'redEvidence', 'redProducedBy'],
      properties: {
        path: { type: 'string' },
        name: { type: 'string', description: 'The test name, as a runner would print it' },
        redEvidence: {
          type: 'string',
          description: 'The VERBATIM failure output from running this test without the fix. Not a description of it.',
        },
        redProducedBy: {
          type: 'string',
          description: 'The exact command and state that produced that output, e.g. "stashed src/x.ts, ran bun run test src/x.test.ts"',
        },
        layer: { type: 'string', description: 'unit | component | emulator | browser' },
      },
    },
    changedLines: { type: 'number', description: 'Added + deleted, excluding generated files and lockfiles' },
    changesUi: { type: 'boolean' },
    checksRun: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'passed'],
        properties: { command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
      },
    },
    alsoAffected: { type: 'array', description: 'The same defect found elsewhere: fixed here, or reported for its own issue', items: { type: 'string' } },
    unresolved: { type: 'array', description: 'Anything about this bug left unfixed, with the reason', items: { type: 'string' } },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['approved', 'blocking', 'redVerified'],
  properties: {
    approved: { type: 'boolean' },
    redVerified: {
      type: 'boolean',
      description: 'True only if YOU reverted the source change, ran the regression test, and saw it fail for the reported reason',
    },
    redVerificationDetail: { type: 'string', description: 'How you verified it, and what you actually saw' },
    blocking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'issue', 'failure', 'resolution'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          issue: { type: 'string' },
          failure: { type: 'string', description: 'Concrete input/state to wrong output or corruption' },
          resolution: { type: 'string' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
}

const PR_SCHEMA = {
  type: 'object',
  required: ['pullRequests'],
  properties: {
    pullRequests: {
      type: 'array',
      description: 'Every PR opened, in stack order',
      items: {
        type: 'object',
        required: ['number', 'url', 'branch', 'purpose'],
        properties: {
          number: { type: 'number' },
          url: { type: 'string' },
          branch: { type: 'string' },
          purpose: { type: 'string' },
          closesIssue: { type: 'boolean' },
          changedLines: { type: 'number' },
        },
      },
    },
    blocker: { type: 'string', description: 'Set if a PR could not be opened, e.g. a slice over 400 lines' },
  },
}

const WALKTHROUGH_SCHEMA = {
  type: 'object',
  required: ['captured', 'published', 'labelled'],
  properties: {
    captured: { type: 'boolean' },
    published: { type: 'boolean', description: 'True if the images reached claude/walkthroughs and the PR body was updated' },
    labelled: { type: 'boolean', description: 'True if deploy-preview was added to the PR' },
    flows: { type: 'array', description: 'Flow IDs captured', items: { type: 'string' } },
    detail: { type: 'string', description: 'What happened, especially anything that failed' },
  },
}

// ---------------------------------------------------------------------------
// Stage 1 — Triage.
//
// The point of this stage is to make "I do not know what correct looks like" a
// first-class outcome. Left implicit, an agent handed a thin bug report will
// invent the expected behavior, fix the code to match it, and write a test
// asserting it — producing a confident, tested, wrong answer that now has a
// regression test defending it. That is strictly worse than stopping.
//
// It is read-only and it is allowed to read the codebase, not just the issue: a
// terse report against code where the defect is obvious is not ambiguous, and
// bouncing it back to the human would be its own kind of failure.

const triagePrompt = (issue) => `Triage \`afternoon/solid-groove\` issue **#${issue}** as a bug report. ${gh} This is **read-only** — change nothing, comment nothing, and do not create a branch.

Read the issue in full with \`gh issue view ${issue} --comments\`. Then read enough of the repository, \`docs/prd.md\` and \`docs/core-flows.md\` to judge whether the bug can be acted on. Fetch \`origin/${BASE_BRANCH}\` and read the code there.

Your one hard judgement is \`ambiguous\`. Set it **true** if any of these hold:

1. **The symptom is not identifiable.** You cannot tell what observable behavior is wrong, or the report describes a feeling ("playback feels off") with nothing you could assert.
2. **The correct behavior is not stated and not derivable.** Neither the PRD, a domain invariant in \`CLAUDE.md\`, nor a registered core flow says which side of the divergence is right. This is a product decision wearing a bug's clothes.
3. **It is a feature request.** The code does what it was specified to do, and the issue wants it specified differently.
4. **Materially different fixes are equally defensible** and the issue gives you no way to choose — e.g. a value could be corrected at the source or clamped at the boundary, and the two produce different behavior elsewhere.
5. **An open \`DEC-*\` decision gates the answer** (check the native \`blocked_by\` graph: \`gh api repos/afternoon/solid-groove/issues/${issue}/dependencies/blocked_by\`).
6. **The issue is several bugs.** Each needs its own regression test and its own PR.

Set it **false** — and do not manufacture doubt — when the symptom is identifiable and the correct behavior is stated or plainly derivable, even if the report is terse, the reproduction steps are thin, or you do not yet know where the defect lives. Not knowing the cause is the job. Not knowing the target is the blocker.

A missing reproduction is only ambiguous if you also could not reproduce it yourself from the description. Try before you report.

Return, in \`ambiguities\`, one entry per thing a human must answer, each phrased so a one-line reply unblocks the work, with what specifically cannot be decided without it. If \`ambiguous\` is false, return an empty array.

Also return: \`expected\` (and where it is stated — quote the PRD requirement or invariant), \`actual\`, \`reproduction\` and the lowest layer at which the bug is observable, \`suspects\` (files or modules the defect plausibly lives in — a hypothesis, clearly not a conclusion), \`changesUi\`, \`flows\` (core flow IDs whose behavior this affects, whether or not the issue names them), \`decisionBlockers\`, and \`slug\`: a short kebab-case summary of the bug for a branch name.

Read every value from GitHub and from the repository at \`origin/${BASE_BRANCH}\`. Do not guess any of it.`

// ---------------------------------------------------------------------------
// Stage 2 — Fix.

const decisionBlocked = (decisions) => `

## Blocked on a product decision

This bug touches ${decisions.map((d) => `\`${d}\``).join(' and ')}, which ${decisions.length > 1 ? 'have' : 'has'} **not been decided**. Fix only what does not depend on ${decisions.length > 1 ? 'them' : 'it'}, and report the rest in \`unresolved\` naming the decision. Do not pick a plausible default — a confident implementation of an undecided policy is worse than an honest gap, because nothing later flags it as unreviewed.`

const fixPrompt = (t) => `${brief(FIXER)}Fix the bug reported in \`afternoon/solid-groove\` issue **#${t.issue}** — ${t.title}.

${gh}

## The bug, as triaged

- **Expected:** ${t.expected}
- **Actual:** ${t.actual}
- **How to observe it:** ${t.reproduction}
${t.suspects?.length ? `- **Hypothesis, not a conclusion:** the defect may be in ${t.suspects.join(', ')}. Verify or discard it; do not start from the assumption that it is right.\n` : ''}${t.flows?.length ? `- **Core flows affected:** ${t.flows.join(', ')}. Those specs are frozen and are not yours to edit, including their \`test.fixme\` markers.\n` : ''}
Read the issue yourself with \`gh issue view ${t.issue} --comments\` — the triage above is a summary, and the issue is the report.${t.decisionBlockers?.length ? decisionBlocked(t.decisionBlockers) : ''}

## The regression test is the deliverable, as much as the fix

Reproduce the bug with a test **that you watch fail before the fix exists**, at the lowest layer that actually reproduces it. Keep the **verbatim** failure output and the exact command and state that produced it — a reviewer will reproduce that red itself by reverting your source change, and a test that turns out to pass without the fix is a blocking finding no matter how good the fix is.

Confirm it fails for the *right reason*: a test red on a missing import or a typo'd selector is red for something that is not this bug, and will be green forever once that typo is fixed.

If you cannot reproduce the bug at any layer, **stop, push nothing, and report \`reproduced: false\`** with what you tried and what you saw instead. That is a useful outcome. A speculative fix is not.

${WORKTREE}Branch off \`origin/${BASE_BRANCH}\` as \`claude/fix-${t.issue}-${t.slug}\`. Commit the failing test before the fix so the red→green transition is visible in the history. Push the branch. **Do not open a pull request** — a reviewer runs before it is opened. Do not close the issue.

Keep it to **one PR's worth of change, ≤400 changed lines**, doing one thing. If it genuinely cannot fit, stack the slices (each branched off the previous, each green on its own commit) and report them in \`extraBranches\` — but check first that the fix has not grown a refactor, which is the usual cause.

${attribution}

Report the branch, the root cause in one sentence, the regression test's path and name, its verbatim red output and how you produced it, the commands you ran with their real results, whether the fix changes anything a user sees, and anything left unresolved.`

// ---------------------------------------------------------------------------
// Stage 3 — Review.
//
// The reviewer definition is the feature reviewer, reused deliberately: its
// checks on contracts, invariants, resource lifecycle, scope and PR size apply
// unchanged to a bug fix, and forking a near-copy would let the two drift. What
// is bug-specific is layered on here.

const reviewPrompt = (t, fix, round) => `${brief(REVIEWER)}Review the bug fix for issue #${t.issue} — ${t.title}. Branch: \`${fix.branch}\`${fix.extraBranches?.length ? ` (stacked: ${[fix.branch, ...fix.extraBranches].join(' -> ')})` : ''}.${
  round > 1 ? `\n\nThis is review round ${round}. A previous round returned blocking findings which the fixer has since addressed. Verify the fixes rather than assuming them, and check that fixing them did not introduce something new.` : ''
}

This is a **bug fix**, not a feature. Your checks on published contracts, the PRD section 9.5 invariants, resource lifecycle, scope and PR size apply unchanged. Check 2a — the frozen acceptance contract — narrows to one thing: \`git diff origin/${BASE_BRANCH}..${fix.branch} -- docs/core-flows.md docs/prd.md e2e/flows e2e-emulator/flows\` should be **empty**. A bug fix does not edit the specification and does not remove a \`test.fixme\` marker; either is blocking.

Four checks are specific to this pipeline, and the first is the one that matters most:

1. **Verify the red yourself. Do not take it on trust.** The fixer reports that this test failed before the fix:

   - Test: \`${fix.regressionTest?.path ?? '(none reported)'}\` — ${fix.regressionTest?.name ?? '(unnamed)'}
   - Reported command: ${fix.regressionTest?.redProducedBy ?? '(not reported)'}
   - Reported failure output:
   \`\`\`
   ${fix.regressionTest?.redEvidence ?? '(none reported)'}
   \`\`\`

   Revert the **source** change while keeping the test (\`git checkout origin/${BASE_BRANCH} -- <the source files it touched>\`, or revert the fix commit and keep the test commit), and run the test. It must fail, and it must fail on **this bug's symptom** — not on a missing import, a type error from the reverted code, or an unrelated setup failure. Set \`redVerified\` truthfully and describe in \`redVerificationDetail\` what you actually did and saw.

   A regression test that passes without the fix is **blocking**, whatever else is right: it is the difference between a fix that is proven and one that is merely asserted, and it will not catch the regression it exists to catch. So is a test that fails for a reason unrelated to the bug.

2. **Is it a fix or a disguise?** The reported root cause is: ${fix.rootCause}. Check the diff against it. A null check on the consumer of a value that should never have been null, a swallowed error, a clamp over a bad upstream computation — each leaves the defect in place and removes the signal that would have found it. If the diff defends at the boundary without addressing the cause, that is blocking, and say what the cause actually is.

3. **Is the test at the right layer, and would it survive?** An E2E test standing in for a unit-testable domain bug costs every future run and asserts less. A test pinned to the exact code path the fix took, rather than to the behavior the user gets, will go green on a rewrite that reintroduces the bug.

4. **Is it minimal?** A bug fix carrying a refactor is two changes the reviewer cannot separate. Unrelated cleanup in this diff is a finding, not a bonus.

${t.flows?.length ? `This bug affects core flows ${t.flows.join(', ')}. Confirm those specs still pass on the branch.\n\n` : ''}The issue is the report. Read it with \`gh issue view ${t.issue} --comments\` and check the fix against what was actually reported, not against the fixer's restatement of it. Do not tick, untick or close anything.

${WORKTREE}Fetch the branch and read the actual diff. Run the test suite yourself.

The fixer reported:
${fix.summary}

Commands it claims to have run: ${fix.checksRun?.map((c) => `${c.command} -> ${c.passed ? 'pass' : 'FAIL'}`).join('; ') || 'none reported'}
Reported changed lines: ${fix.changedLines ?? 'not reported'}
Left unresolved: ${fix.unresolved?.length ? fix.unresolved.join('; ') : 'nothing'}

Treat all of that as claims to verify, not findings to accept.`

const refixPrompt = (t, fix, review, round) => `${brief(FIXER)}Address blocking review findings on the bug fix for issue #${t.issue} — ${t.title}. Branch: \`${fix.branch}\`${fix.extraBranches?.length ? ` (stacked: ${[fix.branch, ...fix.extraBranches].join(' -> ')})` : ''}. This is fix round ${round} of ${MAX_FIX_ROUNDS}.

${WORKTREE}Check the branch out from its remote ref, fix every finding below, re-run the full check suite, and push.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

${review.redVerified === false ? `**The reviewer could not verify that your regression test fails without the fix**${review.redVerificationDetail ? ` — ${review.redVerificationDetail}` : ''}. Treat that as the finding to resolve first. Either the test does not actually reproduce the bug, or it reproduces it at a layer where reverting the source does not affect it. Re-derive it: revert your source change, watch the test fail, read the failure, and confirm it is this bug's symptom. Do not "fix" this by making the test stricter until it happens to fail.\n\n` : ''}Keep the change minimal and do not widen scope: a review round is not an opportunity to refactor. Do not weaken or delete the regression test to make a finding go away — if a finding says the test is wrong, make it reproduce the bug properly, and re-record its verbatim red output.

Report the same structured result as before, describing the branch as it now stands, with the regression test's red evidence re-recorded if it changed.`

// ---------------------------------------------------------------------------
// Stage 4 — Land.

const prPrompt = (t, fix) => {
  const branches = [fix.branch, ...(fix.extraBranches ?? [])].filter(Boolean)
  const n = branches.length
  return `Open the pull request${n > 1 ? 's' : ''} for the fix to issue #${t.issue} — ${t.title}. ${gh}

Branch${n > 1 ? 'es, in stack order' : ''}: ${branches.join(' -> ')}.

- Open ${n > 1 ? 'one PR per branch' : 'the PR'} **ready for review, not draft**. That is a deliberate instruction for this pipeline: the branch has already been through an adversarial review, so a draft would just add a step.
- ${n > 1 ? `The **first** PR's base is \`${BASE_BRANCH}\`; every later PR's base is the **previous branch in the stack** (\`gh pr create --base <prev-branch>\`), so each diff shows only its own slice. Title each "Fix #${t.issue} (i/${n}): <what was broken, in a few words>", where \`i\` is its 1-based position in the stack — so the first is "Fix #${t.issue} (1/${n}): ..." and the last is "Fix #${t.issue} (${n}/${n}): ...". Use that exact form, including the \`#\`, the brackets and the colon; the title says what was wrong, not what file changed.` : `Base it on \`${BASE_BRANCH}\`. Title it "Fix #${t.issue} (1/1): <what was broken, in a few words>" — that exact form, including the \`#\`, the brackets and the colon. A single PR is still numbered \`(1/1)\`, and the title says what was wrong, not what file changed.`}
- Cap each PR at **400 changed lines** (added + deleted in product and test code; generated files, lockfiles and vendored assets excluded). If a diff exceeds that, do **not** open an oversized PR — report it in \`blocker\`.
- Mirror \`.github/pull_request_template.md\` section by section:
  - **What & why** — the symptom, the root cause in one sentence (${fix.rootCause}), and how the fix addresses the cause rather than the symptom. ${n > 1 ? `Name each PR's place in the stack ("2/${n}, builds on #<prev>").` : ''} Link the PRD requirement or invariant the bug violated.
  - **Core flows** — ${t.flows?.length ? `${t.flows.join(', ')} — "untouched": this fix does not spec or complete a flow, and no flow spec was edited. Say that the specs still pass.` : `"None — bug fix, no core flow specced or completed by this PR."`}
  - **Walkthrough** — ${fix.changesUi || t.changesUi ? `this fix changes something a user sees, so leave the placeholder \`<!-- walkthrough pending -->\` here; a later stage fills it in.` : `"No UI change."`}
  - **Evidence** — the commands and their real results, **and the regression test's red→green transition**: paste the verbatim failure output from before the fix, name the command that produced it, and state that the reviewer independently reproduced that red. That paragraph is the reason the PR is trustworthy; do not summarise it away.
  - **Acceptance criteria met** — the issue's checkboxes if it has them; otherwise state the reported symptom is gone and the regression test covers it.
- \`Closes #${t.issue}\` on ${n > 1 ? 'the last PR only; `Refs #' + t.issue + '` on the others' : 'the PR'}.
- Note in the body that the branch passed an adversarial Opus review before the PR was opened.

${attribution}

Return every PR you opened, marking which one closes the issue.`
}

const walkthroughPrompt = (t, fix, pr) => `Capture and publish the screenshot walkthrough for the fix to issue #${t.issue}, then request a preview deploy. The PR is **#${pr.number}** on branch \`${pr.branch}\`. ${gh}

${WORKTREE}Check out \`origin/${pr.branch}\` and \`bun install\`.

1. **Capture.** \`bun run walkthrough:capture\` for flows under \`e2e/flows\`, and/or \`bun run walkthrough:capture:emulator\` for flows under \`e2e-emulator/flows\`. Capture only runs for specs that pass, so a failure here means something is broken, not that the tooling is. Report it rather than working around it.${t.flows?.length ? ` The flows this bug affects are ${t.flows.join(', ')} — those are the ones worth showing.` : ` This bug links no core flow, so capture whatever flow walks through the changed surface. If none does, report \`captured: false\` with that reason: a fix with no flow covering its surface is worth knowing about, and inventing a flow spec to fix that is not yours to do.`}
2. **Publish.** \`bun run walkthrough:publish -- --issue ${t.issue}\`. This pushes the PNGs to the \`claude/walkthroughs\` orphan branch and prints Markdown. Images **cannot** be attached to a PR body through the API — that is exactly why this exists. Do not commit them to the fix branch and do not link a CI artifact instead.
3. **Update the PR body.** Replace the \`<!-- walkthrough pending -->\` placeholder in #${pr.number} with the printed Markdown verbatim, keeping the rest of the body intact (\`gh pr view ${pr.number} --json body\`, edit, \`gh pr edit ${pr.number} --body-file\`). Re-read the rendered PR and confirm the images actually load — a broken raw URL renders as a broken-image icon and looks, at a glance, like a walkthrough.
4. **Request the preview.** \`gh pr edit ${pr.number} --add-label deploy-preview\`, but check two things first, because a preview runs against the **live production** Firestore, Auth and Storage and its smoke test leaves a real anonymous project there:
   - CI is green on #${pr.number}.
   - The branch does not change \`firestore.rules\` or \`storage.rules\`. A preview always runs against production's *current* rules, so it cannot prove a rules change, and an unreviewed branch must not reach production's access rules. If it does touch either, skip the label, say so in \`detail\`, and note it on the PR.

Report what you captured, whether the body was updated and the images render, and whether the label was added.`

// ---------------------------------------------------------------------------
// Stage 3b — the notification, when the loop runs out.
//
// Requested explicitly: a review that still wants changes after the rounds are
// spent goes back to the human, and the findings are written to the issue so
// they outlive the session that produced them.

const notifyPrompt = (t, fix, review) => `Post one comment on \`afternoon/solid-groove\` issue #${t.issue} recording that the automated fix pipeline stopped. ${gh} Post exactly one comment. Change nothing else — do not label, close, assign, or edit the issue body.

Write it for the human who has to pick this up. Include, in this order:

1. One line: the fix attempt for this bug did not pass adversarial review after ${MAX_FIX_ROUNDS} fix round${MAX_FIX_ROUNDS > 1 ? 's' : ''}, and the branch \`${fix.branch}\` is pushed and left open with no PR.
2. The root cause the fixer identified: ${fix.rootCause}
3. The blocking findings that remain, verbatim, as a numbered list — file and line, what is wrong, the concrete failure, and the suggested resolution:

${review.blocking.map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`).join('\n\n')}
${review.redVerified === false ? `\n4. That the reviewer could **not** independently verify the regression test fails without the fix${review.redVerificationDetail ? `: ${review.redVerificationDetail}` : ''}. Flag this as the finding to resolve first — until it holds, nothing else about the fix is proven.\n` : ''}
Do not soften the findings, do not add your own analysis, and do not speculate about which is easiest to fix. Report them as they are.

${attribution}`

// ---------------------------------------------------------------------------

const config = typeof args === 'number' ? { issue: args } : args && typeof args === 'object' && !Array.isArray(args) ? args : {}
const issueNumber = Number(config.issue ?? config.issueNumber)
if (!Number.isInteger(issueNumber) || issueNumber <= 0)
  throw new Error(`solid-groove-fix needs a GitHub issue number: { issue: 123 }. Got ${JSON.stringify(args)}.`)

phase('Triage')
const t = await agent(triagePrompt(issueNumber), {
  model: 'opus',
  label: `triage:#${issueNumber}`,
  phase: 'Triage',
  schema: TRIAGE_SCHEMA,
})
if (!t) throw new Error(`Could not read issue #${issueNumber}.`)
t.ambiguities = Array.isArray(t.ambiguities) ? t.ambiguities : []
t.flows = Array.isArray(t.flows) ? t.flows : []

log(`#${t.issue} ${t.title} — ${t.ambiguous ? `AMBIGUOUS (${t.ambiguities.length} open question${t.ambiguities.length === 1 ? '' : 's'})` : 'actionable'}${t.changesUi ? ', changes the UI' : ''}`)

if (t.ambiguous || t.ambiguities.length > 0)
  return {
    issue: t.issue,
    title: t.title,
    status: 'blocked-on-ambiguous-issue',
    stage: 'Triage',
    ambiguities: t.ambiguities,
    expected: t.expected,
    actual: t.actual,
    decisionBlockers: t.decisionBlockers ?? [],
    note: `#${t.issue} cannot be fixed as written: ${t.ambiguities.length} question${t.ambiguities.length === 1 ? '' : 's'} need${t.ambiguities.length === 1 ? 's' : ''} a human answer. Nothing was built, no branch was pushed, and nothing was written to GitHub. Answering on the issue and re-running is the next step.`,
  }

phase('Fix')
let fix = await agent(fixPrompt(t), {
  model: 'opus',
  label: `fix:#${t.issue}`,
  phase: 'Fix',
  isolation: 'worktree',
  schema: FIX_SCHEMA,
})
if (!fix) throw new Error(`Fixer returned nothing for #${t.issue}.`)

// Not reproducing is a legitimate, reportable outcome — and the one case where
// continuing would be actively harmful, since everything downstream is built on
// a regression test that does not exist.
if (fix.reproduced === false || !fix.branch)
  return {
    issue: t.issue,
    title: t.title,
    status: 'not-reproduced',
    stage: 'Fix',
    expected: t.expected,
    actual: t.actual,
    reproduction: t.reproduction,
    detail: fix.summary,
    unresolved: fix.unresolved ?? [],
    note: `The bug could not be reproduced at any layer, so no fix was written and no branch was pushed. A speculative fix would close the issue without addressing anything.`,
  }

log(`#${t.issue}: ${fix.branch} — ${fix.rootCause}`)

phase('Review')
let review = null
for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
  review = await agent(reviewPrompt(t, fix, round + 1), {
    model: 'opus',
    effort: 'high',
    label: `review:#${t.issue}#${round + 1}`,
    phase: 'Review',
    isolation: 'worktree',
    schema: REVIEW_SCHEMA,
  })
  if (!review) throw new Error(`Reviewer returned nothing for #${t.issue}.`)

  if (review.approved && review.redVerified !== false) break

  // An approval that could not confirm the red is not an approval. The whole
  // pipeline rests on that one check, so it is promoted to a blocking finding
  // rather than left as a note the PR body would quietly inherit.
  if (review.approved && review.redVerified === false) {
    review.approved = false
    review.blocking = [
      ...(review.blocking ?? []),
      {
        file: fix.regressionTest?.path ?? '(regression test)',
        issue: 'The reviewer could not verify that the regression test fails without the fix',
        failure: review.redVerificationDetail || 'Reverting the source change did not make the regression test fail, so the test does not prove the bug was fixed and will not catch its return.',
        resolution: 'Make the test reproduce the reported symptom, confirm it fails for that reason with the source reverted, and re-record the verbatim failure output.',
      },
    ]
  }

  review.blocking = Array.isArray(review.blocking) ? review.blocking : []
  log(`#${t.issue}: review round ${round + 1} returned ${review.blocking.length} blocking finding(s)`)
  if (round === MAX_FIX_ROUNDS) break

  const refixed = await agent(refixPrompt(t, fix, review, round + 1), {
    model: 'opus',
    label: `refix:#${t.issue}#${round + 1}`,
    phase: 'Review',
    isolation: 'worktree',
    schema: FIX_SCHEMA,
  })
  if (refixed) {
    refixed.branch = refixed.branch || fix.branch
    fix = refixed
  }
}

if (!review.approved) {
  await agent(notifyPrompt(t, fix, review), { model: 'sonnet', label: `notify:#${t.issue}`, phase: 'Review' })
  return {
    issue: t.issue,
    title: t.title,
    status: 'blocked-on-review',
    stage: 'Review',
    branch: fix.branch,
    rootCause: fix.rootCause,
    blocking: review.blocking,
    redVerified: review.redVerified ?? null,
    redVerificationDetail: review.redVerificationDetail ?? '',
    unresolved: fix.unresolved ?? [],
    note: `Still requesting changes after ${MAX_FIX_ROUNDS} fix round${MAX_FIX_ROUNDS > 1 ? 's' : ''}. Branch \`${fix.branch}\` is pushed and left open, no PR was opened, and the findings were commented on #${t.issue}.`,
  }
}

phase('Land')
const landed = await agent(prPrompt(t, fix), { model: 'sonnet', label: `pr:#${t.issue}`, phase: 'Land', schema: PR_SCHEMA })
const pullRequests = landed?.pullRequests ?? []
const closingPr = pullRequests.find((pr) => pr.closesIssue) ?? pullRequests[pullRequests.length - 1] ?? null

if (landed?.blocker) log(`#${t.issue}: ${landed.blocker}`)

phase('Walkthrough')
let walkthrough = null
if (!closingPr) {
  log(`#${t.issue}: no PR was opened, so there is nothing to attach a walkthrough to.`)
} else if (!(fix.changesUi || t.changesUi)) {
  log(`#${t.issue}: the fix changes nothing a user sees, so no walkthrough was captured.`)
} else {
  walkthrough = await agent(walkthroughPrompt(t, fix, closingPr), {
    model: 'sonnet',
    label: `walkthrough:#${t.issue}`,
    phase: 'Walkthrough',
    isolation: 'worktree',
    schema: WALKTHROUGH_SCHEMA,
  })
  if (!walkthrough?.published)
    log(`#${t.issue}: walkthrough NOT published (${walkthrough?.detail ?? 'agent returned nothing'}) — #${closingPr.number} changes the UI and needs one.`)
  if (walkthrough && !walkthrough.labelled)
    log(`#${t.issue}: deploy-preview not added to #${closingPr.number} (${walkthrough.detail ?? 'no reason reported'}).`)
}

return {
  issue: t.issue,
  title: t.title,
  status: 'open-for-review',
  rootCause: fix.rootCause,
  branch: fix.branch,
  regressionTest: fix.regressionTest,
  redVerifiedByReviewer: review.redVerified ?? null,
  pullRequests,
  closingPr,
  walkthrough,
  reviewNotes: review.notes ?? [],
  alsoAffected: fix.alsoAffected ?? [],
  unresolved: fix.unresolved ?? [],
}
