# ADR 0006 - Anthropic behind a model-agnostic gateway, and what the alpha assistant may cost

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-08-27 |
| Decides | Which AI provider and model the private alpha's assistant calls, and the per-user and organization-wide limits that bound what it can spend |
| Affects | `DEC-005` ([#34](https://github.com/afternoon/solid-groove/issues/34)), `AI-001` ([#69](https://github.com/afternoon/solid-groove/issues/69)), `REL-002` ([#74](https://github.com/afternoon/solid-groove/issues/74)) |

## Context

`DEC-005` had settled two things by comment and left four open: provider and model, per-user budget, usage limits, and the project context the assistant may send off-platform. This ADR takes the first three. [ADR 0007](./0007-assistant-off-platform-context-and-disclosure.md) takes the fourth together with the disclosure copy, because that question is about data rather than about vendors.

`AI-001` — the provider-independent server gateway — was blocked on all of it, which is why the assistant milestone had not started.

Two facts frame the choice. First, the thing the assistant is judged on is not prose quality but **structured tool-use accuracy**: the assistant changes a project only by returning validated commands from an allowlisted schema, and a proposal that fails validation costs a retry, a regeneration, and a tester's patience. Second, the alpha cohort is 8-20 hand-recruited testers, so the money at stake is small enough that it is not the deciding variable — roughly $35-70 for a four-week alpha at current rates. What actually needs bounding is not the expected bill but the unexpected one: a retry loop, or an account that is not a tester.

## Decision

### 1. Anthropic is the provider for the alpha

Credentials and provider objects stay server-side behind the `AI-001` gateway and never reach the client or enter domain state. Adding a second provider, or replacing this one, requires a superseding ADR.

### 2. The model is configuration, not a literal

The alpha starts on `claude-sonnet-5`. `claude-haiku-4-5` is also under evaluation during dogfooding. **The product owner switches models on their own judgement from that evaluation, and a switch does not reopen this ADR and does not reopen `REL-002`'s AI producer gate.**

This is the point of the decision, not a footnote to it. A model choice made before anyone has used the assistant is a guess; the cheaper tiers may well be sufficient for structured command generation, and the way to find out is to use it. Welding a model into the gateway would mean a quality failure discovered at the `REL-002` gate could only be answered by reopening a product decision, which is the expensive way to learn something a config change can fix.

### 3. The gateway abstracts the request shape per model, not just the model string

The models under evaluation do not take the same request:

- `claude-sonnet-5` uses adaptive thinking and `output_config.effort`.
- `claude-haiku-4-5` **rejects** `effort` and uses the older `thinking: {type: "enabled", budget_tokens: N}` form.
- Context windows differ by a factor of five (1M against 200K), so the conversation history resent on each turn is **bounded** rather than allowed to grow with the session.

A gateway that hardcodes one request shape will fail the moment the config value in decision 2 is changed — that is, at exactly the moment the decision is being exercised. Per-model request shape belongs in the provider abstraction, and a test covers each configured model.

### 4. The assistant requires an authenticated account

The anonymous-start path gets the rest of the product and not the assistant. An unauthenticated request path to a metered third-party API is the standard way to be billed for someone else's traffic, and no per-user limit is meaningful without a user.

### 5. Per-user limit: 100 messages per account per rolling 24 hours

Every provider call counts, **retries included**, because the cap exists to track real spend rather than user intent. Hitting it is a hard stop with a recoverable error that names when the window resets. A rolling window rather than a calendar day, so it cannot be gamed by waiting for midnight and does not reset in the middle of a European evening session.

### 6. Two kill switches, one manual and one automatic

A server-side flag that disables the assistant immediately without a deploy, and an automatic cut-off at **$25/day** of organization-wide spend. That figure is roughly eight times expected cohort load, so it fires on something being wrong rather than on a busy test week.

The manual flag alone leaves nothing watching overnight or over a weekend, which is when a runaway loop is most expensive. The automatic ceiling alone leaves no way to stop an incident quickly. Both are cheap; neither substitutes for the other.

### 7. The limits are configuration in one module

The cap, the window, the spend ceiling, and the model ID live in one place alongside the assistant transcript retention window, rather than as literals spread across the gateway, the quota check, and the UI copy that has to tell a user what the limit is.

## Consequences

### What this buys

- `AI-001` is unblocked, and with it the assistant milestone.
- The cheapest defensible model gets a fair trial in real use, and switching away from it costs a config change rather than a reopened decision.
- The expensive failure modes — an unauthenticated caller, a retry loop, a weekend leak — each have something specific stopping them rather than a general intention to be careful.

### What this costs, and what we do about it

- **Sonnet 5 may generate more proposals that fail validation than a larger model would.** The mitigation is that failure is safe rather than silent: an invalid proposal is rejected before it mutates anything, and decision 2 makes the model swappable the moment dogfooding says so. If proposal quality is the thing that fails, we will find out from use rather than from argument.
- **A shared organization ceiling means one account's runaway takes the assistant down for everyone.** Accepted at cohort scale, where "everyone" is twenty people and someone will notice within the hour. It stops being acceptable at a larger cohort — see *Revisit when*.
- **Authenticated-only means the anonymous first-run path cannot show the assistant.** A demo to someone who has not signed up shows the DAW and not the thing that most distinguishes it. Accepted for the alpha, where the cohort is invited and signs in anyway.
- **Counting retries against a user's cap makes the number in the UI larger than the number of messages they sent.** The copy has to say "requests" honestly rather than imply message count, or a tester will report the cap as a bug.
- **A rolling-window counter needs per-account storage and its own tests**, where a calendar-day counter would not.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Start on Opus 5 for best proposal accuracy | Roughly 2.5x the per-turn cost, which across the whole alpha is about $100 — real but not decisive. The product owner would rather learn what the cheaper tiers actually do in dogfooding than pay to avoid finding out, and decision 2 makes that reversible |
| Fix one model for the alpha, no switching | A quality failure could then only be answered by reopening `DEC-005` at the `REL-002` gate, which is the most expensive moment to discover it |
| Let anonymous users reach the assistant | Best first-run experience, and an uncapped-by-identity path to a metered API. Not for an alpha whose sign-up is open |
| Token-cost cap per user instead of a message cap | Truer to spend, and "you have $2 of assistant left" is meaningless to a producer mid-track. The message cap is the number a user can reason about |
| No per-user cap, global ceiling only | One tester's script or one retry loop consumes the whole organization's budget before the ceiling notices |
| Manual kill switch only | Nothing protects the account overnight or over a weekend |

## Revisit when

- Dogfooding shows proposal quality below the bar on the configured model — decision 2 is exercised, and this ADR is not reopened.
- The cohort grows beyond roughly twenty people, at which point a shared organization kill switch stops being a proportionate response to one bad actor and per-account spend tracking earns its cost.
- The automatic ceiling fires from genuine usage rather than from a defect, which would mean the figure in decision 6 is wrong rather than that something broke.
- Anthropic's pricing or model line-up changes enough to alter the arithmetic in decision 2.
- Public launch, where anonymous access, cohort size, and abuse surface all change together.
