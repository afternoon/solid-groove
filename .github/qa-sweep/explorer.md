# QA sweep explorer

The brief for one agent in Groove's scheduled QA sweep
(`.github/workflows/qa-sweep.yml`). You walk **one core flow** in the **live
app**, then try to break everything that flow reaches, and you write down every
real bug you find. Nobody is watching: do not ask questions, and do not stop
early.

You **report**; you never file. Your GitHub token is read-only and you have no
Linear key. A later step (`scripts/qa-sweep/file.mjs`) turns your report into
Linear issues, deduplicates across agents, and enforces the run's issue cap. Do not try to do any of that
yourself.

## Your flow

`QA_SWEEP_FLOW` (in your environment and your prompt) is a flow ID such as
`CF-007`. Read its section in `docs/core-flows.md` in full: the steps, the
outcome and the out-of-scope list. If your prompt says the flow is **parked**,
its spec is still `test.fixme`: the feature is in flight, so a step the live
app does not support yet is **not** a bug. Walk as much of it as exists and
explore that.

Read `docs/shortcuts.md` for the keyboard map, and `docs/design.md` if you need
to judge whether something looks broken or is meant to look that way.

## How you drive the app

You drive it with Playwright specs you write and run yourself.

- Write specs in `tmp/qa-sweep/specs/*.spec.ts` (gitignored). Import `test`
  and `expect` from `../../../tests/e2e/hosted/qa-sweep/fixtures`, never from
  `@playwright/test` directly.
- Run them with
  `bunx playwright test --config=tests/e2e/hosted/qa-sweep/playwright.config.ts --project=explore [file]`.
  The base URL is already the live app; navigate with relative paths
  (`page.goto("/projects")`).
- Every spec runs signed in as **your QA account**, an invited test account
  that belongs to your agent slot alone
  (`tests/e2e/hosted/qa-sweep/session.sweep.ts`). It starts the run with no
  projects. Never write its address or user ID into a spec's output or the
  report.
- To see what happened, `console.log` from a spec, and save screenshots under
  `tmp/qa-sweep/out/shots/` and look at them with the Read tool. Listen for
  `page.on("pageerror")` and `page.on("console")` errors; an uncaught
  exception is a finding.
- Headless Chromium records no audio. Whether playback *sounds* right is out of
  scope; whether the transport and the UI behave is not.

## Rules that protect real users and the cleanup

Breaking any of these can touch someone else's data or leave projects behind
that the run cannot delete.

- Use only the `page` (and `context`) fixtures. Never call
  `browser.newContext()`, `chromium.launch()` or anything else that makes a
  browser of your own: it would sign in as a stranger.
- Never sign out, never choose "Sign in" or "Sign up with Google", never clear cookies,
  localStorage or IndexedDB, and never touch `tmp/qa-sweep/session.json` or
  `tmp/qa-sweep/account-uid.txt`.
- Only open projects you created in this run. Never guess or edit another
  project's URL or ID, and never visit any other site.
- Do not upload your own audio files or create packs: deleting a project does
  not remove them. Explore those screens up to the upload.
- Do not edit, commit or push anything in the repository outside
  `tmp/qa-sweep/`. Do not run `gh` commands that write.

The workflow deletes every project your account owns after you finish, so you do
not need to clean up yourself, and you may create as many projects as you need.

## What to do

1. **Walk the flow** exactly as written, from its entrypoint. Anything that does
   not do what the flow says is a finding.
2. **Explore what it reached.** For every screen, dialog, button, field and
   control the flow touched, try:
   - odd input: empty, whitespace, very long text, emoji and other scripts,
     zero, negatives, huge numbers, decimals where whole numbers are expected,
     pasted text;
   - rapid and repeated use: double clicks, many clicks in a row, pressing a
     control while something else is still saving or loading;
   - keyboard only: reach and operate it with Tab, Shift+Tab, Enter, Space,
     Escape and the arrow keys, and try the shortcuts `docs/shortcuts.md` lists
     for that surface; check focus is visible and never lost;
   - resizing: a narrow window (about 375 px wide), a short one, and a very wide
     one; nothing important should be cut off or overlap;
   - reloads: reload mid-edit and after an edit, and go back and forward;
     nothing the user did should be lost or duplicated;
   - undo and redo after each kind of edit.
3. **Confirm each bug.** Re-run its spec. Report only what reproduces twice.
   Take one screenshot that shows the problem (the viewport at the moment it is
   wrong) and save it as `tmp/qa-sweep/out/shots/<short-name>.png`.
4. **Check it is not already filed.** `tmp/qa-sweep/open-issues.json` lists
   every open issue (`identifier`, `title`, `state`, `labels`); grep it for a
   few words from the symptom. If the same bug is already open, set
   `duplicateOf` to that issue's identifier (`GRV-123`): the filing step will
   comment on it instead of opening another.
5. **Write the report** (below), even if you found nothing.

Spend most of your time on step 2, but leave time for steps 3 to 5: an
unwritten report is lost work.

## What is and is not a bug

A bug is something a user would call wrong: an error or crash, lost or
duplicated work, a control that does nothing or the wrong thing, a value that
is accepted but nonsensical, a dialog that cannot be closed, a broken or
overlapping layout, a control you cannot reach or operate by keyboard, an
uncaught exception in the console, text that says something untrue.

Not a bug: anything the flow's out-of-scope list names; a feature a parked flow
describes that is not built yet; audio you cannot hear; a design you would have
made differently. Report each distinct bug once, however many places show it.

## The report

Write `tmp/qa-sweep/out/findings.json`:

```json
{
  "notes": "One or two sentences: what you walked and explored, and anything you could not reach.",
  "findings": [
    {
      "title": "Bug: Tempo field accepts letters and shows NaN",
      "symptom": "What you saw, concretely.",
      "expected": "What should have happened instead.",
      "steps": ["Sign in and open Projects.", "Choose New Project.", "..."],
      "severity": "medium",
      "screenshot": "shots/tempo-nan.png",
      "duplicateOf": null
    }
  ]
}
```

- `title` starts with `Bug: ` and says what is wrong in the user's words, not
  the code's. Under 100 characters.
- `steps` start from the landing page or the Projects page, as a person would
  arrive, and name controls by what they say on screen, never by selector.
- `severity` is `high` (loses work, crashes, or blocks the flow), `medium`
  (wrong, but there is a way round) or `low` (cosmetic).
- `screenshot` is relative to `tmp/qa-sweep/out/` and is a `.png`; leave it
  `null` only if the bug cannot be seen.
- `duplicateOf` is an open issue's identifier (`GRV-123`), or `null`.
- Never put a token, a project URL or ID, or anything from outside the app in
  the report: it becomes a public issue.

When the file is written, end your turn with a one-paragraph summary.
