# ADR 0001 - Sentry for error and crash monitoring

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-07-25 |
| Decides | PRD section 9.1 stack row "Error monitoring"; PRD `OPS-03` |
| Supersedes | The Cloud Functions sink into Cloud Logging described in the first draft of `OPS-03` |
| Affects | `FND-001b`, `FND-001c`, `HARD-003`, `DEC-009` |

## Context

PRD section 9.1 commits the alpha to Firebase for authentication, persistence, storage, privileged backend, hosting, and product analytics, and requires an approved ADR before an implementation adds an alternative. `OPS-03` originally satisfied crash monitoring inside that commitment: global browser error handlers and error boundaries would record an `exception` analytics event and post a structured report to a Cloud Functions endpoint writing to Cloud Logging, where Google Cloud Error Reporting would group it.

Firebase Crashlytics was never an option — it does not support the Firebase Web SDK.

Two facts about the Cloud Logging route changed the decision.

**Source maps.** Google Cloud Error Reporting resolves browser stack traces only against *publicly available* source maps, discovered through a `//# sourceMappingURL=` comment pointing at a reachable URL. Private source maps are not supported, and the limitation is long-standing. `OPS-03` requires source maps to be retained for the deployed revision and **not** served publicly from Hosting. The route therefore forces a choice between unreadable minified production stack traces and publishing our source maps. Neither is acceptable: the first makes the monitoring worthless, the second is a deliberate change to what we expose.

**Client maturity.** The browser client for Cloud Error Reporting, `stackdriver-errors-js`, is described by Google as experimental and is effectively unmaintained. Error Reporting is a server-side product; its browser path is not a supported first-class surface.

Separately, PRD section 11 makes **crash-free session rate** a release gate. Computing it from Cloud Logging means building browser sessionization, fatal/non-fatal classification, and the rolling ratio ourselves — building the instrument that measures our own release gate, during Phase 0.

## Decision

Adopt **Sentry** as the error and crash monitoring platform for the private alpha, via the official SolidStart SDK (`@sentry/solidstart`, a wrapper over `@sentry/solid` for the client and `@sentry/node` for the server). Remove the Cloud Functions sink into Cloud Logging from `OPS-03`.

Specifically:

1. **The reporting boundary stays ours.** The global `error`/`unhandledrejection` handlers and Solid error boundaries specified by `OPS-03` remain the single place errors are captured. Sentry is the transport and backend behind that boundary, not a replacement for it. Application code does not call the Sentry SDK directly.
2. **Sentry is the diagnostic system of record**: grouping, deduplication, release tracking, source-map symbolication, alerting, triage, and crash-free session rate via the `BrowserSession` integration and Release Health.
3. **Google Analytics keeps the `exception` counter event** (`fatal`, `area`, `error_code`) from `OPS-02`. The section 11 measures continue to compute in one place from one catalog; Sentry is where an engineer goes to debug a specific error, not where the product dashboard is assembled.
4. **Session Replay is not enabled**, in the alpha or later, without a new ADR. It would capture the arrangement, clip names, and assistant conversation on screen.
5. **Sentry may also instrument the Cloud Functions gateway** (`AI-001`) through `@sentry/node`, giving one system across client and server. Sentry's tracing does **not** displace Firebase Performance Monitoring or the section 9.3 lab measurement of arrangement frame budgets; that is a separate decision and is not made here.
6. **Self-hosting is out of scope** for the alpha. Sentry's SaaS free tier covers the cohort; running the self-hosted stack is more operational surface than a private alpha justifies.

## Consequences

### What this buys

- Readable production stack traces without publishing source maps, through authenticated per-release source-map upload.
- Crash-free session rate as a native metric rather than a Phase 0 engineering project, satisfying the section 11 release gate directly.
- Grouping, deduplication, and fatal/non-fatal classification satisfy `OPS-03` acceptance criteria out of the box rather than through code we own and test.
- An official SolidStart SDK, so the framework integration is maintained upstream rather than by us.
- Cost is negligible at alpha scale. The free Developer tier covers a single user, 5,000 errors per month, and 30-day retention; the paid Team tier is roughly $26/month when seats or volume exceed it. Both are far below the engineering time the alternative costs. Exact limits are confirmed at signup rather than taken from secondary sources.

### What this costs, and what we do about it

- **A second vendor and a second privacy surface** in a deliberately small stack. This is the real price of the decision. `DEC-009` must cover Sentry alongside Google Analytics: what is collected, retention, regional storage, and the user-facing disclosure.
- **Sentry's defaults send more than our own sink would.** Console breadcrumbs capture console arguments and network breadcrumbs capture request URLs. For a product whose value is the user's private music, this is the thing to get right, and it is *added* work rather than saved work:
  - `sendDefaultPii` stays `false`.
  - `beforeSend` and `beforeBreadcrumb` scrub before transmission; console breadcrumbs are disabled rather than filtered.
  - The `OPS-02` "no project content" test extends to cover the Sentry payload, exercising the scrubbing functions directly, so it also covers events and breadcrumbs added later.
  - Session Replay stays off (decision 4 above).
- **Bundle size** works against the section 10 three-second-interactive budget. The SDK is initialized lazily after first paint with a minimal integration set, and is not loaded on the marketing landing page (`LOOP-001b`).
- **Ad and tracker blockers block `sentry.io`.** The `OPS-02` fail-open rule applies unchanged: a blocked or failing reporter never affects playback, editing, saving, or export. We do not tunnel reports through our own domain in the alpha — it would reintroduce the Cloud Function this ADR removes. The resulting undercount is documented; note that a blocked SDK loses the session *and* its errors, so the crash-free **ratio** is less biased than the absolute counts.
- **`@sentry/solidstart` is beta.** Its API is stable but behavior may shift in minor releases. The version is pinned, and the framework wrapper is a convenience over the core browser SDK — if it misbehaves we drop to `@sentry/browser` behind the same unchanged boundary.
- **Exit cost is bounded** precisely because of decision 1. Replacing Sentry means replacing a transport behind an interface we own, not re-instrumenting the application.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Cloud Functions sink into Cloud Logging / Error Reporting (the original `OPS-03`) | Cannot symbolicate without public source maps; unmaintained experimental browser client; crash-free session rate would be built by us |
| Firebase Crashlytics | Does not support the Firebase Web SDK |
| Publish source maps publicly and keep Cloud Error Reporting | Trades a deliberate exposure decision for tooling convenience; also leaves the unmaintained client and the sessionization work |
| Self-hosted Sentry | Same privacy configuration work plus an operational burden a private alpha does not justify; revisitable if data residency later demands it |
| Another SaaS error tracker (Rollbar, Bugsnag, Highlight, Datadog RUM) | No decisive advantage over Sentry for this stack, and none has an official SolidStart SDK; Datadog RUM in particular is priced and scoped well beyond an alpha's needs |
| No error monitoring during the alpha | Section 11 makes crash-free sessions a release gate; an unobservable gate is not a gate |

## Revisit when

- The alpha cohort grows beyond the free tier, or seats are needed for more than one engineer.
- `DEC-009` settles a regional or retention constraint that SaaS Sentry cannot meet, which would reopen self-hosting.
- Public launch, when the single-environment decision in `OPS-01` is also revisited.
