# Core flows

A **core flow** is one user journey that must work end to end when a feature is
finished, written in plain English before any code exists. It is the durable QA
record: the thing a reviewer walks through on a preview channel, and the thing an
automated test reproduces on every push.

This file is the register of those flows. Each one has a stable ID (`CF-001`,
`CF-002`, …) that an issue links to, an E2E spec is named after, and a screenshot
walkthrough is captured from. Those three artefacts are traceably one thing
because they all carry the same ID.

## What a core flow is, and is not

A core flow **is** a journey a person takes through the product, from an
entrypoint they could actually arrive at, to an outcome they can see. It is
written so that someone who has never read the code can follow it by hand.

A core flow is **not**:

- a requirement (that is the PRD's job),
- an acceptance criterion (that is the issue's job),
- a unit of implementation (that is the PR's job), or
- an exhaustive test plan. A flow covers the path that must not break, not every
  branch off it. Edge cases, failure states, and empty states are still tested at
  the lowest useful layer, as they always were.

Most features need one or two flows. A feature that seems to need six probably
contains a dependency that should be its own issue.

## Precedence

`docs/prd.md` remains authoritative for product behavior. A core flow is a
concrete journey *through* behavior the PRD already specifies; it never
introduces, weakens, or reinterprets a requirement. **Where a flow and the PRD
disagree, the PRD wins and the flow is wrong** — fix the flow.

If writing a flow reveals that the PRD does not actually say what the product
should do, that is a PRD change, made deliberately and separately, before the
flow is finalised.

## Who edits this file

**The product owner, and no one else.** Implementing and reviewing agents must
treat this file as read-only:

- An implementer that finds a flow ambiguous, impossible, or contradicted by the
  PRD **stops and says so** on the issue. It does not edit the flow to match what
  it built.
- A reviewer treats any diff to `docs/core-flows.md` in an implementation PR as a
  **blocking finding**. Retro-fitting the specification to the implementation is
  the exact failure this rule exists to prevent.

The same applies to `docs/prd.md`, for the same reason and by the same rule.

## Lifecycle of a flow

1. **Written.** The product owner adds the flow here with a fresh ID, and links
   it from the feature's GitHub issue by ID. If the flow depends on work that does
   not exist yet, that dependency is broken out as its own issue first.
2. **Specified.** The first PR in the feature's stack adds `e2e/flows/<ID>.spec.ts`
   (or `e2e-emulator/flows/<ID>.spec.ts`), written from this file, marked
   `test.fixme` because the implementation does not exist. It is reviewed on its
   own — it is the acceptance contract for everything that follows — and it merges
   green, because a `fixme` test does not fail.
3. **Frozen.** From that point the spec is the contract. A later PR in the stack
   may not change its assertions without saying so in the PR body and having the
   reviewer confirm it; see `CLAUDE.md`, "Landing work".
4. **Live.** The PR that closes the issue removes the `test.fixme` in the same
   diff that makes it pass, and captures the screenshot walkthrough from that
   now-passing run.

`bun run verify:core-flows` enforces the 1:1 mapping between the IDs in this file
and the spec files, and reports any flow still parked at step 2 so a stack cannot
quietly land with its flow permanently skipped.

## Which suite a flow belongs in

- **`e2e/flows/`** — the in-memory mock backend. The default. Fast, no external
  dependency. It **cannot** prove anything survives a reload: the mock repository
  is a fresh, empty store on every page load.
- **`e2e-emulator/flows/`** — a real (emulated) Firestore and Auth. Use this for
  any flow whose outcome involves saving, reloading, revisions, sign-in, or
  security rules.

A flow that says "and it is still there tomorrow" belongs in the second one. See
[`docs/testing.md`](./testing.md) for what each suite covers and how CI gates on
them.

## Anatomy of a flow

Copy this shape. Keep the steps in the second person and free of selectors, CSS
classes, and function names — if a step cannot be followed by a person with a
browser, it is written at the wrong altitude.

```markdown
### CF-0NN — Short title in the user's language

**Issue:** #NN · **Suite:** `e2e/flows/CF-0NN.spec.ts` · **Entrypoint:** the public landing page

**Preconditions:** what must already be true. "None" is a good answer.

1. A step you can perform.
2. Another step.
3. The step that produces the outcome.

**Outcome:** what you can now see, hear, or do that you could not before.

**Out of scope:** the neighbouring things this flow deliberately does not prove,
so nobody reads its passing as coverage of them.
```

The **entrypoint** matters: a flow starts where a person would actually arrive —
the public landing page, the project dashboard, or a project page — not at a deep
link with seeded state. That is what makes the captured walkthrough worth looking
at, and it is why a walkthrough is a byproduct of the flow test rather than a
separate errand.

---

## Flows

### CF-001 — A visitor with no account reaches a playing loop

**Issue:** — (pre-dates this register; describes shipped `FND-009`/`LOOP-010`
behavior) · **Suite:** `e2e/flows/CF-001.spec.ts` · **Entrypoint:** the public
landing page

**Preconditions:** none. No account, no existing project.

1. Open the landing page.
2. Choose to start in your browser.
3. You arrive at the dashboard, signed in as a guest, with no projects yet.
4. Create a new project.
5. The project opens on a step editor already carrying a four-on-the-floor
   starter pattern.
6. Turn on a step that was off.
7. Start playback.

**Outcome:** a visitor who arrived with no account is listening to a loop they
just edited, and the transport shows it is running.

**Out of scope:** that the loop is *audible*. A headless browser records no audio
and Playwright captures none, so this flow proves the transport starts, not that
a sound reached a speaker. Playback is asserted in Chromium only — see
[`docs/testing.md`](./testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap)
and issue #43. It also does not prove persistence: this flow runs against the
mock backend, which is empty again on the next page load.

<!--
  New flows go here, in ascending ID order. Never renumber or reuse an ID: a
  retired flow keeps its number and gains a "**Retired:** why" line, because
  closed issues, merged PRs, and old walkthroughs still reference it.
-->
