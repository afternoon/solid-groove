export const meta = {
  name: 'solid-groove-phase-1',
  description:
    'Implement Solid Groove Alpha Milestone 1 (LOOP-001..016, CNT-001..002) — Sonnet implements, Opus reviews every branch before its PR opens',
  whenToUse:
    'Run to execute Alpha Milestone 1 of docs/backlog.md, after FND-009 has landed. Name tasks to run a subset, either positionally (solid-groove-phase-1 LOOP-003 LOOP-007) or as args: ["LOOP-003","LOOP-007"]. Omit them entirely to run the whole phase. Named tasks still execute in dependency order, not the order given.',
  phases: [
    { title: 'Foundations', detail: 'transport, autosave, shortcuts, dashboard, asset pipeline — everything that only needs FND-009' },
    { title: 'Instruments', detail: 'synth/sampler, drum machine, audio loops, tracks and mixer, library browser' },
    { title: 'Editing', detail: 'device chains, processing devices, step editor, piano roll, transformations' },
    { title: 'Content', detail: 'the factory library and the genre starter templates' },
    { title: 'Gate', detail: 'LOOP-016 manual loop workflow gate' },
  ],
}

// Model policy, per the decision recorded in docs/prd.md section 16: a task
// whose output every dependent task inherits runs on Opus, because an error
// there propagates and surfaces late. In Alpha Milestone 1 that means the shared
// registries and frameworks rather than the leaf features — the transport every
// instrument schedules against, the device framework the processors plug into,
// the shortcut registry every surface reads, the manifest pipeline the browser
// consumes, and the transformation commands the Alpha Milestone 3 assistant reuses.
// Review is always Opus at high effort, and runs before any PR is opened.
const CONTRACT_TASKS = ['LOOP-003', 'LOOP-008', 'LOOP-012', 'LOOP-014', 'CNT-001', 'LOOP-016']

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

This task depends on ${decisions.map((d) => `\`${d.id}\` (#${d.issue}, ${d.what})`).join(' and ')}, which ${decisions.length > 1 ? 'have' : 'has'} **not been decided**. ${decisions.length > 1 ? 'They are' : 'It is'} the product owner's call, not yours.

**Do not guess ${decisions.length > 1 ? 'them' : 'it'}.** Do not pick a plausible default, do not infer one from the design mocks, and do not let a library's default silently become product behavior. A confident implementation of an undecided policy is worse than an honest gap, because nothing later flags it as unreviewed.

Implement everything that does not depend on the decision — the structure, the commands, the tests, the states that hold under any answer — and design the boundary so the decision drops in as configuration rather than a rewrite. Then list every acceptance checkbox you could not close in \`unmet\`, naming the decision as the reason, and comment the same on your issue. An honest \`unmet\` entry is the correct outcome here, not a failure.`

// Only decisions that are still OPEN belong here. `DEC-001` (anonymous
// retention, #30), `DEC-002` (featured templates, #31) and `DEC-004` (export
// gain, #33) were answered by the product owner and are recorded in the PRD and
// in the LOOP-001/HARD-003/AUD-05/AUD-06 acceptance criteria, so LOOP-001 and
// LOOP-015 are ordinary tasks now — their briefs must not tell an agent to hold
// back on a decision that exists. The agent reads the decided criteria straight
// from docs/backlog.md, which this run's base branch carries.
const DEC = {
  'DEC-003': { id: 'DEC-003', issue: 32, what: 'approved content sources, licences, and redistribution terms' },
  'DEC-010': { id: 'DEC-010', issue: 39, what: 'the shipped factory pack list and each pack’s coverage claim' },
}

// `deps` lists only Alpha Milestone 1 dependencies — the scheduler waits on those. Alpha Milestone 0
// dependencies (FND-009, FND-002b, CNT-000b) are already on the base branch, so
// listing them would deadlock a scheduler that can only satisfy deps it runs.
const TASKS = [
  { id: 'LOOP-001', phase: 'Foundations', title: 'Anonymous start and project dashboard', issue: 40, deps: [] },
  { id: 'LOOP-002', phase: 'Foundations', title: 'Autosave and recovery UX', issue: 42, deps: [] },
  { id: 'LOOP-003', phase: 'Foundations', title: 'Transport, tempo, loop, and metronome', issue: 43, deps: [] },
  { id: 'LOOP-014', phase: 'Foundations', title: 'Shortcut registry and mapping guide', issue: 56, deps: [] },
  { id: 'CNT-001', phase: 'Foundations', title: 'Asset manifest and ingestion pipeline', issue: 53, deps: [] },

  { id: 'LOOP-001b', phase: 'Instruments', title: 'Public landing page', issue: 41, deps: ['LOOP-001'] },
  { id: 'LOOP-004', phase: 'Instruments', title: 'Synth and one-shot sampler', issue: 44, deps: ['LOOP-003', 'CNT-001'] },
  { id: 'LOOP-005', phase: 'Instruments', title: 'Drum machine', issue: 45, deps: ['LOOP-003', 'CNT-001'] },
  { id: 'LOOP-006', phase: 'Instruments', title: 'Tempo-aware audio loops', issue: 46, deps: ['LOOP-003', 'CNT-001'] },
  { id: 'LOOP-007', phase: 'Instruments', title: 'Track management and mixer', issue: 47, deps: ['LOOP-003'] },
  { id: 'LOOP-013', phase: 'Instruments', title: 'Searchable, sync-audition library browser', issue: 54, deps: ['CNT-001', 'LOOP-003'] },
  { id: 'CNT-002', phase: 'Content', title: 'Rounded alpha factory library', issue: 55, deps: ['CNT-001'], blocked: ['DEC-003', 'DEC-010'] },

  { id: 'LOOP-008', phase: 'Editing', title: 'Device-chain and routing framework', issue: 48, deps: ['LOOP-007'] },
  { id: 'LOOP-010', phase: 'Editing', title: 'Step editor', issue: 50, deps: ['LOOP-005'] },
  { id: 'LOOP-011', phase: 'Editing', title: 'Piano roll', issue: 51, deps: ['LOOP-004'] },
  { id: 'LOOP-009', phase: 'Editing', title: 'Core processing devices', issue: 49, deps: ['LOOP-008'] },
  { id: 'LOOP-012', phase: 'Editing', title: 'Shared musical transformations', issue: 52, deps: ['LOOP-010', 'LOOP-011'] },

  {
    id: 'LOOP-015',
    phase: 'Content',
    title: 'Starter projects and genre templates',
    issue: 57,
    deps: ['LOOP-001', 'LOOP-002', 'LOOP-004', 'LOOP-005', 'LOOP-006', 'LOOP-007', 'LOOP-008', 'LOOP-009', 'LOOP-010', 'LOOP-011', 'LOOP-012', 'LOOP-013', 'LOOP-014', 'CNT-002'],
  },
  {
    id: 'LOOP-016',
    phase: 'Gate',
    title: 'Manual loop workflow gate',
    issue: 58,
    deps: ['LOOP-001', 'LOOP-001b', 'LOOP-002', 'LOOP-003', 'LOOP-004', 'LOOP-005', 'LOOP-006', 'LOOP-007', 'LOOP-008', 'LOOP-009', 'LOOP-010', 'LOOP-011', 'LOOP-012', 'LOOP-013', 'LOOP-014', 'LOOP-015', 'CNT-002'],
  },
]

// Normalise the subset request, and fail loud on anything malformed.
//
// The rule that matters: a filter the script cannot understand must stop the
// run, never degrade into "run every task". An early version of the Alpha Milestone 0
// script used `Array.isArray(args) ? ... : null`, so a non-array `args` fell
// through to null and ran the entire phase — that once opened PRs for six tasks
// nobody asked for. Every branch below either yields a non-empty id list or
// throws.
const normaliseId = (id) => (typeof id === 'string' ? id.trim().toUpperCase() : id)

const toIdList = (raw) => {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') {
    throw new Error(`args must be task ids, got ${typeof raw}: ${JSON.stringify(raw)}.`)
  }

  const trimmed = raw.trim()
  if (!trimmed) return []

  // A leading bracket or brace means the caller meant JSON. Honour that reading
  // so a malformed JSON filter is reported as malformed JSON, rather than being
  // split on whitespace into tokens that fail later as "unknown task id".
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let decoded
    try {
      decoded = JSON.parse(trimmed)
    } catch {
      throw new Error(`args looks like JSON but does not parse: ${raw}`)
    }
    if (!Array.isArray(decoded)) {
      throw new Error(`args must be a list of task ids; it decoded to ${typeof decoded}: ${raw}`)
    }
    return decoded
  }

  return trimmed.split(/[\s,]+/)
}

// Only an *absent* filter means "run everything". A filter that is present but
// empty — '', '   ', [], '[]' — is ambiguous: it reads equally as "run nothing"
// and as "a list I meant to populate and did not", and the second is how the
// six-unwanted-PRs run happened. Refuse it and make the caller say which.
const parseTaskIds = (raw) => {
  if (raw === undefined || raw === null) return null
  const ids = toIdList(raw).map(normaliseId)
  if (!ids.length) {
    throw new Error(
      'args was present but empty, which is ambiguous. Omit args entirely to run the ' +
        'whole phase, or name the tasks to run, e.g. "LOOP-003 LOOP-007".',
    )
  }
  return ids
}

// Compare on the normalised form on BOTH sides. Ids are not uniformly
// upper-case — LOOP-001b carries a lower-case suffix — so matching a normalised
// filter against a raw task id would reject every filter naming it.
const taskIds = parseTaskIds(args)
const known = new Set(TASKS.map((t) => normaliseId(t.id)))
const unknown = (taskIds ?? []).filter((id) => !known.has(id))
if (unknown.length) {
  throw new Error(
    `args contains unknown task id(s): ${unknown.join(', ')}. Known ids: ${TASKS.map((t) => t.id).join(', ')}.`,
  )
}

const only = taskIds ? new Set(taskIds) : null
const wanted = (id) => !only || only.has(normaliseId(id))

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

const issueBrief = (t) =>
  `\n\n## Your GitHub issue\n\nTask ${t.id} is tracked in \`afternoon/solid-groove\` issue **#${t.issue}** — that issue, not \`docs/backlog.md\`, is the live record. Use the \`mcp__github__*\` tools; there is no \`gh\` CLI.\n\n- Assign #${t.issue} to \`afternoon\` and comment that you have started, naming the branch you will push to, **before** you change product code.\n- Tick the acceptance checkboxes on #${t.issue} as you genuinely satisfy them. Never tick one you have not. A reviewer treats a ticked box as a claim to verify, and a box ticked without supporting code is itself a blocking finding.\n- Comment when something is worth knowing — a blocker, a decision you had to make, a discovery belonging to another task — not once per commit.\n- Do **not** close the issue. A reviewer runs after you and the PR closes it on merge.\n- End every comment with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.`

const implPrompt = (t) => `${brief(IMPLEMENTER)}Implement backlog task ${t.id} - ${t.title}.

Read its task block in docs/backlog.md and every PRD requirement the block links, then implement it in full: product code, tests, fixtures and any documentation the task requires.${NO_HOSTED_ENV}${
  t.blocked ? decisionBlocked(t.blocked.map((d) => DEC[d])) : ''
}${issueBrief(t)}

${WORKTREE}Name your branch claude/${t.id.toLowerCase()} and create it from origin/${BASE_BRANCH} as described above. Commit and push it with \`git push -u origin claude/${t.id.toLowerCase()}\`. Do not open a pull request — a reviewer runs before the PR is opened.

Report the branch name, what you did, the commands you ran with their real results, and any acceptance checkbox you could not satisfy.`

const reviewPrompt = (t, impl, round) => `${brief(REVIEWER)}Review branch ${impl.branch} against backlog task ${t.id} - ${t.title}.${
  round > 1
    ? `\n\nThis is review round ${round}; a previous round returned blocking findings that the implementer has since addressed. Verify the fixes rather than assuming them.`
    : ''
}

The task's live record is issue #${t.issue}. Read it with \`mcp__github__issue_read\` — including its comments — and treat every ticked acceptance checkbox as a claim to verify against the diff, exactly like a line in the implementer's summary. A box ticked without the code to support it is a blocking finding. Do not tick, untick, or close anything yourself.${
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

const fixPrompt = (t, impl, review) => `${brief(IMPLEMENTER)}Address blocking review findings on branch ${impl.branch} for backlog task ${t.id} - ${t.title}.

${WORKTREE}Check the branch out with \`git fetch origin ${impl.branch} && git checkout -b ${impl.branch} origin/${impl.branch}\`, fix every finding below, re-run the full check suite, and push to the same branch. Do not rewrite unrelated code and do not widen scope.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

Report the same structured result as the original implementation, describing the branch as it now stands.`

const prPrompt = (t, impl) => `Open a pull request for branch ${impl.branch} into ${BASE_BRANCH}.

Check the repository for a PR template and mirror its structure if one exists. Title it "${t.id} - ${t.title}". In the body, describe the change, link the task's PRD requirements, list the acceptance checkboxes met, and state that the branch passed an Opus review round in the implementation workflow.

If the task changed anything a user sees, the implementer captured a screenshot of the result — put it in the body's Screenshots section (before/after, or a short GIF for an interaction), naming the route/view and theme. If the implementer reported no screenshot for a UI-changing task, capture one before opening the PR: run the app with the in-memory mock backend (\`VITE_MOCK_BACKEND=true bun run dev\`), reach the affected view and screenshot it. A PR with no user-visible change says so in that section instead.

Include \`Closes #${t.issue}\` in the body so merging closes the task's issue.

End the PR body with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.

Return the pull request URL.`

// One task: implement (Sonnet, or Opus for the shared registries and frameworks)
// -> review (Opus) -> fix -> re-review, then open the PR. Each stage runs in its
// own worktree; the branch is how state travels between them, which is why every
// stage pushes.
async function runTask(t) {
  const model = CONTRACT_TASKS.includes(t.id) ? 'opus' : 'sonnet'

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

// Alpha Milestone 1 is scheduled from the `deps` graph rather than from hard-coded waves.
// The backlog calls its Dependencies lines "the machine-readable work graph", and
// hand-maintained waves drift from it silently: a dependency added to the backlog
// but not to the wave list produces a task that runs before what it needs, and
// nothing detects it. This loop cannot drift — it derives the order every run.
//
// Each round takes every task whose Alpha Milestone 1 dependencies have all landed and runs
// them concurrently. The concurrency cap queues the excess, so a wide round is
// safe. Alpha Milestone 0 dependencies are deliberately absent from `deps`: they are already
// on the base branch, and a scheduler can only satisfy dependencies it runs.
const results = []
const landed = new Set()
const pending = TASKS.filter((t) => wanted(t.id))

// A dependency the caller filtered out is treated as already satisfied — running
// `LOOP-010` alone must not deadlock waiting for a `LOOP-005` this invocation was
// never asked to run. That is only sound because anything not run here is either
// already merged or knowingly excluded by the caller.
const ready = (t) => t.deps.every((d) => !wanted(d) || landed.has(d))

let round = 0
while (pending.length) {
  round += 1
  const batch = pending.filter(ready)

  // Nothing ready and tasks still pending means a dependency failed to land, not
  // a cycle: `ready` treats filtered-out deps as satisfied, so the only way to
  // stall is an unlanded dependency of something still waiting. Report which.
  if (!batch.length) {
    const stalled = pending.map((t) => `${t.id} (needs ${t.deps.filter((d) => wanted(d) && !landed.has(d)).join(', ')})`)
    log(`Stalled after round ${round - 1} — these never became runnable: ${stalled.join('; ')}`)
    for (const t of pending) results.push({ id: t.id, status: 'skipped', reason: 'dependency did not land' })
    break
  }

  phase(batch[0].phase)
  log(`Round ${round}: ${batch.map((t) => t.id).join(', ')}`)

  const outcomes = await parallel(batch.map((t) => () => runTask(t)))
  for (const r of outcomes) {
    if (!r) continue
    results.push(r)
    if (r.status === 'approved') landed.add(r.id)
  }

  for (const t of batch) pending.splice(pending.indexOf(t), 1)
}

const approved = results.filter((r) => r.status === 'approved')
log(`Alpha Milestone 1: ${approved.length}/${results.length} tasks approved and raised as PRs`)

return {
  results,
  approved: approved.map((r) => `${r.id} ${r.pr ?? r.branch}`),
  notApproved: results.filter((r) => r.status !== 'approved').map((r) => `${r.id} (${r.status})`),
}
