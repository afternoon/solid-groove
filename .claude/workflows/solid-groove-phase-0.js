export const meta = {
  name: 'solid-groove-phase-0',
  description:
    'Implement Solid Groove Phase 0 (FND-001..009) — Sonnet implements, Opus reviews every branch before its PR opens',
  whenToUse:
    'Run to execute Phase 0 of docs/backlog.md. Pass args to run a subset, e.g. args: ["FND-001","FND-002"].',
  phases: [
    { title: 'Tooling', detail: 'FND-001 — test, CI and emulator foundation' },
    { title: 'Contracts', detail: 'FND-002 domain schema, then command kernel, repository and projections', model: 'opus' },
    { title: 'Runtime', detail: 'FND-006 AudioRuntime and FND-008 renderer harness' },
    { title: 'Graph', detail: 'FND-007 stable ID-keyed audio graph' },
    { title: 'Slice', detail: 'FND-009 vertical slice gate' },
  ],
}

// Model policy, per the decision recorded in docs/prd.md section 16:
// contract-owning tasks run on Opus because an error there propagates into every
// dependent task and surfaces late; everything else runs on Sonnet. Review is
// always Opus, at high effort, and runs before any PR is opened.
const CONTRACT_TASKS = ['FND-002', 'FND-003', 'FND-004']
const BASE_BRANCH = 'claude/dynamic-workflow-clarity-tvo8hv'
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

`

const TASKS = [
  { id: 'FND-001', phase: 'Tooling', title: 'Test and development foundation' },
  { id: 'FND-002', phase: 'Contracts', title: 'Canonical schema-v1 domain model' },
  { id: 'FND-003', phase: 'Contracts', title: 'Command, transaction, and history kernel' },
  { id: 'FND-004', phase: 'Contracts', title: 'Firebase schema-v1 repository' },
  { id: 'FND-005', phase: 'Contracts', title: 'Selection and consumer projections' },
  { id: 'FND-006', phase: 'Runtime', title: 'Single-context AudioRuntime and diagnostics' },
  { id: 'FND-007', phase: 'Graph', title: 'Stable ID-keyed audio graph' },
  { id: 'FND-008', phase: 'Runtime', title: 'Arrangement renderer spike and measurement harness' },
  { id: 'FND-009', phase: 'Slice', title: 'Foundation vertical slice gate' },
]

// Fail loud on a malformed subset request. `args` passed as a JSON-encoded
// string ('["FND-001"]') rather than a real array is not an array, so the old
// `Array.isArray(args) ? ... : null` silently degraded "run one task" into
// "run the entire phase" — which is exactly what happened once, opening PRs
// for six tasks that were never asked for. A bad filter must stop the run.
if (args !== undefined && args !== null && !Array.isArray(args)) {
  throw new Error(
    `args must be an array of task ids, got ${typeof args}: ${JSON.stringify(args)}. ` +
      'Pass a real JSON array (args: ["FND-001"]), not a JSON-encoded string — ' +
      'a stringified list reaches the script as one string and would run every task.',
  )
}
const known = new Set(TASKS.map((t) => t.id))
const unknown = (args ?? []).filter((id) => !known.has(id))
if (unknown.length) {
  throw new Error(
    `args contains unknown task id(s): ${unknown.join(', ')}. Known ids: ${[...known].join(', ')}.`,
  )
}

const only = Array.isArray(args) && args.length ? new Set(args) : null
const task = (id) => TASKS.find((t) => t.id === id)
const wanted = (id) => !only || only.has(id)

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

const implPrompt = (t, base) => `${brief(IMPLEMENTER)}Implement backlog task ${t.id} - ${t.title}.

Read its task block in docs/backlog.md and every PRD requirement the block links, then implement it in full: product code, tests, fixtures and any documentation the task requires.

${WORKTREE}Name your branch claude/${t.id.toLowerCase()} and create it from origin/${base} as described above. Commit and push it with \`git push -u origin claude/${t.id.toLowerCase()}\`. Do not open a pull request — a reviewer runs before the PR is opened.

Report the branch name, what you did, the commands you ran with their real results, and any acceptance checkbox you could not satisfy.`

const reviewPrompt = (t, impl, round) => `${brief(REVIEWER)}Review branch ${impl.branch} against backlog task ${t.id} - ${t.title}.${
  round > 1 ? `\n\nThis is review round ${round}; a previous round returned blocking findings that the implementer has since addressed. Verify the fixes rather than assuming them.` : ''
}

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
    log('FND-001 did not land — stopping. Every Phase 0 task depends on it.')
    return { results, stoppedAt: 'FND-001' }
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

phase('Graph')
if (wanted('FND-007')) record(await runTask(task('FND-007')))

// Gate G2. The slice proves the boundaries together, so it runs last and alone.
phase('Slice')
if (wanted('FND-009')) record(await runTask(task('FND-009')))

const approved = results.filter((r) => r.status === 'approved')
log(`Phase 0: ${approved.length}/${results.length} tasks approved and raised as PRs`)

return {
  results,
  approved: approved.map((r) => `${r.id} ${r.pr ?? r.branch}`),
  blocked: results.filter((r) => r.status !== 'approved').map((r) => `${r.id} (${r.status})`),
}
