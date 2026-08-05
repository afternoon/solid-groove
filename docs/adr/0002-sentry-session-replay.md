# ADR 0002 - Sentry Session Replay for understanding product usage

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-08-05 |
| Decides | Whether PRD `OPS-03` permits Sentry Session Replay |
| Supersedes | [ADR 0001](./0001-sentry-for-error-monitoring.md) decision 4 ("Session Replay is not enabled") |
| Affects | `OPS-03`, `DEC-009`, `HARD-003`, `OPS-001`, `FND-001c`'s consent mechanism and disclosure copy |

## Context

[ADR 0001](./0001-sentry-for-error-monitoring.md) adopted Sentry as the error and crash monitoring platform, and its decision 4 forbade Session Replay "in the alpha or later, without a new ADR" on the grounds that it "would capture the arrangement, clip names, and assistant conversation on screen." PRD `OPS-03` and section 15's risk table carry the same prohibition. This ADR is that new ADR.

What changed is not the privacy analysis but the question being asked. ADR 0001 evaluated replay solely as a *debugging* aid attached to error monitoring, where its marginal value over a scrubbed stack trace is modest and its collection surface is large. The need now is different and is not served by any instrument the alpha has: **understanding how people actually use the app.**

The PRD `OPS-02` catalog answers *what* happened — `project_created`, `track_added`, `clip_edited`, `arrangement_milestone`. It cannot answer *why* someone stopped. A counter shows that a user opened a project, added a track, and never reached a first loop; it cannot show that they spent ninety seconds hunting for the instrument picker, or that they dragged the wrong edge of a clip four times. For a DAW aimed at making music creation accessible to people who have bounced off existing tools, that gap is the central product question of the alpha, and section 11's activation measures quantify the drop-off without explaining it. Session Replay observes the interaction directly.

The prohibition in ADR 0001 was correct about the risk and wrong to treat it as unconditional. Sentry's replay privacy controls mask content at the point of capture in the browser — masked text is never serialized into the replay payload and therefore never transmitted — rather than filtering it server-side after collection. That makes it possible to capture *interaction* (pointer movement, clicks, scrolling, navigation, timing, layout) while never capturing *content* (clip names, note data, assistant messages, typed text). Whether that separation holds is the thing this decision turns on, and it is enforced by configuration and test rather than assumed.

## Decision

Enable **Sentry Session Replay**, for the purpose of understanding how the product is used, under the conditions below. All of them are load-bearing; replay ships only when every one holds.

1. **The purpose is product understanding, not access to user work.** Replay exists to show how people navigate and where they get stuck. It is not a route to a user's music, and no workflow — support, debugging, curiosity — may use it to inspect the content of a project. Decision 2 makes that a property of the data rather than a matter of discipline.

2. **Mask by default, unmask by exception.** `maskAllText: true` and `blockAllMedia: true`, with masking applied at capture. Nothing is unmasked without being named: only stable, non-user-authored chrome — fixed navigation labels, static button text, panel headings — may be unmasked, each by an explicit selector. Anything rendering user-authored or project-derived content is additionally marked with Sentry's block/mask class or attribute at the component level, so a new surface is masked by the default and by its own markup. Canvas capture stays off, which keeps the arrangement renderer, the piano roll, and waveform displays out of the payload entirely.

3. **The `OPS-03` content rule extends to the replay payload.** "No project content, assistant text, user-entered strings, asset URLs, or tokens" already governs events and breadcrumbs. It now governs replays, and is enforced the same way — positively, by test, against the serialized payload rather than by inspection of the configuration. The existing `src/monitoring/sentrySink.test.ts` assertion that replay is *absent* is replaced by assertions that it is present *and* configured with masking on, media blocked, and canvas off.

4. **Replay is covered by the analytics opt-out, and the opt-out is honoured at the source.** A user who declines telemetry is not recorded. This is not a filter on delivery: opting out stops the replay integration from capturing, and opting out mid-session stops an in-flight recording rather than merely dropping it before send. `src/analytics/consent.ts` gains a third flag alongside `productAnalytics` and `errorMonitoring` so the preference is expressible on its own, while the single user-facing control keeps turning everything off in one action. Turning replay off costs no capability, exactly as `OPS-02` requires of analytics.

5. **The user is told, before it happens.** The disclosure names Session Replay specifically, says in plain terms that it records how the app is used, states that it is used to understand usage and not to access music or other private information, and states that project content is masked out. The current copy's promise — "Your music never leaves your project" — must remain literally true with replay on; decision 2 is what makes it so. Wording and default state remain `DEC-009`'s to settle, now with replay in scope.

6. **Sampling is low for sessions and off for errors.** `replaysSessionSampleRate` is set low (start at 0.1 and adjust against the free-tier quota); `replaysOnErrorSampleRate` stays at 0. Error-triggered replay is the use case ADR 0001 rejected on cost/benefit, and nothing here revisits that — this decision buys usage understanding, not a debugging aid.

7. **The boundary rule from ADR 0001 decision 1 is unchanged.** `src/monitoring/sentrySink.ts` remains the only module importing `@sentry/*`. Replay is configured there; application code does not call the SDK, and components interact with it only through the mask/block markup of decision 2.

8. **Bundle cost is not paid on first paint.** The replay integration loads lazily with the rest of the SDK, after first paint, and not at all on the marketing landing page — the ADR 0001 rule for the section 10 three-second-interactive budget, which replay makes more pressing rather than less.

## Consequences

### What this buys

- The alpha's central product question — where people get stuck — becomes observable, rather than inferred from counters that show drop-off without cause.
- Section 11's activation measures gain an explanation layer: `arrangement_milestone` says how many reached it, replay shows what the ones who didn't were doing instead.
- No new vendor and no new privacy surface in the abstract: Sentry is already in the stack under ADR 0001, already disclosed, already covered by the opt-out. What grows is what Sentry receives, which is precisely what decisions 2-5 constrain.

### What this costs, and what we do about it

- **This is a real expansion of collection, and the masking is the whole safeguard.** A single unmasked surface rendering a clip name puts project content in a third-party system. Mitigated by mask-by-default plus component-level marking (decision 2), so a new panel is masked twice over and an unmask is a deliberate, reviewable line of code; and by payload-level tests (decision 3) that cover surfaces added later rather than only today's.
- **Masked replay is less useful than unmasked replay.** Watching someone struggle with a control whose label is masked is harder to interpret. Accepted deliberately: decision 2's allowance for unmasking *static* chrome recovers most of the legibility, since what matters is which control was used, not what the user named their track. If a specific surface proves unreadable, the fix is to unmask that named static element, never to relax the default.
- **Replay quota is consumed quickly.** Sentry's free tier includes far fewer replays than errors. Decision 6's low session rate is the control; the rate is adjusted against observed quota during `OPS-001` rather than guessed at now.
- **Bundle size.** The replay integration is among the SDK's larger pieces. Decision 8 keeps it off the landing page and off the first-paint path; the section 10 budget is re-measured with replay enabled, and a budget regression is a reason to reduce sampling or drop replay, not to accept a slower first load.
- **Ad and tracker blockers block replay along with the rest of `sentry.io`.** The `OPS-02` fail-open rule applies unchanged. Replay is a sampled qualitative instrument, not a measure a release gate depends on, so the undercount costs nothing structural.
- **Regional and retention questions now include replay.** `DEC-009` must cover replay retention and region alongside events and errors; replay data is more sensitive per record than a counter event, so a shorter retention than errors is likely the right answer.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Keep ADR 0001 decision 4 and rely on the `OPS-02` catalog | Counters show where users drop off but never why; the alpha's central product question stays unanswered |
| Add more granular analytics events instead | An event catalog fine-grained enough to reconstruct a struggle is both a large instrumentation effort and a worse privacy position than masked replay, since it means logging interaction detail permanently rather than sampling it |
| Moderated user testing only (`HARD-005`) | Necessary and already planned, but small-n, scheduled, and observed — it does not show unmonitored behaviour, and it comes too late to shape the alpha |
| A second vendor specialising in product replay (FullStory, LogRocket, Hotjar) | A third processor and a third privacy surface for a capability the existing vendor provides; ADR 0001's reasoning against stack expansion applies unchanged |
| Replay on errors only (`replaysOnErrorSampleRate > 0`) | That is the debugging use ADR 0001 weighed and rejected; it does not serve the usage-understanding purpose, which needs ordinary sessions, not crashing ones |
| Unmasked replay for richer insight | Directly contradicts `OPS-03`'s content rule and the product's core promise about the user's music; not on the table at any sampling rate |

## Revisit when

- `DEC-009` settles consent, retention, and region, which may constrain sampling or retention further than decision 6 assumes.
- The section 10 interactive budget is measured with replay enabled and the bundle cost is known.
- Replay quota is observed against real cohort usage during `OPS-001`.
- Public launch, when a much larger cohort changes both the quota arithmetic and the privacy calculus.
