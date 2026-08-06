export const meta = {
  name: 'solid-groove-feature',
  description:
    'Implement one Solid Groove issue core-flow first: spec the flows, review the spec, implement, review, land the stack, capture the walkthrough',
  whenToUse:
    'Run to implement ONE GitHub issue in afternoon/solid-groove that links core flow IDs (CF-001, ...). Pass the issue number: { issue: 123 } (or just 123). The pipeline writes each linked flow as a test.fixme Playwright spec and lands it as the first PR in the stack, has that spec adversarially reviewed BEFORE any implementation exists, implements the feature on top of it, reviews and fixes for up to two rounds, opens the rest of the stack, then removes the fixme markers, captures the screenshot walkthrough from the now-passing flows and labels the top PR deploy-preview. Use solid-groove-phase-1 instead to drain a whole milestone unattended.',
  phases: [
    { title: 'Spec', detail: 'write each linked core flow as a test.fixme spec, and review it before anything is built' },
    { title: 'Implement', detail: 'build the feature on top of the frozen spec' },
    { title: 'Review', detail: 'adversarial Opus review, up to two rounds with fixes' },
    { title: 'Land', detail: 'open the stack of ≤400-line PRs' },
    { title: 'Walkthrough', detail: 'capture the screenshots from the passing flows and request a preview deploy' },
  ],
}

// The ordering here is the whole point, so it is worth stating plainly: the
// acceptance contract is written, reviewed and merged BEFORE the implementation
// exists. An agent that writes the test and the code in one pass bends the test
// toward the code, and nobody can tell afterwards. Splitting them across agents
// and putting a review between them is what makes the contract mean something.
//
// The specs land as `test.fixme`. That is not a compromise — this repo requires
// every slice to be green on its own commit so the front of a stack can merge
// without the back (CLAUDE.md, "Landing work"), and a deliberately red PR 1 would
// either block the stack or turn `main` red for every other parallel task. A
// fixme spec is skipped, so PR 1 is honestly green, and the marker is the thing
// the closing PR removes. The red->green evidence lives in the run log, which is
// where it was always more useful than in a merge.
const BASE_BRANCH = 'main'
const MAX_REVIEW_ROUNDS = 2

// Agents read their own definition from the repo: the agent registry is read once
// at session start, so `agentType` cannot resolve a definition added or edited in
// the same session, and these are edited often.
const FLOW_AUTHOR = '.claude/agents/solid-groove-flow-author.md'
const IMPLEMENTER = '.claude/agents/solid-groove-implementer.md'
const REVIEWER = '.claude/agents/solid-groove-reviewer.md'
const brief = (path) => `Read \`${path}\` and follow it as your operating instructions for this task.\n\n`

// Four traps, each of which has already cost a run in the phase-1 workflow. Kept
// verbatim so the two workflows cannot drift on environment facts.
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

const NO_HOSTED_ENV = `

Your analytics obligation is not deferred: emit your task's PRD OPS-02 events through the shared typed catalog in \`src/analytics\`, extend the catalog in the same change if your feature introduces an action it does not cover, and prove each event fires exactly once per action with an automated test. Only *observing* those events arriving from a deployed build moved to \`OPS-001\`. Never invent a project id, DSN, token or key, and never report a deploy, smoke test or delivered event that did not happen.`

const ISSUE_SCHEMA = {
  type: 'object',
  required: ['issue', 'taskId', 'title', 'flows', 'changesUi'],
  properties: {
    issue: { type: 'number' },
    taskId: { type: 'string', description: 'Task id parsed from the title, e.g. LOOP-004' },
    title: { type: 'string', description: 'Task title without the id prefix' },
    flows: {
      type: 'array',
      description: 'Core flow IDs the issue links, e.g. ["CF-004","CF-005"]. Empty if the issue links none.',
      items: { type: 'string' },
    },
    changesUi: { type: 'boolean', description: 'True if the task changes anything a user sees' },
    decisionBlockers: {
      type: 'array',
      description: 'Open DEC-* decision issues blocking this task, by DEC id',
      items: { type: 'string' },
    },
  },
}

const SPEC_SCHEMA = {
  type: 'object',
  required: ['branch', 'specs', 'summary'],
  properties: {
    branch: { type: 'string' },
    specs: { type: 'array', description: 'Spec file paths written', items: { type: 'string' } },
    summary: { type: 'string' },
    unspecified: {
      type: 'array',
      description: 'Flows that could NOT be specced, with the reason. Empty if all were.',
      items: { type: 'string' },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['branches', 'summary', 'checksRun', 'unmet'],
  properties: {
    branches: {
      type: 'array',
      description: 'Every branch pushed, in stack order, first slice first',
      items: { type: 'string' },
    },
    summary: { type: 'string' },
    checksRun: {
      type: 'array',
      items: {
        type: 'object',
        required: ['command', 'passed'],
        properties: { command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
      },
    },
    flowsPassing: { type: 'boolean', description: 'True if every linked flow spec has its test.fixme removed and passes' },
    unmet: { type: 'array', description: 'Acceptance checkboxes NOT satisfied, with the reason', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
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
    captured: { type: 'boolean', description: 'True if the flow specs ran and produced screenshots' },
    published: { type: 'boolean', description: 'True if the images reached the claude/walkthroughs branch and the PR body was updated' },
    labelled: { type: 'boolean', description: 'True if deploy-preview was added to the top PR' },
    flows: { type: 'array', description: 'Flow IDs captured, with the step count', items: { type: 'string' } },
    detail: { type: 'string', description: 'What happened, especially anything that failed' },
  },
}

const attribution = `End every issue comment and PR body with a blank line, a \`---\` rule, then \`_Generated by [Claude Code](https://claude.ai/code)_\`.`

const gh = `Use the **\`gh\` CLI** for every GitHub read and write — it is already authenticated. There is no GitHub MCP server in this environment; do not look for \`mcp__github__*\` tools.`

const discoverPrompt = (issue) => `Report the live state of \`afternoon/solid-groove\` issue **#${issue}**. ${gh} This is **read-only** — change nothing.

Read the issue with \`gh issue view ${issue} --json number,title,body,labels\` and return:

- \`taskId\` and \`title\`, parsed from the title, which is formatted \`TASK-ID - Title\` (e.g. "LOOP-004 - Synth and one-shot sampler").
- \`flows\`: every **core flow ID** the body references, matching \`CF-\` followed by three digits. These are the user journeys the feature must deliver; they are described in \`docs/core-flows.md\`. Return them in ascending order, de-duplicated. Return an empty array if the issue links none — do not invent one, and do not infer one from the acceptance criteria.
- \`changesUi\`: true if delivering this task changes anything a user sees — a new or changed component, layout, styling, copy or interaction. Judge from the issue body and its linked PRD requirements.
- \`decisionBlockers\`: any open \`DEC-*\` decision issue in this issue's native \`blocked_by\` graph (\`gh api repos/afternoon/solid-groove/issues/${issue}/dependencies/blocked_by\`), by DEC id.

Read every value from GitHub. Do not guess any of it.`

const decisionBlocked = (decisions) => `

## Blocked on a product decision

This task depends on ${decisions.map((d) => `\`${d}\``).join(' and ')}, which ${decisions.length > 1 ? 'have' : 'has'} **not been decided**. ${decisions.length > 1 ? 'They are' : 'It is'} the product owner's call, not yours.

**Do not guess ${decisions.length > 1 ? 'them' : 'it'}.** Do not pick a plausible default, do not infer one from the design mocks, and do not let a library's default silently become product behavior. A confident implementation of an undecided policy is worse than an honest gap, because nothing later flags it as unreviewed.

Implement everything that does not depend on the decision, and design the boundary so the decision drops in as configuration rather than a rewrite. List every acceptance checkbox you could not close in \`unmet\`, naming the decision, and comment the same on the issue.`

const specPrompt = (t) => `${brief(FLOW_AUTHOR)}Write the core-flow specs for task ${t.taskId} - ${t.title}, tracked as issue #${t.issue}.

The issue links ${t.flows.length === 1 ? 'this core flow' : 'these core flows'}: ${t.flows.join(', ')}. Each is described in plain English in \`docs/core-flows.md\`. Turn each into one Playwright spec, marked \`test.fixme\`, that reproduces it exactly. **Do not implement the feature.** ${gh}

${WORKTREE}Branch from \`origin/${BASE_BRANCH}\`, name your branch \`claude/${t.taskId.toLowerCase()}-flows\`, and push it with \`git push -u origin claude/${t.taskId.toLowerCase()}-flows\`. Do not open a pull request — a reviewer runs before the PR is opened.

${attribution}

Report the branch, the spec files you wrote, and any flow you could not spec with the reason.`

const specReviewPrompt = (t, spec, round) => `${brief(REVIEWER)}Review the **flow-spec branch** \`${spec.branch}\` for task ${t.taskId} - ${t.title} (issue #${t.issue}).

Follow the "Reviewing a flow-spec branch" section of your instructions — this is the first PR in the stack, the specs are \`test.fixme\`, and no implementation exists yet. What you approve here becomes the frozen acceptance contract for everything that follows, so a vague spec approved now cannot be recovered later.${
  round > 1 ? `\n\nThis is review round ${round}; a previous round returned blocking findings the author has since addressed. Verify the fixes rather than assuming them.` : ''
}

Flows under review: ${t.flows.join(', ')} — read each one in \`docs/core-flows.md\` and compare it step by step against the spec. ${gh}

${WORKTREE}Fetch and check out \`${spec.branch}\`, then read its actual diff against \`origin/${BASE_BRANCH}\`. Run \`bun run verify:core-flows\` and \`bun run test:browser:chromium\` yourself.

The author reported:
${spec.summary}

Flows it reports it could NOT spec: ${spec.unspecified?.length ? spec.unspecified.join('; ') : 'none'}

Treat all of that as claims to verify, not findings to accept.`

const specFixPrompt = (t, spec, review) => `${brief(FLOW_AUTHOR)}Address blocking review findings on the flow-spec branch \`${spec.branch}\` for task ${t.taskId} (issue #${t.issue}).

${WORKTREE}Check the branch out from \`origin/${spec.branch}\`, fix every finding below, re-run \`bun run verify:core-flows\` and \`bun run test:browser:chromium\`, and push to the same branch. Do not widen scope, and do not start implementing the feature.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

Report the same structured result as the original spec run, describing the branch as it now stands.`

const specPrPrompt = (t, spec) => `Open the **first PR in the stack** for task ${t.taskId} - ${t.title}: the core-flow specs on branch \`${spec.branch}\`. ${gh}

\`gh pr create --base ${BASE_BRANCH} --head ${spec.branch}\`. Title it "${t.taskId} - core flow specs (1 of N)". Mirror \`.github/pull_request_template.md\`.

The body must say, in its own words:
- Which flows this specs (${t.flows.join(', ')}), linking \`docs/core-flows.md\`.
- That the specs are \`test.fixme\` **on purpose**: the implementation does not exist yet, and this repo requires every slice to be green on its own commit, so a deliberately red PR would block the stack or redden \`main\`. The marker is removed by the PR that closes the issue, in the same diff that makes the flows pass.
- That these specs are the frozen acceptance contract for the rest of the stack, and were reviewed on their own before any implementation began.
- **Walkthrough:** "No UI change — this PR adds skipped test specs only."

Use \`Refs #${t.issue}\`, never \`Closes\`. ${attribution}

Return the PR you opened.`

const implPrompt = (t, spec) => `${brief(IMPLEMENTER)}Implement task ${t.taskId} - ${t.title}, tracked as issue #${t.issue}.

Read the issue body — it is the specification — with \`gh issue view ${t.issue}\`, and every PRD requirement it links. ${gh}${NO_HOSTED_ENV}${
  t.decisionBlockers?.length ? decisionBlocked(t.decisionBlockers) : ''
}

## Your base is the flow-spec branch

${t.flows.length ? `The core flows ${t.flows.join(', ')} have already been written as Playwright specs on branch \`${spec.branch}\`, reviewed, and merged as PR 1 of your stack. **Branch your first slice off \`origin/${spec.branch}\`, not off \`${BASE_BRANCH}\`**, so your stack builds on the contract.

Those specs are frozen. Read them and \`docs/core-flows.md\` before writing code — they are what "done" means here. Do not edit their assertions to fit what you build; if one is genuinely wrong, say so on the issue and in your PR body and let the reviewer rule on it.

The slice that completes the feature removes \`test.fixme\` from every one of those specs, in the same diff that makes them pass, and captures the walkthrough. \`bun run verify:core-flows\` reports any flow still parked.` : `This issue links no core flows, so branch your first slice off \`origin/${BASE_BRANCH}\`.`}

${WORKTREE}Name your branches \`claude/${t.taskId.toLowerCase()}\`, \`claude/${t.taskId.toLowerCase()}-2\`, and so on, one per ≤400-line slice, each branched off the previous. Push every branch. Do not open pull requests — a reviewer runs before they are opened.

${attribution}

Report every branch in stack order, what you did, the commands you ran with their real results, whether the linked flows now pass, and any acceptance checkbox you could not satisfy.`

const reviewPrompt = (t, impl, round) => `${brief(REVIEWER)}Review the implementation stack for task ${t.taskId} - ${t.title} (issue #${t.issue}). Branches, in stack order: ${impl.branches.join(' -> ')}.${
  round > 1 ? `\n\nThis is review round ${round}; a previous round returned blocking findings the implementer has since addressed. Verify the fixes rather than assuming them.` : ''
}

${t.flows.length ? `Pay particular attention to check **2a, the acceptance contract**. The flows ${t.flows.join(', ')} were specced and reviewed before this implementation existed, and merged as the base of this stack. Verify with \`git diff\` that \`docs/core-flows.md\`, \`docs/prd.md\` and the flow specs under \`e2e/flows\`/\`e2e-emulator/flows\` carry no changes beyond the removal of \`test.fixme\` markers and any mechanical change the PR body called out. A spec bent toward the implementation is the most expensive thing you can miss here. Then run the flows and confirm they pass.\n\n` : ''}The task's live record is issue #${t.issue}. Read it with \`gh issue view ${t.issue} --comments\` (${gh.toLowerCase()}) and treat every ticked acceptance checkbox as a claim to verify against the diff. A box ticked without the code to support it is a blocking finding. Do not tick, untick or close anything yourself.${
  t.decisionBlockers?.length
    ? `\n\nThis task is blocked on ${t.decisionBlockers.map((d) => `\`${d}\``).join(' and ')}, which ${t.decisionBlockers.length > 1 ? 'are' : 'is'} undecided. Check specifically that the implementer did **not** invent the decision: a hardcoded retention window, template list or licence policy that reads as deliberate product behavior is blocking no matter how reasonable it looks.`
    : ''
}

Hosted-environment verification moved to \`OPS-001\`, so no deployed-build claim is owed — but the analytics obligation is: the task's OPS-02 events must have real call sites with tests proving each fires once per action. Events left for later are blocking, not a deferral.

${WORKTREE}Fetch every branch above and read the actual diff of each slice against its own base. Run the test suite yourself.

The implementer reported:
${impl.summary}

Commands it claims to have run: ${impl.checksRun.map((c) => `${c.command} -> ${c.passed ? 'pass' : 'FAIL'}`).join('; ') || 'none reported'}
Flows passing, per the implementer: ${impl.flowsPassing === undefined ? 'not reported' : impl.flowsPassing}
Checkboxes it reports unmet: ${impl.unmet.length ? impl.unmet.join('; ') : 'none'}

Treat all of that as claims to verify, not findings to accept.`

const fixPrompt = (t, impl, review) => `${brief(IMPLEMENTER)}Address blocking review findings on the stack for task ${t.taskId} - ${t.title} (issue #${t.issue}). Branches: ${impl.branches.join(' -> ')}.

${WORKTREE}Check out the affected branch(es) from their remote refs, fix every finding below in the slice it belongs to, re-run the full check suite, and push. Keep each slice under 400 lines and green on its own commit. Do not rewrite unrelated code and do not widen scope. If a finding says you weakened a frozen flow spec, restore it — do not argue with it by editing it again.

${review.blocking
  .map((b, i) => `${i + 1}. ${b.file}${b.line ? `:${b.line}` : ''} — ${b.issue}\n   Failure: ${b.failure}\n   Suggested resolution: ${b.resolution}`)
  .join('\n\n')}

Report the same structured result as the original implementation, describing the stack as it now stands.`

const prPrompt = (t, impl, specPr) => `Open the pull requests for the implementation slices of task ${t.taskId} - ${t.title} (issue #${t.issue}). ${gh}

PR 1 of the stack — the core-flow specs — is already open as ${specPr ? `#${specPr.number} on branch \`${specPr.branch}\`` : 'the flow-spec PR'}. Open one PR per implementation branch, in order: ${impl.branches.join(' -> ')}.

- Each PR's base is the **previous branch in the stack**, not \`${BASE_BRANCH}\` (\`gh pr create --base <prev-branch>\`), so its diff shows only its own slice. The first implementation branch's base is ${specPr ? `\`${specPr.branch}\`` : 'the flow-spec branch'}.
- Every PR is capped at **400 changed lines** (added + deleted in product and test code; generated files, lockfiles and vendored assets excluded) and does one clear thing. If a branch's diff exceeds that, do **not** open an oversized PR: report it in \`blocker\` so the work can be re-sliced.
- Title each "${t.taskId} - <slice purpose>". In each body name its place in the stack ("3 of 4, builds on #<prev>"), describe that slice's change, link the PRD requirements it touches, list the acceptance checkboxes it satisfies, state the safety invariant that makes it mergeable on its own and how it was proved, and note that the branch passed an Opus review round before the PR was opened.
- Mirror \`.github/pull_request_template.md\`.
- \`Refs #${t.issue}\` on every PR except the last, which uses \`Closes #${t.issue}\`.
- Leave the **Walkthrough** section of the last PR as the placeholder text \`<!-- walkthrough pending -->\`; a later stage fills it in from the captured screenshots. Mid-stack PRs with no user-visible change write "No UI change" instead.

${attribution}

Return every PR you opened, in stack order, marking which one closes the issue.`

const walkthroughPrompt = (t, topPr) => `Capture and publish the screenshot walkthrough for task ${t.taskId} (issue #${t.issue}), then request a preview deploy. The stack's top PR — the one that closes the issue — is **#${topPr.number}** on branch \`${topPr.branch}\`. ${gh}

${WORKTREE}Check out \`origin/${topPr.branch}\` and \`bun install\`.

1. **Confirm the flows are live.** \`bun run verify:core-flows\` must report no flow still at \`test.fixme\` for ${t.flows.join(', ')}. If any is still parked, stop and report it — there is nothing to capture, and the stack is not finished.
2. **Capture.** \`bun run walkthrough:capture\` for flows under \`e2e/flows\`, and/or \`bun run walkthrough:capture:emulator\` for flows under \`e2e-emulator/flows\`. Capture only runs for specs that actually pass, so a failure here means the feature is not done, not that the tooling is broken. Report the failure rather than working around it.
3. **Publish.** \`bun run walkthrough:publish -- --issue ${t.issue}\`. This pushes the PNGs to the \`claude/walkthroughs\` orphan branch and prints Markdown. Note that images **cannot** be attached to a PR body through the API — that is exactly why this exists. Do not try to attach them, do not commit them to the feature branch, and do not substitute a link to a CI artifact.
4. **Update the PR body.** Replace the \`<!-- walkthrough pending -->\` placeholder in #${topPr.number} with the printed Markdown, verbatim, keeping the rest of the body intact (\`gh pr view ${topPr.number} --json body\`, edit, \`gh pr edit ${topPr.number} --body-file\`). Then re-read the rendered PR and confirm the images actually load.
5. **Request the preview.** \`gh pr edit ${topPr.number} --add-label deploy-preview\`. This deploys the branch to a Firebase Hosting preview channel so the reviewer can walk the flow themselves.

   Two things to check **before** you add the label, because a preview runs against the **live production** Firestore, Auth and Storage with the production deploy credential, and its smoke test leaves a real anonymous project there:
   - CI is green on #${topPr.number}. Do not preview a branch that does not build.
   - The stack does not change \`firestore.rules\` or \`storage.rules\`. A preview always runs against production's *current* rules, so it cannot prove a rules change — and an unreviewed branch must not reach production's access rules. If the stack touches either file, skip the label, say so in \`detail\`, and note it on the PR.

Report what you captured, whether the body was updated and the images render, and whether the label was added.`

// ---------------------------------------------------------------------------

const config = typeof args === 'number' ? { issue: args } : (args && typeof args === 'object' && !Array.isArray(args) ? args : {})
const issueNumber = Number(config.issue ?? config.issueNumber)
if (!Number.isInteger(issueNumber) || issueNumber <= 0)
  throw new Error(`solid-groove-feature needs a GitHub issue number: { issue: 123 }. Got ${JSON.stringify(args)}.`)

phase('Spec')
const t = await agent(discoverPrompt(issueNumber), {
  model: 'sonnet',
  label: `read:#${issueNumber}`,
  phase: 'Spec',
  schema: ISSUE_SCHEMA,
})
if (!t) throw new Error(`Could not read issue #${issueNumber}.`)
t.flows = Array.isArray(t.flows) ? t.flows : []

log(`#${t.issue} ${t.taskId} - ${t.title} — ${t.flows.length ? `flows ${t.flows.join(', ')}` : 'no core flows linked'}${t.changesUi ? ', changes the UI' : ''}`)

// A feature with no linked flow has no acceptance contract to write, review, or
// capture a walkthrough from. That is legitimate for a pure-refactor or
// infrastructure issue and wrong for anything a user can see, so say which
// rather than silently skipping three stages.
if (t.flows.length === 0) {
  log(
    t.changesUi
      ? `#${t.issue} links no core flow but changes the UI. Proceeding without a flow contract or a captured walkthrough — the closing PR will need a walkthrough by hand. Consider adding a flow to docs/core-flows.md and re-running.`
      : `#${t.issue} links no core flow and changes nothing a user sees; skipping the spec and walkthrough stages.`,
  )
}

// Stage 1: write the acceptance contract, review it, land it as PR 1.
let spec = null
let specPr = null
if (t.flows.length > 0) {
  spec = await agent(specPrompt(t), { model: 'opus', label: `spec:${t.taskId}`, phase: 'Spec', isolation: 'worktree', schema: SPEC_SCHEMA })
  if (!spec) throw new Error(`Flow author returned nothing for ${t.taskId}.`)

  let specReview = null
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    specReview = await agent(specReviewPrompt(t, spec, round), {
      model: 'opus',
      effort: 'high',
      label: `spec-review:${t.taskId}#${round}`,
      phase: 'Spec',
      isolation: 'worktree',
      schema: REVIEW_SCHEMA,
    })
    if (!specReview) throw new Error(`Spec reviewer returned nothing for ${t.taskId}.`)
    if (specReview.approved) break

    log(`${t.taskId}: spec review round ${round} returned ${specReview.blocking.length} blocking finding(s)`)
    if (round === MAX_REVIEW_ROUNDS) break

    const fixed = await agent(specFixPrompt(t, spec, specReview), {
      model: 'opus',
      label: `spec-fix:${t.taskId}#${round}`,
      phase: 'Spec',
      isolation: 'worktree',
      schema: SPEC_SCHEMA,
    })
    if (fixed) spec = fixed
  }

  // The contract gates everything downstream, so an unapproved spec stops the
  // run. Building on a spec the reviewer rejected is strictly worse than
  // stopping: the implementation would be measured against it anyway.
  if (!specReview.approved)
    return {
      issue: t.issue,
      status: 'blocked-on-spec',
      stage: 'Spec',
      branch: spec.branch,
      blocking: specReview.blocking,
      note: `Flow specs not approved after ${MAX_REVIEW_ROUNDS} rounds. Branch left open, no PR. Implementation deliberately not started — it would be measured against a contract the reviewer rejected.`,
    }

  const opened = await agent(specPrPrompt(t, spec), { model: 'sonnet', label: `pr:${t.taskId}-flows`, phase: 'Spec', schema: PR_SCHEMA })
  specPr = opened?.pullRequests?.[0] ?? null
  log(`${t.taskId}: flow specs open as ${specPr ? `#${specPr.number}` : 'a PR (number not reported)'} — merge it before the stack lands`)
}

// Stage 2: implement on top of the frozen contract.
phase('Implement')
let impl = await agent(implPrompt(t, spec ?? { branch: BASE_BRANCH }), {
  model: 'opus',
  label: `impl:${t.taskId}`,
  phase: 'Implement',
  isolation: 'worktree',
  schema: IMPL_SCHEMA,
})
if (!impl) throw new Error(`Implementer returned nothing for ${t.taskId}.`)
impl.branches = Array.isArray(impl.branches) && impl.branches.length ? impl.branches : [impl.branch].filter(Boolean)

// Stage 3: adversarial review, up to two rounds with fixes between them.
phase('Review')
let review = null
for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
  review = await agent(reviewPrompt(t, impl, round), {
    model: 'opus',
    effort: 'high',
    label: `review:${t.taskId}#${round}`,
    phase: 'Review',
    isolation: 'worktree',
    schema: REVIEW_SCHEMA,
  })
  if (!review) throw new Error(`Reviewer returned nothing for ${t.taskId}.`)
  if (review.approved) break

  log(`${t.taskId}: review round ${round} returned ${review.blocking.length} blocking finding(s)`)
  if (round === MAX_REVIEW_ROUNDS) break

  const fixed = await agent(fixPrompt(t, impl, review), {
    model: 'opus',
    label: `fix:${t.taskId}#${round}`,
    phase: 'Review',
    isolation: 'worktree',
    schema: IMPL_SCHEMA,
  })
  if (fixed) {
    fixed.branches = Array.isArray(fixed.branches) && fixed.branches.length ? fixed.branches : impl.branches
    impl = fixed
  }
}

if (!review.approved)
  return {
    issue: t.issue,
    status: 'blocked-on-review',
    stage: 'Review',
    flowSpecPr: specPr,
    branches: impl.branches,
    blocking: review.blocking,
    unmet: impl.unmet,
    note: `Not approved after ${MAX_REVIEW_ROUNDS} rounds. Implementation branches left open, no PRs opened.`,
  }

// Stage 4: open the rest of the stack.
phase('Land')
const landed = await agent(prPrompt(t, impl, specPr), { model: 'sonnet', label: `pr:${t.taskId}`, phase: 'Land', schema: PR_SCHEMA })
const pullRequests = landed?.pullRequests ?? []
const topPr = pullRequests.find((pr) => pr.closesIssue) ?? pullRequests[pullRequests.length - 1] ?? null

if (landed?.blocker) log(`${t.taskId}: ${landed.blocker}`)

// Stage 5: the walkthrough, and the preview the reviewer actually walks.
phase('Walkthrough')
let walkthrough = null
if (!topPr) {
  log(`${t.taskId}: no closing PR was opened, so there is nothing to attach a walkthrough to.`)
} else if (t.flows.length === 0) {
  log(`${t.taskId}: no core flows, so no walkthrough was captured.${t.changesUi ? ' This task changes the UI — #' + topPr.number + ' needs one added by hand before review.' : ''}`)
} else {
  walkthrough = await agent(walkthroughPrompt(t, topPr), {
    model: 'sonnet',
    label: `walkthrough:${t.taskId}`,
    phase: 'Walkthrough',
    isolation: 'worktree',
    schema: WALKTHROUGH_SCHEMA,
  })
  if (!walkthrough?.published)
    log(`${t.taskId}: walkthrough NOT published (${walkthrough?.detail ?? 'agent returned nothing'}) — #${topPr.number} will be rejected without one.`)
  if (walkthrough && !walkthrough.labelled)
    log(`${t.taskId}: deploy-preview not added to #${topPr.number} (${walkthrough.detail ?? 'no reason reported'}).`)
}

return {
  issue: t.issue,
  taskId: t.taskId,
  status: 'open-for-review',
  flows: t.flows,
  flowSpecPr: specPr,
  pullRequests,
  closingPr: topPr,
  walkthrough,
  reviewNotes: review.notes ?? [],
  unmet: impl.unmet ?? [],
  outOfScope: impl.outOfScope ?? [],
}
