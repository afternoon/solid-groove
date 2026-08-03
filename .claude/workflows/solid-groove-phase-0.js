export const meta = {
  name: 'solid-groove-phase-0',
  description:
    'Implement Solid Groove Alpha Milestone 0 (FND-001..009) — Sonnet implements, Opus reviews every branch before its PR opens',
  whenToUse:
    'Run to execute Alpha Milestone 0. Name tasks to run a subset, either positionally (solid-groove-phase-0 FND-003 FND-004) or as args: ["FND-003","FND-004"]. Omit them entirely to run the whole phase. Named tasks still execute in dependency order, not the order given.',
  phases: [
    { title: 'Tooling', detail: 'FND-001 test and CI foundation, then FND-001b deploy pipeline and FND-001c analytics catalog' },
    { title: 'Contracts', detail: 'FND-002 domain schema, then command kernel, repository and projections', model: 'opus' },
    { title: 'Packs', detail: 'FND-002b pack-qualified asset identity, then CNT-000b repacking the starter library' },
    { title: 'Runtime', detail: 'FND-006 AudioRuntime and FND-008 renderer harness' },
    { title: 'Graph', detail: 'FND-007 stable ID-keyed audio graph' },
    { title: 'Slice', detail: 'FND-009 vertical slice gate' },
  ],
}

// Model policy, per the decision recorded in docs/prd.md section 16:
// contract-owning tasks run on Opus because an error there propagates into every
// dependent task and surfaces late; everything else runs on Sonnet. Review is
// always Opus, at high effort, and runs before any PR is opened.
// FND-001c is included because its own issue declares it contract-owning:
// it publishes the analytics catalog every Alpha Milestone 1-4 feature task extends.
// FND-002b is contract-owning for the same reason FND-002 is: it changes the
// landed schema-v1 asset identity, and every saved project and every later
// content task reads that shape.
const CONTRACT_TASKS = ['FND-001c', 'FND-002', 'FND-002b', 'FND-003', 'FND-004']

// Alpha Milestone 0 is complete and on `main`, including the docs commit that moved
// hosted-environment verification to `OPS-001` (after Alpha Milestone 2) — the commit that
// tells an agent its deployed-build checkboxes are out of scope rather than
// unmet. This was pinned to the staging feature branch while that was unmerged;
// it points at `main` now, so a re-run of any single task branches from the real
// tip rather than from a snapshot that predates `FND-009`.
const BASE_BRANCH = 'main'
const MAX_REVIEW_ROUNDS = 2

// The agent registry is read once at session start, so `agentType` cannot resolve
// a definition added during the same session. Each agent reads its own definition
// from the repo instead — one source of truth, and it works on a cold session.
const IMPLEMENTER = '.claude/agents/solid-groove-implementer.md'
const REVIEWER = '.claude/agents/solid-groove-reviewer.md'
const brief = (path) => `Read \`${path}\` and follow it as your operating instructions for this task.\n\n`

// Worktree ground rules. Two traps, both of which have already bitten a run:
// a worktree starts at the commit that was HEAD when the session began, not at
// the base branch tip; and git refuses to check out a branch that is already
// checked out in the main worktree, so `git checkout ${BASE_BRANCH}` always
// fails here. Branch from the remote ref instead. Absolute /home/user/solid-groove
// paths resolve to the main repo, not to the worktree, so they read stale-free
// files while git operates somewhere else entirely — always work from your own root.
const WORKTREE = `## Your worktree

You are in a git worktree, not the main checkout. Two things follow:

- \`cd "$(git rev-parse --show-toplevel)"\` first, and use paths relative to that root. An absolute \`/home/user/solid-groove/...\` path points at a different checkout and will silently mislead you.
- Your worktree starts at an older commit, and \`${BASE_BRANCH}\` cannot be checked out here because the main worktree holds it. Always branch from the remote ref:
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

// FND-001b and FND-001c are the only Alpha Milestone 0 tasks that depend on things outside
// this repository — a Firebase project, a GA4 property, a Sentry org, and the CI
// secrets for all three. An agent cannot provision those, and the failure mode is
// not "it stops": it is inventing a plausible project id or DSN, committing it,
// and reporting a deploy that never happened. Say so in the task brief.
const NO_CREDENTIALS = `

This task provisions no accounts and holds no secrets. Assume the Firebase project, CI service account, GA4 property, and Sentry org/DSN/auth token are NOT available to you. Never invent a project id, DSN, token, or key; never commit a placeholder shaped like a real one; and never report a deploy, smoke test, rollback, or delivered event as having happened when it did not.

Implement everything that does not need them: the pipeline, configuration, catalog, boundaries, tests, and documentation, referring to every credential by name through CI secrets and \`.env.example\`.

Hosted-environment verification has been **moved out of Alpha Milestone 0** to task \`OPS-001\`, after Alpha Milestone 2 (PRD section 12, "After Alpha Milestone 2"). Your task block marks the affected checkboxes in bold. Those are **out of scope for you, not unmet by you**: put them in \`outOfScope\`, not \`unmet\`, and satisfy the automated-test half of each one that remains yours. Reserve \`unmet\` for something you were genuinely supposed to deliver and could not.`

// `issue` is the GitHub issue number that is the task's live record. Only the
// three tasks that were still in flight when the issue convention was adopted
// have one; FND-001..008 and CNT-000 landed before it and are recorded in git
// history instead. A task with no issue number
// simply gets no issue instructions in its brief.
const TASKS = [
  { id: 'FND-001', phase: 'Tooling', title: 'Test and development foundation' },
  { id: 'FND-001b', phase: 'Tooling', title: 'Firebase deployment and hosted alpha environment', note: NO_CREDENTIALS },
  { id: 'FND-001c', phase: 'Tooling', title: 'Analytics and error-monitoring foundation', note: NO_CREDENTIALS },
  { id: 'FND-002', phase: 'Contracts', title: 'Canonical schema-v1 domain model' },
  { id: 'FND-002b', phase: 'Packs', title: 'Packs and pack-qualified asset identity', issue: 81 },
  // CNT-000b depends on CNT-000, which is not in this workflow: the starter
  // library was built outside it and is already on the base branch. CNT-000b
  // only repacks what is there, so it needs no run-order gate beyond FND-002b.
  { id: 'CNT-000b', phase: 'Packs', title: 'Deliver the starter library as packs', issue: 82 },
  { id: 'FND-003', phase: 'Contracts', title: 'Command, transaction, and history kernel' },
  { id: 'FND-004', phase: 'Contracts', title: 'Firebase schema-v1 repository' },
  { id: 'FND-005', phase: 'Contracts', title: 'Selection and consumer projections' },
  { id: 'FND-006', phase: 'Runtime', title: 'Single-context AudioRuntime and diagnostics' },
  { id: 'FND-007', phase: 'Graph', title: 'Stable ID-keyed audio graph' },
  { id: 'FND-008', phase: 'Runtime', title: 'Arrangement renderer spike and measurement harness' },
  { id: 'FND-009', phase: 'Slice', title: 'Foundation vertical slice gate', note: NO_CREDENTIALS, issue: 83 },
]

// The issue is the task's specification and live record. Spelled out
// in the brief because an agent that has to infer the protocol either skips it
// or invents its own; both leave the board lying about what happened.
const issueBrief = (t) =>
  t.issue
    ? `\n\n## Your GitHub issue\n\nTask ${t.id} is tracked in \`afternoon/solid-groove\` issue **#${t.issue}** — its body is the specification and it is the live record. Use the **\`gh\` CLI**; there is **no GitHub MCP server** here (\`gh\` is already authenticated: \`gh issue view ${t.issue}\`, \`gh issue comment ${t.issue} --body ...\`, \`gh issue edit ${t.issue} --add-assignee afternoon\`).\n\n- Assign #${t.issue} to \`afternoon\` and comment that you have started, naming the branch you will push to, **before** you change product code.\n- Tick the acceptance checkboxes on #${t.issue} as you genuinely satisfy them. Never tick one you have not. A reviewer treats a ticked box as a claim to verify, and a box ticked without supporting code is itself a blocking finding.\n- Comment when something is worth knowing — a blocker, a decision you had to make, a discovery belonging to another task — not once per commit.\n- Do **not** close the issue. A reviewer runs after you and the PR closes it on merge.\n- End every comment with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.`
    : ''

// Normalise the subset request, and fail loud on anything malformed.
//
// The rule that matters: a filter the script cannot understand must stop the
// run, never degrade into "run every task". An early version used
// `Array.isArray(args) ? ... : null`, so a non-array `args` fell through to
// null and ran the entire phase — that once opened PRs for six tasks nobody
// asked for. Every branch below either yields a non-empty id list or throws.
//
// Three accepted forms, because callers differ in what they can send:
//
//   real array          ["FND-003", "FND-004"]
//   JSON-encoded array  '["FND-003","FND-004"]'   the Workflow tool's transport
//                                                 stringifies args, so this is
//                                                 what usually arrives
//   positional list     'FND-003 FND-004'         what a slash-command run
//                       'FND-003,FND-004'         sends, since the Skill tool
//                                                 passes args as one string
//
// Ids are matched case-insensitively; they are validated against TASKS below,
// so a typo is still an error rather than a silently dropped filter.
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
        'whole phase, or name the tasks to run, e.g. "FND-003 FND-004".',
    )
  }
  return ids
}

// Compare on the normalised form on BOTH sides. Ids are not uniformly upper-case
// any more — FND-001b and FND-001c carry a lower-case suffix — so matching a
// normalised filter against a raw task id would reject every filter naming them.
const taskIds = parseTaskIds(args)
const known = new Set(TASKS.map((t) => normaliseId(t.id)))
const unknown = (taskIds ?? []).filter((id) => !known.has(id))
if (unknown.length) {
  throw new Error(
    `args contains unknown task id(s): ${unknown.join(', ')}. Known ids: ${TASKS.map((t) => t.id).join(', ')}.`,
  )
}

// parseTaskIds returns null or a non-empty list, so this needs no length check.
const only = taskIds ? new Set(taskIds) : null
const task = (id) => TASKS.find((t) => t.id === id)
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

const implPrompt = (t, base) => `${brief(IMPLEMENTER)}Implement task ${t.id} - ${t.title}${t.issue ? ` (issue #${t.issue})` : ''}.

${t.issue ? `Read the issue body — it is the specification — with \`gh issue view ${t.issue}\`` : 'Read the task specification'} and every PRD requirement it links, then implement it in full: product code, tests, fixtures and any documentation the task requires.${t.note ?? ''}${issueBrief(t)}

${WORKTREE}Name your branch claude/${t.id.toLowerCase()} and create it from origin/${base} as described above. Commit and push it with \`git push -u origin claude/${t.id.toLowerCase()}\`. Do not open a pull request — a reviewer runs before the PR is opened.

Report the branch name, what you did, the commands you ran with their real results, and any acceptance checkbox you could not satisfy.`

const reviewPrompt = (t, impl, round) => `${brief(REVIEWER)}Review branch ${impl.branch} against task ${t.id} - ${t.title}${t.issue ? ` (issue #${t.issue})` : ''}.${
  round > 1 ? `\n\nThis is review round ${round}; a previous round returned blocking findings that the implementer has since addressed. Verify the fixes rather than assuming them.` : ''
}${
  t.issue
    ? `\n\nThe task's specification and live record is issue #${t.issue}. Read it with \`gh issue view ${t.issue} --comments\` (use the **\`gh\` CLI**; there is **no GitHub MCP server** here) — including its comments — and treat every ticked acceptance checkbox as a claim to verify against the diff, exactly like a line in the implementer's summary. A box ticked without the code to support it is a blocking finding. Do not tick, untick, or close anything yourself.`
    : ''
}

${WORKTREE}Fetch and check out the branch under review with \`git fetch origin ${impl.branch} && git checkout -b review-${t.id.toLowerCase()} origin/${impl.branch}\`, then read the actual diff against origin/${BASE_BRANCH}. Run the test suite yourself.

The implementer reported:
${impl.summary}

Commands it claims to have run: ${impl.checksRun.map((c) => `${c.command} -> ${c.passed ? 'pass' : 'FAIL'}`).join('; ') || 'none reported'}
Checkboxes it reports unmet: ${impl.unmet.length ? impl.unmet.join('; ') : 'none'}

Treat all of that as claims to verify, not findings to accept.`

const fixPrompt = (t, impl, review) => `${brief(IMPLEMENTER)}Address blocking review findings on branch ${impl.branch} for task ${t.id} - ${t.title}${t.issue ? ` (issue #${t.issue})` : ''}.

${WORKTREE}Check the branch out with \`git fetch origin ${impl.branch} && git checkout -b ${impl.branch} origin/${impl.branch}\`, fix every finding below, re-run the full check suite, and push to the same branch. Do not rewrite unrelated code and do not widen scope.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

Report the same structured result as the original implementation, describing the branch as it now stands.`

const prPrompt = (t, impl) => `Open a pull request for branch ${impl.branch} into ${BASE_BRANCH}.

Check the repository for a PR template and mirror its structure if one exists. Title it "${t.id} - ${t.title}". In the body, describe the change, link the task's PRD requirements, list the acceptance checkboxes met, and state that the branch passed an Opus review round in the implementation workflow.${
  t.issue ? `\n\nInclude \`Closes #${t.issue}\` in the body so merging closes the task's issue.` : ''
}

If the task changed anything a user sees, the implementer captured a walkthrough of the result — put it in the body's Walkthrough section. Prefer a short video that starts from a common entrypoint (the public landing page, the project dashboard, or a project page) and navigates to the change; a GIF or before/after screenshots are an acceptable fallback for a small visual tweak. Name the entrypoint and theme. If the implementer reported no walkthrough for a UI-changing task, capture one before opening the PR: run the app with the in-memory mock backend (\`VITE_MOCK_BACKEND=true bun run dev\`), start from one of those entrypoints and record navigating to the affected view. A PR with no user-visible change says so in that section instead.

End the PR body with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.

Return the pull request URL.`

// One task: implement (Sonnet, or Opus for contracts) -> review (Opus) -> fix ->
// re-review, then open the PR. Each stage runs in its own worktree; the branch is
// how state travels between them, which is why every stage pushes.
async function runTask(t) {
  const model = CONTRACT_TASKS.includes(t.id) ? 'opus' : 'sonnet'

  let impl = await agent(implPrompt(t, BASE_BRANCH), {
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

const results = []
const record = (r) => { if (r) results.push(r) }
const landed = (id) => results.some((r) => r.id === id && r.status === 'approved')

// Gate G0. Everything else depends on the tooling existing.
phase('Tooling')
if (wanted('FND-001')) {
  record(await runTask(task('FND-001')))
  if (!landed('FND-001')) {
    log('FND-001 did not land — stopping. Every Alpha Milestone 0 task depends on it.')
    return { results, stoppedAt: 'FND-001' }
  }
}

// FND-001b then FND-001c, strictly in that order and never alongside each other:
// the deploy pipeline has to exist before analytics can stamp a release against
// it or upload source maps through it. Each gate fires only when the task
// actually ran, so a subset filter that omits one does not halt the run.
for (const id of ['FND-001b', 'FND-001c']) {
  if (!wanted(id)) continue
  record(await runTask(task(id)))
  if (!landed(id)) {
    log(`${id} did not land — stopping before the work that depends on it.`)
    return { results, stoppedAt: id }
  }
}

// FND-002 owns the domain contract and must land before its dependents start.
// FND-006 and FND-008 own separate boundaries and run alongside it.
phase('Contracts')
const contractRound = await parallel([
  () => (wanted('FND-002') ? runTask(task('FND-002')) : null),
  () => (wanted('FND-006') ? runTask(task('FND-006')) : null),
  () => (wanted('FND-008') ? runTask(task('FND-008')) : null),
])
for (const r of contractRound) record(r)

if (wanted('FND-002') && !landed('FND-002')) {
  log('FND-002 did not land — stopping before dependent contract work.')
  return { results, stoppedAt: 'FND-002' }
}

// Dependents of the domain schema, concurrent with each other.
const dependents = await parallel([
  () => (wanted('FND-003') ? runTask(task('FND-003')) : null),
  () => (wanted('FND-004') ? runTask(task('FND-004')) : null),
  () => (wanted('FND-005') ? runTask(task('FND-005')) : null),
])
for (const r of dependents) record(r)

// FND-002b is a contract change to the landed FND-002 schema: it makes asset
// identity pack-qualified. It runs alone, and CNT-000b runs strictly after it
// rather than alongside, because CNT-000b's manifests have to emit the exact
// pack shape FND-002b's parser accepts — run them concurrently and the two
// agents each invent half of an incompatible format.
phase('Packs')
if (wanted('FND-002b')) {
  record(await runTask(task('FND-002b')))
  if (!landed('FND-002b')) {
    log('FND-002b did not land — stopping before CNT-000b and FND-009, which both consume the pack contract.')
    return { results, stoppedAt: 'FND-002b' }
  }
}
if (wanted('CNT-000b')) record(await runTask(task('CNT-000b')))

phase('Graph')
if (wanted('FND-007')) record(await runTask(task('FND-007')))

// Gate G2. The slice proves the boundaries together, so it runs last and alone.
// It integrates six other tasks, so running it against one that just failed to
// land wastes both review rounds on findings the branch cannot fix. Gate only on
// tasks this invocation actually attempted — anything already merged on the base
// branch is not in `results` and must not be treated as missing.
phase('Slice')
if (wanted('FND-009')) {
  const unlanded = ['FND-001c', 'FND-002b', 'FND-003', 'FND-004', 'FND-005', 'FND-007', 'FND-008'].filter(
    (id) => wanted(id) && !landed(id),
  )
  if (unlanded.length) {
    log(`FND-009 skipped — ${unlanded.join(', ')} ran in this invocation without landing.`)
  } else {
    record(await runTask(task('FND-009')))
  }
}

const approved = results.filter((r) => r.status === 'approved')
log(`Alpha Milestone 0: ${approved.length}/${results.length} tasks approved and raised as PRs`)

return {
  results,
  approved: approved.map((r) => `${r.id} ${r.pr ?? r.branch}`),
  blocked: results.filter((r) => r.status !== 'approved').map((r) => `${r.id} (${r.status})`),
}
