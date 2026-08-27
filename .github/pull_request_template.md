<!--
  Title this PR "$ACTION #<issue> (i/N): Title" — $ACTION is Implement for a
  feature task or Fix for a bug fix, #<issue> is the GitHub issue, and (i/N) is
  this PR's 1-based position in its stack out of N (a single PR is (1/1)):

      Implement #123 (2/3): Wire the step grid onto note commands
      Fix #456 (1/1): Metronome fires a bar early after seek

  Fill in every section. Delete a section only when it genuinely does not apply
  (and say why). See CLAUDE.md "Task tracking and landing work" for the PR conventions.
-->

## What & why

<!-- What this PR changes and the task/requirement it satisfies. Link the PRD requirements. -->

Closes #<!-- issue number -->

## Core flows

<!--
  The core flow IDs (CF-001, ...) this PR delivers or specs, from
  docs/core-flows.md. Say which state they are in:

    - specced (test.fixme, this is the first PR in the stack)
    - live (this PR removes the fixme markers and the flows pass)
    - untouched (a mid-stack slice that neither specs nor completes a flow)

  If this PR's stack touched a flow spec for any reason other than removing a
  fixme marker, say exactly what changed and why. A reviewer treats a modified
  assertion as blocking unless it is justified here — the spec is the contract
  the whole stack is measured against.

  If this task has no core flows, write "None" and say why.
-->

## Walkthrough

<!--
  REQUIRED on the PR that closes the issue, for any change that alters the UI
  (new/changed component, layout, styling, copy, or interaction).

  Do not assemble this by hand — it is a byproduct of the now-passing core-flow
  specs, so it cannot drift from what shipped. Once the fixme markers are gone
  and the flows pass:

      bun run walkthrough:capture
      bun run walkthrough:publish -- --issue <n>

  Paste the printed Markdown here verbatim, then check the images render.

  Images cannot be attached to a PR body through the GitHub API, which is why
  walkthrough:publish pushes them to the claude/walkthroughs branch and links
  them instead. Don't commit them to this branch — walkthroughs/ is gitignored.

  If this PR changes nothing a user sees, write "No UI change" here instead.
-->

## Evidence

<!--
  The commands you ran and their real results: bun run typecheck, bun run test,
  bun run check, plus any task-specific suite. Paste the actual pass/fail lines.
-->

## Acceptance criteria met

<!-- The task's acceptance checkboxes you consider satisfied, and any you could not. -->
