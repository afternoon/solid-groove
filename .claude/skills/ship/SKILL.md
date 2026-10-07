---
name: ship
description: Ship one Groove GitHub issue unattended, whether it is a feature, a fix or polish. Triages the kind of work, builds it, reviews features, and opens ready-for-review PRs with screenshots and a preview deploy. Use when asked to ship, build, implement or fix an issue, e.g. "/ship #123", "ship 123", "fix #123", "implement #123".
---

# Ship an issue

The issue's spec was agreed in an interactive shape session, so this runs
without asking questions. See `CLAUDE.md`, "Shape, then ship".

1. **Resolve the issue number** from the argument (`#123`, `123`, or an issue
   URL). If none was given, ask for one.
2. **Run the workflow**: call the Workflow tool with
   `{ name: "solid-groove-ship", args: { issue: <n> } }`. Do not build anything
   yourself; the workflow does triage, build, review (features only) and landing.
   Landing opens the PRs one at a time, each against `main` once the one before
   it has merged, so a run with several PRs takes as long as those merges.
   If the session cannot run workflows, or is headless (GitHub Actions, `-p`),
   run the same stages yourself with the Agent tool in the foreground
   (`run_in_background: false`), following `.claude/workflows/solid-groove-ship.js`
   and the agent briefs in `.claude/agents/`. A headless run ends when your turn
   ends, so a background workflow there is killed before it does anything.
   Never end your turn while the work is still running.
3. **When it returns**, confirm every PR it names exists (`gh pr view <n>` or the
   GitHub MCP tools) before reporting it. Report only what you have seen, never
   an expected or summarised result. Then tell the user in a few lines:
   - the PRs it opened (full URLs), and the kind of work it treated the issue as;
   - any assumptions or open review findings that ended up in a PR body;
   - or, if it stopped, why (an unclear issue posts its question on the issue;
     answer there or in this session and re-run `/ship`; a run that stopped at
     a gated PR continues from what has landed when `/ship` runs again after
     that PR merges).
4. **Watch the PRs** if `subscribe_pr_activity` is available: subscribe to each
   one and drive it to green (CI fixes, QA findings, merge conflicts) as the
   events arrive.

Edit the workflow or the agent briefs freely when they get something wrong; they
are this repo's process, not fixed rules.
