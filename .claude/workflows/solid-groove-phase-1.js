export const meta = {
  name: 'solid-groove-phase-1',
  description:
    'Implement Solid Groove Alpha Milestone 1 (LOOP-001..016, CNT-001..002) — Sonnet implements, Opus reviews every branch before its PR opens',
  whenToUse:
    'Run to execute Alpha Milestone 1, after FND-009 has landed. The scheduler is driven live by GitHub: each pass it reads the milestone\'s open issues, their Projects "Status" (Todo/In Progress/Done), and the native issue-dependency graph, then starts every "Todo" issue whose blockers are all closed. It sets an issue to "In Progress" when it starts it, and exits when nothing is ready. Config via args: { milestone: 2, maxConcurrent: 2 } — maxConcurrent caps how many issue pipelines (each a worktree running the full test suite) run at once; default 2 is laptop-safe, raise it in cloud.',
  phases: [
    { title: 'Foundations', detail: 'transport, autosave, shortcuts, dashboard, asset pipeline — everything that only needs FND-009' },
    { title: 'Instruments', detail: 'synth/sampler, drum machine, audio loops, tracks and mixer, library browser' },
    { title: 'Editing', detail: 'device chains, processing devices, step editor, piano roll, transformations' },
    { title: 'Content', detail: 'the factory library and the genre starter templates' },
    { title: 'Gate', detail: 'LOOP-016 manual loop workflow gate' },
  ],
}

// Model policy (docs/prd.md section 16): code-writing runs on Opus for every
// task — implement and fix alike — not just the shared registries and frameworks
// that once justified it while leaf features ran on Sonnet. Review is always Opus
// at high effort, and runs before any PR is opened. The mechanical GitHub/git
// agents (discovery, Status writes, PR-open) stay on Sonnet.

// `main` carries all of Alpha Milestone 0 now, including the docs commits that moved
// hosted-environment verification to `OPS-001` and published the GitHub issue
// index — both of which change what an agent owes, and both of which this
// workflow's briefs assume. It was pinned to the staging feature branch while
// those were unmerged; keeping that pin after they landed would have branched
// every task from a snapshot that is already missing `FND-009`.
const BASE_BRANCH = 'main'
const MAX_REVIEW_ROUNDS = 2

// The agent registry is read once at session start, so `agentType` cannot resolve
// a definition added during the same session. Each agent reads its own definition
// from the repo instead — one source of truth, and it works on a cold session.
const IMPLEMENTER = '.claude/agents/solid-groove-implementer.md'
const REVIEWER = '.claude/agents/solid-groove-reviewer.md'
const brief = (path) => `Read \`${path}\` and follow it as your operating instructions for this task.\n\n`

// Worktree ground rules. Four traps, every one of which has already cost a run:
// a worktree starts at the commit that was HEAD when the session began, not at
// the base branch tip; git refuses to check out a branch already checked out in
// the main worktree, so `git checkout ${BASE_BRANCH}` always fails here;
// a fresh worktree has no node_modules; and this container has no audio device.
// Absolute /home/user/solid-groove paths resolve to the main repo, not to the
// worktree, so they read stale-free files while git operates somewhere else
// entirely — always work from your own root.
const WORKTREE = `## Your worktree

You are in a git worktree, not the main checkout. Two things follow:

- \`cd "$(git rev-parse --show-toplevel)"\` first, and use paths relative to that root. An absolute \`/home/user/solid-groove/...\` path points at a different checkout and will silently mislead you.
- Your worktree starts at an older commit than \`${BASE_BRANCH}\`, and a branch already checked out in the main worktree cannot be checked out here at all. Always branch from the remote ref, never from local \`${BASE_BRANCH}\` and never from wherever your worktree happens to start:
  \`\`\`
  git fetch origin ${BASE_BRANCH}
  git checkout -b <branch> origin/${BASE_BRANCH}
  \`\`\`
  Confirm before you start work: \`git merge-base --is-ancestor origin/${BASE_BRANCH} HEAD\` must succeed. Never pipe a git command through \`tail\` or \`head\` in an \`&&\` chain — it hides the exit code and a failed checkout looks like a success.

## Environment setup, before your first test run

Both of these have already cost a run. Do them once, up front:

- **\`bun install\` in your worktree.** A fresh worktree has no \`node_modules\`, and the failure does not look like a missing install: \`bun run typecheck\` reports \`TS2688: Cannot find type definition file for '@testing-library/jest-dom'\` (and \`vinxi/types/client\`, \`vitest/globals\`), which reads like a broken tsconfig. It is not. Run \`bun install\` and it goes away. Never "fix" it by editing \`tsconfig.json\`'s \`types\` array.
- **Audio tests need a default ALSA device.** This container has no \`/dev/snd\`, so importing \`tone\` throws \`InvalidStateError: cpal backend error during default_output_config: DeviceUnavailable\` and fails ~8 suites under \`src/audio/\` at load time, before any assertion. A \`~/.asoundrc\` declaring a \`null\` default PCM should already exist (CI does the same thing — see the "Configure a null ALSA output device" step in \`.github/workflows/ci.yml\`). If those suites fail that way, recreate it:
  \`\`\`sh
  printf 'pcm.!default {\\n    type null\\n}\\nctl.!default {\\n    type null\\n}\\n' > ~/.asoundrc
  \`\`\`
  This is an environment gap, never a defect in the code under test. Do not skip, delete, or weaken an audio suite to get a green run, and do not report these as failures you fixed.

`

// Hosted-environment verification left Alpha Milestone 0 for OPS-001, after Alpha Milestone 2. Every
// Alpha Milestone 1 task's definition of done used to require "exercised in a deployed
// build", which no agent can satisfy — no Firebase project is provisioned. Say so
// explicitly, or an agent either reports a deploy that never happened or parks a
// finished task waiting for an environment that does not exist.
const NO_HOSTED_ENV = `

There is no hosted environment. The Firebase project, GA4 property, and Sentry organization are NOT provisioned, and the CI deploy job is gated off. Never invent a project id, DSN, token, or key; never commit a placeholder shaped like a real one; and never report a deploy, smoke test, or delivered event as having happened when it did not.

Your analytics obligation is unchanged and is **not** deferred: emit your task's PRD OPS-02 events through the shared typed catalog in \`src/analytics\`, extend the catalog in this same change if your feature introduces an action it does not cover, and prove each event fires exactly once per action with an automated test. What moved to \`OPS-001\` (after Alpha Milestone 2) is only *observing* those events arriving from a deployed build. Verify against the emulator suite and the gating browsers instead, and treat the hosted half as out of scope rather than unmet.`

// A task blocked on an unmade product decision is the one place an agent is most
// likely to do damage quietly: guessing a retention policy or a template list
// produces plausible code that encodes a decision nobody made, and it is
// expensive to find later. Name the decision and forbid the guess.
const decisionBlocked = (decisions) => `

## Blocked on a product decision

This task depends on ${decisions.map((d) => `\`${d.id}\` (${d.issue ? `#${d.issue}, ` : ''}${d.what})`).join(' and ')}, which ${decisions.length > 1 ? 'have' : 'has'} **not been decided**. ${decisions.length > 1 ? 'They are' : 'It is'} the product owner's call, not yours.

**Do not guess ${decisions.length > 1 ? 'them' : 'it'}.** Do not pick a plausible default, do not infer one from the design mocks, and do not let a library's default silently become product behavior. A confident implementation of an undecided policy is worse than an honest gap, because nothing later flags it as unreviewed.

Implement everything that does not depend on the decision — the structure, the commands, the tests, the states that hold under any answer — and design the boundary so the decision drops in as configuration rather than a rewrite. Then list every acceptance checkbox you could not close in \`unmet\`, naming the decision as the reason, and comment the same on your issue. An honest \`unmet\` entry is the correct outcome here, not a failure.`

// Only decisions that are still OPEN belong here. `DEC-001` (anonymous
// retention, #30), `DEC-002` (featured templates, #31) and `DEC-004` (export
// gain, #33) were answered by the product owner and are recorded in the PRD and
// in the LOOP-001/HARD-003/AUD-05/AUD-06 acceptance criteria, so LOOP-001 and
// LOOP-015 are ordinary tasks now — their briefs must not tell an agent to hold
// back on a decision that exists. The agent reads the decided criteria straight
// from its GitHub issue body, which is the specification.
const DEC = {
  'DEC-003': { id: 'DEC-003', issue: 32, what: 'approved content sources, licences, and redistribution terms' },
  'DEC-010': { id: 'DEC-010', issue: 39, what: 'the shipped factory pack list and each pack’s coverage claim' },
}

// The scheduler passes `t.blocked` as DEC id strings read live from an issue's
// open blockers (e.g. "DEC-003"). Resolve each to its rich DEC entry when known,
// and fall back to a generic entry for any DEC id not catalogued above — so a
// newly-added decision issue still gates the task instead of crashing the brief
// on an `undefined` lookup.
const resolveDecisions = (ids) =>
  ids.map((id) => DEC[normaliseId(id)] ?? { id: normaliseId(id), issue: null, what: 'an undecided product decision' })

// Task metadata is no longer hardcoded — it is read live from the milestone each
// pass (see the discovery agent and scheduler at the bottom). `normaliseId` is
// still used to key the model policy and phase lookup against a task id read from
// a live issue title, which is not uniformly upper-case (e.g. LOOP-001b).
const normaliseId = (id) => (typeof id === 'string' ? id.trim().toUpperCase() : id)

const IMPL_SCHEMA = {
  type: 'object',
  required: ['branch', 'summary', 'checksRun', 'unmet'],
  properties: {
    branch: { type: 'string', description: 'Branch the work was pushed to' },
    summary: { type: 'string', description: 'What was implemented and how' },
    checksRun: {
      type: 'array',
      description: 'Commands actually run, with their real outcome',
      items: {
        type: 'object',
        required: ['command', 'passed'],
        properties: {
          command: { type: 'string' },
          passed: { type: 'boolean' },
          detail: { type: 'string' },
        },
      },
    },
    unmet: {
      type: 'array',
      description: 'Acceptance checkboxes NOT satisfied, with the reason. Empty if all met.',
      items: { type: 'string' },
    },
    outOfScope: {
      type: 'array',
      description: 'Discoveries belonging to another task, not implemented here',
      items: { type: 'string' },
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['approved', 'blocking'],
  properties: {
    approved: { type: 'boolean' },
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

// The GitHub milestone is the source of truth for what to do, and the GitHub
// Projects **Status** field (Todo / In Progress / Done) plus the native
// issue-dependency graph (`blocked_by`) decide what is ready. Nothing here is
// hardcoded: no task list, no dependency map, no "what landed" set. Each pass a
// discovery agent reads the milestone's open issues live and returns, per issue,
// its Status, its `blocked_by` numbers, and whether each of those is closed. The
// script body has no GitHub access; every GitHub read and write happens inside an
// agent via the `gh` CLI (there is no GitHub MCP server in this environment — only
// `gh` is authenticated). `gh api graphql` reaches the Projects v2 Status field and
// the issue-dependency graph; plain `gh issue`/`gh pr` handle everything else.
//
// Readiness is a pure function of that snapshot:
//   ready  = Status "Todo"/unset AND every blocked_by issue CLOSED AND not `human-input-required`
//   skip   = Status "In Progress"/"Done", an open blocker, or the `human-input-required` label
// Two ways a decision keeps work back, and both are needed. (1) A task's `blocked_by`
// may include a decision issue (DEC-*); while that stays open the task is not ready.
// (2) The decision issue *itself* sits in the milestone with no blockers, so it would
// otherwise read as ready and an agent would "implement" it — the `human-input-required`
// label excludes those from scheduling entirely. See `needsHuman` in the scheduler.
const MILESTONE_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    milestoneOpenCount: { type: 'number', description: 'Total open issues remaining in the milestone' },
    issues: {
      type: 'array',
      description: 'One entry per OPEN issue in the milestone',
      items: {
        type: 'object',
        required: ['issue', 'taskId', 'title', 'status', 'blockedBy', 'allDepsClosed', 'humanInputRequired'],
        properties: {
          issue: { type: 'number', description: 'GitHub issue number' },
          taskId: { type: 'string', description: 'Task id parsed from the title, e.g. LOOP-004' },
          title: { type: 'string', description: 'Task title without the id prefix, e.g. "Synth and one-shot sampler"' },
          status: {
            type: 'string',
            enum: ['Todo', 'In Progress', 'Done', 'None'],
            description: 'The Projects v2 "Status" single-select value; "None" if the issue has no Status set',
          },
          blockedBy: {
            type: 'array',
            description: 'Issue numbers this issue is blocked_by, from the native dependency graph',
            items: { type: 'number' },
          },
          openBlockers: {
            type: 'array',
            description: 'The subset of blockedBy whose issues are still OPEN (not closed)',
            items: { type: 'number' },
          },
          allDepsClosed: { type: 'boolean', description: 'True if every blockedBy issue is closed (openBlockers is empty)' },
          humanInputRequired: {
            type: 'boolean',
            description: 'True if the issue carries the "human-input-required" label — a decision/input task no automated agent may implement',
          },
          hasOpenPr: { type: 'boolean', description: 'True if an open PR already references or closes this issue' },
          openPrNumber: { type: 'number', description: 'The open PR number, if any' },
          decisionBlockers: {
            type: 'array',
            description: 'Any open blocker that is itself a DEC-* decision issue, by DEC id, e.g. "DEC-003"',
            items: { type: 'string' },
          },
        },
      },
    },
  },
}

// Discover the milestone live. The agent uses the `gh` CLI (there is no GitHub MCP
// server here — only `gh` is authenticated). It reads the Projects Status via
// `gh api graphql` (needs the `read:project` scope) and the dependency graph via
// the issue-dependencies REST endpoint. Read-only.
const discoveryPrompt = (milestoneNumber) => `You are the scheduler's eyes for the Solid Groove Alpha Milestone workflow, repo \`afternoon/solid-groove\`. Use the **\`gh\` CLI** for every GitHub read (there is **no GitHub MCP server** in this environment — do not look for \`mcp__github__*\` tools, they do not exist; \`gh\` is already authenticated). This is **read-only** — do not modify any issue, project, or PR.

Report the live state of **GitHub milestone #${milestoneNumber}**. For every issue that is currently **open** in that milestone, return one entry with:

- \`issue\`: the issue number.
- \`taskId\` and \`title\`: parsed from the issue title, which is formatted \`TASK-ID - Title\` (e.g. "LOOP-004 - Synth and one-shot sampler" -> taskId "LOOP-004", title "Synth and one-shot sampler").
- \`status\`: the issue's **Projects v2 "Status"** single-select value — one of "Todo", "In Progress", "Done". Use "None" only if the issue genuinely has no Status set. This field lives on the user-owned Project the issue is added to (project "Solid Grooooooove", project number 2), NOT on the issue itself. Read it with \`gh api graphql\`, walking \`repository.issue.projectItems.nodes -> fieldValues\` and picking the \`ProjectV2ItemFieldSingleSelectValue\` whose \`field.name\` is "Status" (its \`.name\` is the option label). Do not infer it from labels or from whether a PR exists — read the actual field.
- \`blockedBy\`: the issue numbers this issue is **blocked by**, from GitHub's native issue-dependency graph, not from any "Dependencies" text in the body. Read it with \`gh api repos/afternoon/solid-groove/issues/<n>/dependencies/blocked_by --paginate\` (send header \`-H "Accept: application/vnd.github+json"\`); each returned issue's \`number\` is a blocker.
- \`openBlockers\`: the subset of \`blockedBy\` whose issues are still open; \`allDepsClosed\` is true exactly when this list is empty. (Get each blocker's state with \`gh issue view <n> --json state\`.)
- \`humanInputRequired\`: true if the issue carries the label **\`human-input-required\`**. These are decision/input tasks (e.g. \`DEC-*\`) that a human must resolve; the scheduler never implements them. Read the label list (\`gh issue view <n> --json labels\`); do not infer this from the title.
- \`hasOpenPr\`/\`openPrNumber\`: if an open PR already closes or references this issue, report it.
- \`decisionBlockers\`: for any open blocker whose title is a \`DEC-*\` decision issue, list its DEC id.

A good starting point is \`gh issue list --repo afternoon/solid-groove --milestone "<milestone title>" --state open --limit 100 --json number,title,labels\`; resolve milestone #${milestoneNumber}'s title first with \`gh api repos/afternoon/solid-groove/milestones/${milestoneNumber} --jq .title\`.

Also report \`milestoneOpenCount\`: how many issues are open in the milestone in total.

Read every value from GitHub. Do not guess or infer any of it from another source.`

// Setting Status is a write, so it goes through an agent too. Kept deliberately
// tolerant: if the project write scope is missing this must not abort the task —
// the loop still won't re-pick the issue within a run because it is removed from
// the pending set once started. Report success/failure honestly.
const SET_STATUS_SCHEMA = {
  type: 'object',
  required: ['issue', 'set'],
  properties: {
    issue: { type: 'number' },
    set: { type: 'boolean', description: 'True if the Status field was actually written' },
    detail: { type: 'string', description: 'What happened, especially the error if set is false' },
  },
}

// Known IDs for the user-owned Project "Solid Grooooooove" (project #2), captured
// so the Status-write agent doesn't have to rediscover them each time. If the board
// is rebuilt these change; the prompt tells the agent to re-resolve them if the
// mutation 404s on a stale ID rather than silently giving up.
const PROJECT_ID = 'PVT_kwHNqEHOAXy6Zw'
const STATUS_FIELD_ID = 'PVTSSF_lAHNqEHOAXy6Z84WYFWU'
const STATUS_OPTION_ID = { 'Todo': 'f75ad846', 'In Progress': '47fc9ee4', 'Done': '98236657' }

const setStatusPrompt = (issue, value) => `Set the **Projects v2 "Status"** field of \`afternoon/solid-groove\` issue #${issue} to "${value}". Use the **\`gh\` CLI** (there is **no GitHub MCP server** here — \`gh\` is already authenticated).

The Status field is on the user-owned Project "Solid Grooooooove" (project number 2). Writing it needs the \`project\` token scope (reading needs only \`read:project\`); if the mutation fails with \`INSUFFICIENT_SCOPES\` the scope has not been granted — report \`set: false\` with that error, do not retry, and do not change anything else.

Two steps:

1. Find this issue's **project item id** for project #2:
\`\`\`
gh api graphql -f query='query($n:Int!){ repository(owner:"afternoon", name:"solid-groove"){ issue(number:$n){ projectItems(first:20){ nodes{ id project{ number } } } } } }' -F n=${issue} \\
  --jq '.data.repository.issue.projectItems.nodes[] | select(.project.number==2) | .id'
\`\`\`

2. Set its Status to "${value}" (project id \`${PROJECT_ID}\`, Status field id \`${STATUS_FIELD_ID}\`, "${value}" option id \`${STATUS_OPTION_ID[value] ?? 'UNKNOWN'}\`):
\`\`\`
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p, itemId:$i, fieldId:$f, value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }' \\
  -f p=${PROJECT_ID} -f i=<itemId-from-step-1> -f f=${STATUS_FIELD_ID} -f o=${STATUS_OPTION_ID[value] ?? ''}
\`\`\`

If step 1 finds no item for project #2, or a baked-in id 404s (the board was rebuilt), re-resolve the ids from the project itself before giving up. If you lack the \`project\` scope, do **not** treat that as fatal — just report \`set: false\` with the error in \`detail\`. Report \`set: true\` only if the field is now actually "${value}".`

const issueBrief = (t) =>
  `\n\n## Your GitHub issue\n\nTask ${t.id} is tracked in \`afternoon/solid-groove\` issue **#${t.issue}** — its body is the specification and it is the live record. Use the **\`gh\` CLI** for GitHub (there is **no GitHub MCP server** here — \`gh\` is already authenticated: \`gh issue view ${t.issue}\`, \`gh issue comment ${t.issue} --body ...\`, \`gh issue edit ${t.issue} --add-assignee afternoon\`).\n\n- Assign #${t.issue} to \`afternoon\` and comment that you have started, naming the branch you will push to, **before** you change product code.\n- Tick the acceptance checkboxes on #${t.issue} as you genuinely satisfy them. Never tick one you have not. A reviewer treats a ticked box as a claim to verify, and a box ticked without supporting code is itself a blocking finding.\n- Comment when something is worth knowing — a blocker, a decision you had to make, a discovery belonging to another task — not once per commit.\n- Do **not** close the issue. A reviewer runs after you and the PR closes it on merge.\n- End every comment with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.`

const implPrompt = (t) => `${brief(IMPLEMENTER)}Implement task ${t.id} - ${t.title}, tracked as issue #${t.issue}.

Read the issue body — it is the specification — with \`gh issue view ${t.issue}\`, and every PRD requirement it links, then implement it in full: product code, tests, fixtures and any documentation the task requires.${NO_HOSTED_ENV}${
  t.blocked ? decisionBlocked(resolveDecisions(t.blocked)) : ''
}${issueBrief(t)}

${WORKTREE}Name your branch claude/${t.id.toLowerCase()} and create it from origin/${BASE_BRANCH} as described above. Commit and push it with \`git push -u origin claude/${t.id.toLowerCase()}\`. Do not open a pull request — a reviewer runs before the PR is opened.

Report the branch name, what you did, the commands you ran with their real results, and any acceptance checkbox you could not satisfy.`

const reviewPrompt = (t, impl, round) => `${brief(REVIEWER)}Review branch ${impl.branch} against task ${t.id} - ${t.title} (issue #${t.issue}).${
  round > 1
    ? `\n\nThis is review round ${round}; a previous round returned blocking findings that the implementer has since addressed. Verify the fixes rather than assuming them.`
    : ''
}

The task's live record is issue #${t.issue}. Read it with \`gh issue view ${t.issue} --comments\` (use the **\`gh\` CLI**; there is **no GitHub MCP server** here) — including its comments — and treat every ticked acceptance checkbox as a claim to verify against the diff, exactly like a line in the implementer's summary. A box ticked without the code to support it is a blocking finding. Do not tick, untick, or close anything yourself.${
  t.blocked
    ? `\n\nThis task is blocked on ${t.blocked.map((d) => `\`${d}\``).join(' and ')}, which ${t.blocked.length > 1 ? 'are' : 'is'} undecided. Check specifically that the implementer did **not** invent the decision: a hardcoded retention window, template list, or licence policy that reads as deliberate product behavior is a blocking finding no matter how reasonable it looks. An honest gap is the correct outcome here.`
    : ''
}

Hosted-environment verification moved to \`OPS-001\` after Alpha Milestone 2, so no deployed-build claim is owed by this task — but the analytics obligation is: the task's OPS-02 events must have real call sites with tests proving each fires once per action. Events left for later are a blocking finding, not a deferral.

${WORKTREE}Fetch and check out the branch under review with \`git fetch origin ${impl.branch} && git checkout -b review-${t.id.toLowerCase()} origin/${impl.branch}\`, then read the actual diff against origin/${BASE_BRANCH}. Run the test suite yourself.

The implementer reported:
${impl.summary}

Commands it claims to have run: ${impl.checksRun.map((c) => `${c.command} -> ${c.passed ? 'pass' : 'FAIL'}`).join('; ') || 'none reported'}
Checkboxes it reports unmet: ${impl.unmet.length ? impl.unmet.join('; ') : 'none'}

Treat all of that as claims to verify, not findings to accept.`

const fixPrompt = (t, impl, review) => `${brief(IMPLEMENTER)}Address blocking review findings on branch ${impl.branch} for task ${t.id} - ${t.title} (issue #${t.issue}).

${WORKTREE}Check the branch out with \`git fetch origin ${impl.branch} && git checkout -b ${impl.branch} origin/${impl.branch}\`, fix every finding below, re-run the full check suite, and push to the same branch. Do not rewrite unrelated code and do not widen scope.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

Report the same structured result as the original implementation, describing the branch as it now stands.`

const prPrompt = (t, impl) => `Open a pull request for branch ${impl.branch} into ${BASE_BRANCH} with the **\`gh\` CLI** (\`gh pr create\`; there is **no GitHub MCP server** here, and \`gh\` is already authenticated).

Check the repository for a PR template and mirror its structure if one exists. Title it "${t.id} - ${t.title}". In the body, describe the change, link the task's PRD requirements, list the acceptance checkboxes met, and state that the branch passed an Opus review round in the implementation workflow.

If the task changed anything a user sees, the implementer captured a walkthrough of the result — put it in the body's Walkthrough section. Prefer a short video that starts from a common entrypoint (the public landing page, the project dashboard, or a project page) and navigates to the change; a GIF or before/after screenshots are an acceptable fallback for a small visual tweak. Name the entrypoint and theme. If the implementer reported no walkthrough for a UI-changing task, capture one before opening the PR: run the app with the in-memory mock backend (\`VITE_MOCK_BACKEND=true bun run dev\`), start from one of those entrypoints and record navigating to the affected view. A PR with no user-visible change says so in that section instead.

Include \`Closes #${t.issue}\` in the body so merging closes the task's issue.

End the PR body with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.

Return the pull request URL.`

// One task: mark it In Progress, then implement (Sonnet, or Opus for the shared
// registries and frameworks) -> review (Opus) -> fix -> re-review, then open the
// PR. Each stage runs in its own worktree; the branch is how state travels
// between them, which is why every stage pushes.
async function runTask(t) {
  // Every task implements and fixes on Opus. The shared registries/frameworks
  // once justified Opus while leaf features ran on Sonnet, but code-writing is now
  // Opus across the board (see docs/prd.md section 16). Review is Opus too, below.
  const model = 'opus'

  // Reserve the issue by flipping its Status to In Progress before any code is
  // written, so a later pass (or a concurrent run) sees it as owned and does not
  // re-pick it. A missing project-write scope is logged, not fatal: within this
  // run the issue is already out of the pending set, so it will not be double-run
  // here regardless — the write only guards against other passes/runs.
  const marked = await agent(setStatusPrompt(t.issue, 'In Progress'), {
    model: 'sonnet',
    label: `status:${t.id}->wip`,
    phase: t.phase,
    schema: SET_STATUS_SCHEMA,
  })
  if (!marked?.set) {
    log(`${t.id}: could not set Status to In Progress (${marked?.detail ?? 'no result'}) — proceeding; other passes rely on this, so check the project write scope.`)
  }

  let impl = await agent(implPrompt(t), {
    model,
    label: `impl:${t.id}`,
    phase: t.phase,
    isolation: 'worktree',
    schema: IMPL_SCHEMA,
  })
  if (!impl) return { id: t.id, status: 'failed', reason: 'implementer returned nothing' }

  let review = null
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    review = await agent(reviewPrompt(t, impl, round), {
      model: 'opus',
      effort: 'high',
      label: `review:${t.id}#${round}`,
      phase: t.phase,
      isolation: 'worktree',
      schema: REVIEW_SCHEMA,
    })
    if (!review) return { id: t.id, status: 'failed', reason: 'reviewer returned nothing', branch: impl.branch }
    if (review.approved) break

    log(`${t.id}: review round ${round} returned ${review.blocking.length} blocking finding(s)`)
    if (round === MAX_REVIEW_ROUNDS) break

    const fixed = await agent(fixPrompt(t, impl, review), {
      model,
      label: `fix:${t.id}#${round}`,
      phase: t.phase,
      isolation: 'worktree',
      schema: IMPL_SCHEMA,
    })
    if (fixed) impl = fixed
  }

  if (!review.approved) {
    log(`${t.id}: NOT approved after ${MAX_REVIEW_ROUNDS} rounds — branch ${impl.branch} left open, no PR`)
    return { id: t.id, status: 'blocked', branch: impl.branch, blocking: review.blocking, unmet: impl.unmet }
  }

  const pr = await agent(prPrompt(t, impl), { model: 'sonnet', label: `pr:${t.id}`, phase: t.phase })
  return { id: t.id, status: 'approved', branch: impl.branch, pr, notes: review.notes ?? [], outOfScope: impl.outOfScope ?? [] }
}

// Which UI phase a task belongs to, for the progress display only. Derived from
// the task-id prefix so a live-discovered task lands in a sensible group without
// a hardcoded per-task map. Scheduling does not depend on this.
const PHASE_BY_TASK = {
  'LOOP-003': 'Foundations', 'LOOP-014': 'Foundations', 'CNT-001': 'Foundations',
  'LOOP-001': 'Foundations', 'LOOP-002': 'Foundations',
  'LOOP-004': 'Instruments', 'LOOP-005': 'Instruments', 'LOOP-006': 'Instruments',
  'LOOP-007': 'Instruments', 'LOOP-013': 'Instruments', 'LOOP-001b': 'Instruments',
  'LOOP-008': 'Editing', 'LOOP-009': 'Editing', 'LOOP-010': 'Editing',
  'LOOP-011': 'Editing', 'LOOP-012': 'Editing',
  'CNT-002': 'Content', 'LOOP-015': 'Content',
  'LOOP-016': 'Gate',
}
const phaseFor = (taskId) => PHASE_BY_TASK[normaliseId(taskId)] ?? 'Foundations'

// Run configuration comes from `args`, all optional:
//   { milestone: <number>, maxConcurrent: <number> }
// `maxConcurrent` is the real backstop against the resource contention that has
// bitten this workflow before: each running task is its own git worktree doing
// `bun install` plus the full test suite, so N of them at once is N parallel test
// runs. The runtime's own agent cap (min(16, cores-2)) sits ABOVE this; on a
// laptop this limit is what actually binds. Default 2 is laptop-safe; raise it
// (e.g. {maxConcurrent: 6}) when running in cloud.
const DEFAULT_MILESTONE = 2 // GitHub milestone "Alpha Milestone 1: Loop Workflow"
const DEFAULT_MAX_CONCURRENT = 2

const config = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {}
const milestone = Number.isInteger(config.milestone) ? config.milestone : DEFAULT_MILESTONE
const rawMax = Number(config.maxConcurrent)
const maxConcurrent = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : DEFAULT_MAX_CONCURRENT
if (config.maxConcurrent !== undefined && !(Number.isFinite(rawMax) && rawMax >= 1)) {
  throw new Error(`maxConcurrent must be an integer >= 1, got ${JSON.stringify(config.maxConcurrent)}.`)
}

// The scheduler is a poll-once-per-pass loop driven entirely by live GitHub
// state — no hardcoded task list, dependency map, or "what landed" set. Each pass:
//   1. discover: the milestone's open issues, each with its Projects Status,
//      blocked_by graph, and whether every blocker is closed.
//   2. ready = Status "Todo"/unset AND all blockers closed AND not labelled
//      `human-input-required`. In Progress / Done are skipped (owned, or complete);
//      a still-open DEC-* blocker keeps a task un-ready; and a `human-input-required`
//      issue (the decisions themselves) is never scheduled — a human resolves it.
//   3. start up to `maxConcurrent` ready tasks (lowest issue number first for a
//      stable, dependency-friendly order), each: set In Progress -> implement ->
//      review -> fix -> open PR.
//   4. exit-when-idle: a task the loop starts is In Progress by the next pass, so
//      it won't be re-picked; the loop ends when a fresh pass finds nothing ready.
const results = []
const startedThisRun = new Set() // issue numbers this run has already launched
let pass = 0

while (true) {
  pass += 1
  phase('Foundations')
  log(`Pass ${pass}: reading milestone #${milestone} — open issues, Status, and dependency graph`)

  const snapshot = await agent(discoveryPrompt(milestone), {
    model: 'sonnet',
    label: `discover#${pass}`,
    phase: 'Foundations',
    schema: MILESTONE_SCHEMA,
  })

  // A failed discovery must stop the loop, never fall back to "run everything":
  // scheduling blind is exactly how finished work gets re-implemented and
  // in-progress work gets duplicated.
  if (!snapshot || !Array.isArray(snapshot.issues)) {
    throw new Error(`Pass ${pass}: could not read milestone #${milestone} from GitHub; refusing to schedule without the source of truth.`)
  }

  const open = snapshot.issues
  if (!open.length) {
    log(`Milestone #${milestone} has no open issues left — done.`)
    break
  }

  // Ready: available (Status "Todo", or unset/"None" — an issue not yet placed in
  // a column still counts as available) and every blocker closed. Exclude anything
  // this run already started (its In Progress write may not have propagated to this
  // snapshot yet), so a slow Status update can't cause a double-launch. Exclude
  // `human-input-required` issues entirely: DEC-* decisions and other human-only
  // tasks live in the milestone and can have no blockers, so without this guard the
  // scheduler would "implement" a decision — exactly the failure this filter fixes.
  const isAvailable = (i) => i.status === 'Todo' || i.status === 'None'
  const needsHuman = (i) => i.humanInputRequired === true
  const ready = open
    .filter((i) => isAvailable(i) && i.allDepsClosed && !needsHuman(i) && !startedThisRun.has(i.issue))
    .sort((a, b) => a.issue - b.issue)

  if (!ready.length) {
    // Nothing to start. Report why each remaining open issue is held, then exit
    // (exit-when-idle). Re-invoke the workflow after landing a blocker to continue.
    const inProgress = open.filter((i) => i.status === 'In Progress').map((i) => `${i.taskId} (#${i.issue})`)
    const humanInput = open
      .filter((i) => i.status !== 'In Progress' && needsHuman(i))
      .map((i) => `${i.taskId} (#${i.issue})`)
    const waiting = open
      .filter((i) => i.status !== 'In Progress' && !needsHuman(i) && !i.allDepsClosed)
      .map((i) => `${i.taskId} (#${i.issue}) waits on ${i.openBlockers?.join(', ') || 'open blockers'}${i.decisionBlockers?.length ? ` [decision: ${i.decisionBlockers.join(', ')}]` : ''}`)
    log('Nothing ready to start this pass — exiting (idle).')
    if (inProgress.length) log(`In progress (owned elsewhere): ${inProgress.join('; ')}`)
    if (humanInput.length) log(`Awaiting human input (skipped): ${humanInput.join('; ')}`)
    if (waiting.length) log(`Blocked by open dependencies: ${waiting.join('; ')}`)
    return {
      milestone,
      maxConcurrent,
      results,
      approved: results.filter((r) => r.status === 'approved').map((r) => `${r.id} ${r.pr ?? r.branch}`),
      notApproved: results.filter((r) => r.status !== 'approved').map((r) => `${r.id} (${r.status})`),
      inProgress,
      awaitingHumanInput: humanInput,
      blocked: waiting,
    }
  }

  const batch = ready.slice(0, maxConcurrent)
  if (ready.length > batch.length) {
    log(`${ready.length} ready; starting ${batch.length} (maxConcurrent=${maxConcurrent}), the rest next pass: ${ready.slice(maxConcurrent).map((i) => i.taskId).join(', ')}`)
  }
  phase(phaseFor(batch[0].taskId))
  log(`Pass ${pass}: starting ${batch.map((i) => `${i.taskId} (#${i.issue})`).join(', ')}`)

  // Build the task objects runTask expects from the live snapshot. `blocked`
  // carries any open DEC-* blockers so the implement/review briefs hold the agent
  // back from inventing an undecided decision.
  const tasks = batch.map((i) => ({
    id: i.taskId,
    title: i.title,
    issue: i.issue,
    phase: phaseFor(i.taskId),
    blocked: i.decisionBlockers?.length ? i.decisionBlockers : undefined,
  }))
  for (const i of batch) startedThisRun.add(i.issue)

  const outcomes = await parallel(tasks.map((t) => () => runTask(t)))
  for (const r of outcomes) {
    if (r) results.push(r)
  }
  // Loop back: the next pass re-reads GitHub, so a just-opened PR that closed its
  // issue drops out and newly-unblocked tasks appear.
}

const approved = results.filter((r) => r.status === 'approved')
log(`Milestone #${milestone}: ${approved.length}/${results.length} started tasks approved and raised as PRs this run`)

return {
  milestone,
  maxConcurrent,
  results,
  approved: approved.map((r) => `${r.id} ${r.pr ?? r.branch}`),
  notApproved: results.filter((r) => r.status !== 'approved').map((r) => `${r.id} (${r.status})`),
}
