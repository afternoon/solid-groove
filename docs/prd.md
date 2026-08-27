# Solid Groove Product Requirements Document

| Field | Value |
| --- | --- |
| Status | Principles and product intent - not a feature specification |
| Product stage | Private alpha, developed iteratively |
| Primary platform | Desktop web browser |
| Audience | Electronic music makers moving from simple beat-making tools toward a full DAW |
| Primary outcome | Help a user turn a promising loop into a complete, exported track |

Related documents: [Core flows](./core-flows.md), [Sample library plan](./sample-library.md)

## What this document is

This document holds the *why* and the *for whom*: the vision, the product principles, the user we build for, the goals and non-goals, how we think about sample licensing, and what we promise about privacy. It is the standard a change is judged against when the question is whether it belongs in the product.

**It does not specify features.** The sections that did — core experience, functional requirements, interaction requirements, technical architecture, success measures, the delivery plan, the workstream split, and the test strategy — were removed once the product was up and running and the work moved to iteration. From here:

- **What to build** is a [GitHub issue](https://github.com/afternoon/solid-groove/issues). The issue body is the specification; there is no requirement here for it to satisfy.
- **The product behavior a test must hold to** is a registered flow in [`docs/core-flows.md`](./core-flows.md).
- **How the code is arranged** is [`CLAUDE.md`](../CLAUDE.md) and the documents it links — [persistence](./persistence.md), [shortcuts](./shortcuts.md), the [ADRs](./adr), and the [sample library plan](./sample-library.md).
- **Which tests run, and what "done" means** is [`docs/testing.md`](./testing.md) and `CLAUDE.md`'s definition of done.

Where this document and an issue disagree, the issue decides *what ships*; this document decides *whether it should*. A change that contradicts a principle here is worth arguing about before it is built.

Section numbers are left as they were as the specification sections came out, so they run 1-5, 10, 15, and 16 and the references that survive still resolve. The removed text is in git history; a reference to a section or requirement ID that no longer appears here (`7.6`, `9.7`, `AUD-01`, `KEY-01`) points into that history, not into current scope.

### On the design mocks

The UI mocks in [`docs/design`](./design) are **directional**. They depict the north-star end state for Solid Groove — the fullest expression of the product's visual language, instruments, and assistant — not the private alpha or any single earlier milestone. Where a mock shows more than is being built (for example, richer instrument panels, a public marketing site, or the assistant recommending tutorial videos), the open issues are authoritative for *what ships when*. The mocks are authoritative for *how it should look and feel* once built. When a mock and this document disagree on a concrete UI detail, the mock wins on visual language and interaction shape; this document wins on whether the capability belongs in the product at all. New capability seen only in the mocks needs an issue before it is built, rather than being pulled in alongside unrelated work.

The mocks do not cover every screen and state the alpha needs. Save status (`Saving`, `Saved`, `Save failed`), empty/loading/error/offline states, the step editor and piano roll interiors, and the arrangement at other zoom levels have no mock. Implementers extrapolate those from the documented design DNA — the token set, surface tints, single cyan accent, square corners, and the shared 30px control height in [`docs/design/README.md`](./design/README.md) and the CSS custom properties in `docs/design/Solid Groove Mocks.dc.html` — rather than waiting for a mock or inventing a second visual language. A screen built without a mock is flagged for a design pass before the private alpha; a missing mock never blocks implementation.

## 1. Product summary

Solid Groove is a browser-based electronic music production environment with an integrated AI producer. It is for people who understand the basics of making beats or loops but repeatedly get stuck when they try to develop those ideas into full tracks. Synthesizers, samples, drum machines, and creative audio processing are its primary sound-making tools; recording acoustic performances is not the initial focus.

The product bridges the gap between approachable tools such as Koala Sampler and professional DAWs such as Ableton Live and Logic Pro. It introduces real production concepts - tracks, clips, arrangement, sound design, mixing, and iteration - without presenting the full complexity of a professional DAW at once.

The AI assistant is not a one-click song generator. It helps the user make progress inside an editable project. It can explain a technique, propose concrete changes, apply those changes with permission, and leave every result available for the user to inspect, tweak, undo, and learn from.

### Product promise

> Bring a loop. Leave with a track, and understand more about how it was made.

## 2. Problem

Many music-making products optimize either for immediate gratification or for maximum professional control.

- Beginner tools make it easy to create a satisfying loop but provide little guidance for developing it.
- Professional DAWs contain the required tools, but their workflows, terminology, and blank-canvas experience create a steep learning curve.
- Tutorials explain techniques away from the user's actual project and interrupt the creative flow.
- Generative music tools can return a result but often remove authorship, control, and opportunities to learn.

The target user does not need another toy or a simplified course. They need timely, project-specific help applying production techniques while retaining creative control.

## 3. Vision and principles

### Vision

Solid Groove should become the best environment for learning music production by producing music. A user should be able to start immediately in the browser, develop ideas with an AI producer beside them, use a coherent library of sounds, and eventually work with other people.

### Product principles

1. **Creation before instruction.** Teach in response to the user's musical goal, not through mandatory lessons.
2. **AI proposes; the user decides.** Material changes are previewable, attributable, and undoable.
3. **Everything remains editable.** AI output uses the same tracks, clips, notes, devices, and parameters as manual edits.
4. **Progressive depth.** Show the controls needed for the current task and allow users to reveal more detail as they grow.
5. **Legible controls.** A control should teach what it does. Use plain, spelled-out labels, consistent layout, and visual cues that reveal a control's effect on the sound, so users learn the vocabulary of production by touching it, not only by reading the manual or asking the assistant.
6. **Use transferable concepts.** Terminology and workflows should prepare users for professional DAWs rather than inventing a dead-end abstraction.
7. **Fast path to sound.** A new user can hear and alter music before creating an account or configuring audio.
8. **Protect creative flow.** Playback must be dependable, edits must feel immediate, and persistence must not interrupt work.
9. **Opinionated, not restrictive.** Good defaults and focused workflows reduce decisions, but users can always modify the result.
10. **Make room for the unexpected.** Genre-aware starting points must never become genre rules. Device chains and broad parameter ranges should support abrasive, unusual, and surprising results as well as polished ones.

## 4. Target user

### Primary user

A hobbyist or aspiring electronic music producer who has used a sampler, groovebox, drum machine, mobile beat-making app, or entry-level DAW. They primarily create with synths, samples, sequencing, and processing rather than recording acoustic performances. They can make or modify a beat and recognize basic ideas such as tempo, drums, bass, and effects. They may not be confident with arrangement, harmony, transitions, sound design, or mixing.

Initial genre coverage includes techno, house, drum and bass, hip hop, dubstep, lofi, ambient, trance, UK garage, breakbeat, and electronic pop, alongside other electronic and electronically produced popular styles. These genres define content and testing breadth, not separate product modes.

Typical behaviors:

- Creates many 4- or 8-bar loops but finishes few tracks.
- Learns through experimentation and short videos rather than formal theory.
- Wants guidance without surrendering creative authorship.
- Is willing to tweak notes, sounds, and controls when the purpose is clear.
- May eventually move work into a professional DAW.

### Jobs to be done

- When I want to sketch a new idea, help me create and iterate on loops quickly in partnership with the assistant.
- When I have a loop I like, help me decide what should happen next.
- When my track feels repetitive, help me create structure, variation, and transitions.
- When I hear a problem but lack the vocabulary to describe it, help me diagnose and fix it.
- When a sound feels plain or predictable, help me process it into something distinctive, including extreme and experimental results.
- When a production technique is suggested, show me what it changes in my project.
- When the result is close, help me balance it and export something I can share.

### Not the primary user

- A first-time music maker who needs every musical concept hidden.
- A professional who needs third-party plugins, detailed automation, advanced routing, or recording-studio workflows.
- A musician whose primary workflow is recording and comping acoustic instruments or vocals.
- A user seeking a prompt-to-finished-song generator with no manual editing.

## 5. Goals and non-goals

### Private alpha goals

1. A user can build and edit a multi-track musical loop.
2. A user can turn that loop into a multi-section arrangement lasting as long as ten minutes.
3. The assistant can inspect the project, explain relevant techniques, and make useful, undoable changes.
4. A user can shape synths, samples, drum machines, and substantial processing chains without leaving the app.
5. Projects persist reliably and can be rendered as a stereo WAV or as DAW-ready multitrack WAV stems.
6. The interface teaches transferable production concepts through use.
7. Bundled instruments, processing, and content can produce credible but non-prescriptive results across the required initial genres.

### Non-goals for the private alpha

- Microphone, line-in, or multitrack audio recording.
- Third-party plugins, Audio Units, VSTs, or arbitrary Web Audio graphs.
- Real-time multiplayer editing.
- Mobile-phone production parity. Phones may show a dashboard or playback view, but the editor is desktop-first.
- Stem separation, sample generation, text-to-music, or other generated audio.
- Advanced modulation systems, automation recording, complex automation curves, side-chain routing, or mastering suites. Focused breakpoint automation is included in P0.
- A content marketplace: publishing, sharing, buying, or selling packs. Packs are how the alpha organizes its own bundled library (LIB-04); everything transactional about them is later work (LIB-05).
- Music notation, score editing, video sync, surround sound, or unusual time signatures.
- Round-trip compatibility with Ableton Live, Logic Pro, or other DAWs during the private alpha. A one-way Ableton Live handoff is a P1 requirement.

## 10. Non-functional requirements

### Supported environment

- P0 gating support: current and previous major desktop versions of Firefox, Chrome, and Edge. These three are verified in automated suites and block release.
- Safari is best-effort for the private alpha. It is expected to work, defects found in it are logged and fixed where the cost is reasonable, and Safari is not a release gate. Playwright WebKit runs alongside the gating browsers where it is cheap to do so, and its result is treated as a signal rather than as proof about Safari — WebKit passing is not the same as Safari passing.
- This is a deliberate scope reduction for the alpha, not a judgement that Safari matters less. Safari diverges most from other engines on Web Audio behavior — autoplay/unlock policy, decoding, and context lifecycle — so it carries the highest chance of a late surprise, and it is the default browser for most Mac users in the target audience. Restoring Safari to gating status is a product-owner decision expected before any public release, and no implementation may knowingly break it in the meantime.
- A compatibility regression in a gating browser blocks the alpha release unless the affected feature has an explicit, usable fallback approved by the product owner.
- Browser capabilities are feature-detected. Core behavior does not branch only on user-agent strings.
- The app detects unsupported Web Audio or decoding capabilities and explains the limitation.

### Performance budgets

- Dashboard shell interactive within 3 seconds on a typical broadband connection and mid-range laptop, excluding cold authentication delays.
- Editor shell visible within 3 seconds; cached starter-project playback ready within 2 seconds after the first play gesture.
- Pointer-driven note and parameter edits target a visual response within 50 ms.
- Arrangement scrolling and zooming meet the frame budgets recorded in [`docs/arrangement-renderer-spike.md`](./arrangement-renderer-spike.md) for the 50-track reference project on the baseline device.
- The 40-track, 10-minute audio reference project includes processing on every track and at least 64 active device instances across inserts and returns.
- Assistant streaming or loading must not block audio, editing, or autosave.

These are alpha targets and must be measured before being treated as launch guarantees.

### Reliability

- An uncaught assistant, asset, or visualization error cannot stop the transport or destroy unsaved state.
- Project navigation, failed asset loads, cancelled exports, and HMR leave no orphaned contexts, nodes, schedules, buffers, or subscriptions.
- A global error boundary offers recovery and preserves a downloadable diagnostic snapshot where safe.
- Network loss is visible. Existing decoded assets continue playing and edits queue locally when feasible.
- Logging excludes raw audio, authentication tokens, and full project contents.

### Security and privacy

- Secrets are never shipped to the browser.
- Project access is denied by default and authorized server-side.
- Rich text from users or models is rendered without executable HTML.
- Asset uploads are type/size validated and served with safe content headers when P1 import ships.
- Users are told what project data is sent to an AI provider and can decline assistant use without losing manual DAW features.
- Users are told what product analytics and error reports are collected (OPS-02, OPS-03) and can decline product analytics without losing any DAW or assistant capability.
- Analytics and error events never carry project content, user-entered text, asset URLs, or authentication tokens, and this is enforced by a test rather than by reviewer memory. The test covers the third-party monitoring payload as well as our own event catalog, because that SDK collects breadcrumbs by default that the rule forbids.
- Two collections are deliberate exceptions to the spirit of the line above and are disclosed rather than inferred ([ADR 0003](./adr/0003-replay-canvas-capture-and-assistant-conversation-retention.md)): sampled Session Replay recordings include the arrangement and piano roll, and assistant conversations are retained first-party to improve the assistant. Both are covered by the telemetry opt-out, and neither sends user-entered text to a third-party processor.
- Error monitoring uses a third-party processor (Sentry, per ADR 0001). It is disclosed to the user alongside product analytics, its retention and regional storage are part of the same product decision, and no additional processor is added to the alpha without an ADR.
- The alpha's single hosted environment is the production project (OPS-01). Test suites run against the emulator suite and must not write to it, and deployment credentials live in CI rather than on developer machines.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| DAW scope expands faster than the core journey | Alpha never becomes coherent | Hold P0 to loop, arrangement, assistant edits, and export; require evidence before promoting P1/P2 work |
| Browser audio timing or lifecycle defects erode trust | Users abandon projects despite good features | Isolate the engine, schedule ahead, build offline tests, and maintain a maximum-size reference project |
| HMR, navigation, or reactive updates leak contexts and Tone objects | Chrome context limits, rising memory/CPU, duplicated triggers, and eventual playback failure | Own one application-scoped context, preserve it across compatible HMR, reconcile stable graphs, require idempotent disposal, and assert instrumented resource baselines |
| Dense arrangement rendering overwhelms older integrated graphics or the main thread | Scrolling and editing become unusable on target hardware | Use viewport-sized layered Canvas 2D, culling, virtualized DOM, waveform pyramids, allocation profiling, and a physical 2019 Intel MacBook Pro release benchmark before considering WebGL |
| Safari is non-gating during the alpha | Web Audio unlock, decoding, or context-lifecycle defects surface late on the browser most Mac users default to | Keep Playwright WebKit in the automated suite as a signal, feature-detect rather than branch on user agent, fix reasonable-cost Safari defects as they are found, and require an explicit product-owner decision to restore gating status before any public release |
| Renderer budgets are not enforced until Alpha Milestone 2 | A structurally slow renderer is discovered after the production arrangement is already built on it | Alpha Milestone 0 still ships the fixtures, scripted traces, and measurement harness with checked-in baseline numbers; `ARR-005` profiles before the arrangement is called done, and the projection/geometry contracts stay renderer-agnostic so a replacement renderer remains possible |
| Large or extreme processing chains overload the browser or create unstable output | Glitches interrupt creation or unsafe peaks reach the output | Enforce measured device-count budgets, smooth parameters, bound unstable feedback internally, profile the processed reference project, and retain a transparent master safety limiter |
| AI changes feel arbitrary or destroy work | Loss of authorship and trust | Structured proposals, validation, selection scope, atomic apply, visible diff, and immediate undo |
| AI context becomes too large or expensive | Slow, unreliable assistant | Compact musical summaries, scoped selection, deterministic analysis, token/usage budgets, and provider-independent gateway |
| Concurrent agents create incompatible models | Rework and subtle corruption | Alpha Milestone 0 contracts, one schema owner, contract tests, and thin vertical-slice integration before parallel expansion |
| Sample licensing is unclear | Product cannot ship its content | Record provenance and permitted use in the asset manifest before an asset is merged |
| The pack model adds a layer without earning it | Extra indirection in identity, delivery, and the browser for no user benefit, and packs become an empty folder level | Keep packs the unit of curation, rights, delivery, and browsing rather than a second tag system; require every starter pack to be usable on its own for its stated purpose; hold pack membership to organization only so no capability depends on it |
| The marketplace opportunity pulls scope forward | Alpha spends effort on publishing, entitlement, and payments before anyone has finished a track in the product | Keep LIB-05 P2 and unscheduled, ship the alpha with bundled factory packs only and no entitlement model, and require the alpha's creation journey to be validated before any marketplace work is scheduled |
| Ableton's project format or behavior changes | Exported sets fail or silently lose work | Target a declared Live version, isolate the serializer, test fixture exports in Live, report conversion loss, and always include portable stems/MIDI |
| Autosave conflicts with rapid edits | Lost changes or controls jumping backward | Optimistic local authority, coalesced writes, revision checks, and explicit save state |
| The interface becomes a smaller but still intimidating DAW | Target users remain stuck | Progressive disclosure, task-based user tests, opinionated templates, and arrangement-first assistant suggestions |
| Production is the alpha's only hosted environment | A bad deploy reaches the cohort, or a deploy damages real project data | Deploy rules/indexes with the app from one pipeline, stamp and smoke-test every release, keep rollback documented and practised, hold incomplete journeys behind feature flags, and revisit the single-environment decision before public launch or before data loss would be unrecoverable |
| Instrumentation is deferred to a later "telemetry" task | The alpha ends with no baseline for its own success measures and cannot tell which features were tried first | Ship the event catalog in Alpha Milestone 0, make analytics part of the definition of done for every feature task, and assign each catalogued event to the task that builds the feature it measures |
| Analytics or error reports leak project content | A privacy failure in the product whose value is the user's own music | One typed catalog with enumerated parameters, prefixed IDs instead of names, a test that rejects content-bearing parameters and covers events added later, and a user-facing opt-out that costs no capability |
| A third-party monitoring SDK collects more than the product allows | Clip names, console output, or on-screen music reach an external processor by default rather than by decision | Keep the reporting boundary in application code, disable console breadcrumbs and `sendDefaultPii`, scrub before transmission, gate Session Replay on a superseding ADR and on mask-by-default text capture ([ADR 0002](./adr/0002-sentry-session-replay.md)), and extend the content test to the SDK payload — replays included — rather than only our own events. Canvas capture is the one deliberate exception ([ADR 0003](./adr/0003-replay-canvas-capture-and-assistant-conversation-retention.md)): sampled recordings include the arrangement and piano roll, disclosed as such, reversible with one flag |
| Retaining assistant conversations becomes a liability | A first-party corpus of free-form user text is held indefinitely, over-accessed, or survives the deletion of the project it came from | Store conversations owner-scoped in our own Firestore and never in a third-party processor ([ADR 0003](./adr/0003-replay-canvas-capture-and-assistant-conversation-retention.md)); bind deletion to project and account deletion, bound retention under `DEC-009`, cover the store with the telemetry opt-out, and disclose it specifically rather than under general terms |

## 16. Decisions and open questions

### Decisions made for implementation

- Desktop web is the alpha production surface.
- The application deploys to Firebase Hosting from CI starting in Alpha Milestone 0, and the private alpha runs on one hosted environment — the production Firebase project. Rules and indexes deploy with the app; the decision is revisited before public launch.
- Verification that needs a live hosted environment — the post-deploy smoke test run, the rollback drill, and observing analytics events and errors from a deployed build — is batched into one operator task, `OPS-001`, scheduled immediately after Alpha Milestone 2 rather than inside Alpha Milestone 0. The implementation, wiring, and automated tests stay in `FND-001b`/`FND-001c`. The criteria are unchanged and still required before the cohort is invited (`HARD-005`); what moves is when they are executed. The accepted cost is that a defect only reproducible against real Firebase, GA4, or Sentry surfaces after Alpha Milestone 2 instead of during Alpha Milestone 0.
- Product analytics use Google Analytics for Firebase through one typed event catalog (OPS-02), and shipping a feature's events is part of that feature's definition of done rather than a later instrumentation pass.
- Computing the **primary success measure** (track progression rate) is deferred to post-alpha (`DEC-011`). Measurement and goaling need more consideration than the alpha can give them: the thresholds, what counts as an "activated" project, and whether track progression is even the right primary measure are all unsettled, and a measure adopted casually is harder to withdraw later than one adopted late. The events it would be computed from (`project_created`, `arrangement_milestone`, `transport_play`, `export_completed`) still ship with their features and are still covered by automated tests, so no instrumentation work is lost and the measure can be computed retroactively once defined. The accepted cost is that the alpha runs without a quantitative primary success measure and leans on qualitative validation from user sessions instead. This descopes one `OPS-001` criterion; the rest of that task is unchanged.
- Two `OPS-001` console-inspection checks are deferred to post-alpha (`DEC-012`): confirming **what a delivered error looks like in the Sentry UI** (release SHA on the issue, a symbolicated stack, tags, a redacted message, one issue per error, crash-free session rate), and confirming **internal-traffic exclusion** in GA4. Both are properties of a vendor console rather than of the app; both are already covered by automated tests against a fake SDK; and both were absorbing attention better spent building the core product experience, which is the alpha's actual risk. Neither affects a cohort session: error *delivery* is verified from the deployed build, and source maps are confirmed uploaded with matching debug IDs, so symbolication rests on a narrow remaining assumption. The accepted cost is that a scrubbing misconfiguration the unit tests do not model could carry user content into Sentry unnoticed, and that alpha-period measures may be inflated by the team's own sessions — the latter mattering only for reading numbers whose primary measure is itself deferred (`DEC-011`). Both are cheap to run once the alpha is built. This descopes two `OPS-001` criteria; gate `G4.5` opens on the rest.
- Crash and error monitoring use Sentry behind the application's own reporting boundary ([ADR 0001](./adr/0001-sentry-for-error-monitoring.md)). Firebase Crashlytics does not support the Web SDK, and Google Cloud Error Reporting cannot symbolicate browser stack traces without publicly serving our source maps — which `OPS-03` forbids. Session Replay is enabled for product understanding under mask-by-default capture and the analytics opt-out ([ADR 0002](./adr/0002-sentry-session-replay.md)), and replacing Sentry requires a superseding ADR.
- Approved architecture decision records live in [`docs/adr`](./adr). They record the committed stack decisions; `CLAUDE.md` describes the stack as it is actually built.
- Current and previous major Firefox, Chrome, and Edge are the gating P0 browsers, with a 2019 Intel MacBook Pro class machine as the performance baseline. Safari is best-effort for the alpha and expected to return to gating status before public release.
- Musical time is integer ticks at 192 PPQ, matching Tone.js transport resolution so stored and scheduled time need no conversion.
- Persistent IDs are type-prefixed 21-character nanoids, for example `trk_V1StGXR8Z5jdHi6B_myT`.
- Firestore schema v1 stores a project as a metadata document, one song document, and one document per clip, with a documented song-document size budget and a defined per-track chunk overflow path.
- Alpha Milestone 0 defines the parameter-definition mechanism; per-device parameter values are authored with their devices in Alpha Milestone 1.
- Arrangement frame budgets are enforced at `ARR-005` and `HARD-001`. Alpha Milestone 0 owes measurement infrastructure and honest baseline numbers, not passing scores, and no Alpha Milestone 0 task depends on the physical baseline device.
- Screens and states without a mock are extrapolated from the documented design DNA and flagged for a later design pass rather than blocking implementation.
- The initial audience produces electronic music primarily with synths, samples, drum machines, sequencing, and processing rather than acoustic recording.
- Initial content and product testing cover techno, house, drum and bass, hip hop, dubstep, lofi, ambient, trance, UK garage, breakbeat, electronic pop, and other electronic or electronically produced popular styles without genre-locked modes.
- Overdrive, saturation, compression, reverb, delay, insert chains, and send effects are P0 creation tools rather than post-alpha additions.
- The core project model uses tracks, reusable clips, arrangement placements, and sections.
- Library content is organized into packs from the alpha (LIB-04). Every asset belongs to exactly one pack, asset identity is pack-qualified, packs are versioned and immutable once published, and a project records the packs and pack versions it depends on. The alpha ships bundled factory packs only, with no installation, entitlement, or purchase model.
- A pack marketplace (LIB-05) — creator-published packs, acquisition, and premium packs — is P2 and unscheduled, after the private alpha and after user sample imports. The alpha's pack model exists so it can be built later without a second content system, not because any part of it is alpha work.
- Alpha time signature is fixed to 4/4.
- AI produces structured project edits, not generated audio.
- Exported stereo WAV is the first listening and sharing mechanism; aligned WAV stems are the P0 vendor-neutral DAW handoff.
- Stereo and stem exports preserve project gain exactly rather than applying a peak/loudness normalization policy. Final output level stays under the producer's control; no export library may change it implicitly (`DEC-004`).
- A self-contained Ableton Live Set is the first native project-format handoff target after the private alpha.
- Ableton export targets the oldest Live version that can correctly support the implemented handoff; an exporter compatibility spike establishes and documents that minimum version.
- Native Live Set generation is built and maintained directly as our own `.als` serializer rather than through a supported partner/integration route: Ableton publishes no partner API or SDK that can produce a native Live Set on our behalf, so that route cannot meet `SHR-02`'s self-contained-file acceptance criteria and would in practice degrade to shipping MIDI and stems for manual reassembly. `P1-001` surveys existing open-source `.als` parsing/writing libraries across Live versions and builds on one where its schema coverage and licence are adequate, to minimize the maintenance burden of an unofficial, reverse-engineered file format (`DEC-007`).
- Real-time collaboration follows validation of the single-user creation workflow.
- SolidJS/TypeScript served by `@solidjs/vite-plugin`'s client start mode ([ADR 0005](./adr/0005-leaving-solidstart-for-the-vite-plugin.md)), Tone.js over Web Audio, and Firebase Auth/Firestore/Storage/Functions are committed alpha technologies.
- One long-lived real-time Tone/Web Audio context per document and stable, incrementally reconciled audio graphs are hard alpha architecture decisions.
- The alpha arrangement is a hybrid virtualized DOM plus layered Canvas 2D renderer; WebGL/WebGPU and WASM require measured failure plus an approved ADR.
- An anonymous project is retained until 180 days after its last access; opening or otherwise accessing it resets the timer. Deletion is scoped to anonymous projects only, and authenticating as an account owner before expiry keeps the project indefinitely (`DEC-001`).
- Upgrading from anonymous to an authenticated account never loses an anonymous project. Each device records, in local browser storage, which anonymous projects were created or edited there. When that device is used to authenticate, the user is offered a pairing flow that attaches its locally-recorded anonymous projects to the authenticated account; once a project is paired, its local record is deleted. Multiple people sharing one device is explicitly out of scope: whichever anonymous projects were edited on a device are assumed to belong to whoever next authenticates on it (`DEC-001`).
- Alpha content sources are limited to CC0 1.0 material and content Solid Groove owns; nothing else is bundled (`DEC-003`). The alpha commissions nothing — the commissioning budget is zero and premium or commissioned sources are deferred to a later milestone — because a prototype does not need a rounded library, only a real one. Because the only third-party licence is CC0, there is no user-facing attribution obligation and no per-asset export exclusion: every bundled asset is safe in stems and Ableton packages, and the exclusion machinery in the manifest exists for future OEM content, not for the alpha. Sourcing runs three routes, in priority order: (1) synthesized and Solid-Groove-owned content, the reliable coverage floor that needs no rights review; (2) trusted bulk CC0 archives — VCSL, Producer Space's CC0-cleared library, and individual FreePats CC0 banks — ingested as a unit with the archive-wide licence captured once as evidence, valid only where one archive carries exactly one CC0 licence; and (3) the Freesound API filtered to `Creative Commons 0`, queried against a short list of named coverage gaps (the classic drum-machine hits and a few organic and texture sounds) so a curator only ever reviews pre-licence-cleared candidates for musical quality and provenance. The alpha library is expected to be usable but not yet rounded, and that is an accepted state for a prototype. The specific pack list this clears is `DEC-010`, and mixed-licence per-file review (Signature Sounds, direct Freesound loops) remains available but is not required to unblock the alpha. See [`docs/sample-library.md`](./sample-library.md) sections 3.2 and 4.

### Product-owner decisions required before Alpha Milestone 3 or launch

- Which factory packs does the alpha ship, and what is each one's name, scope, and stated purpose? The list follows from the assets that can actually be cleared, so it is settled with the content plan rather than ahead of it.
- For the later pack marketplace (LIB-05): who may publish a pack, what rights and revenue-sharing terms apply to a creator, what moderation and takedown process governs published content, and what happens to a project that uses a pack after that pack is withdrawn or the user's access to it ends? (Post-alpha; unscheduled.)
- Which AI provider, model budget, usage limit, and data-retention policy are acceptable for the alpha?
- Who are the first 8-20 target testers, and what existing tools/genres should the cohort represent?
- What consent, retention, and regional policy applies to product analytics and error reports — is analytics on by default with an opt-out, how long is event and error data retained, and does the Sentry data region satisfy any regional constraint, or does that constraint reopen self-hosting? (`DEC-009`.)
- When does the alpha stop deploying only to production: what triggers adding a separate staging or preview environment, and does it happen before the cohort grows or before public launch?
- For the later-vision tutorial video recommendations (AI-08), which creators or sources are trusted, how does a video enter the curated set, and what embedding and data-sharing terms are acceptable? (Post-alpha.)

## Appendix A - Initial assistant command families

Exact payloads belong in the technical specification, but the allowlist should cover these versioned families:

- `project.setTempo`
- `track.add`, `track.update`, `track.move`, `track.duplicate`, `track.remove`
- `clip.add`, `clip.update`, `clip.duplicate`, `clip.remove`
- `note.add`, `note.update`, `note.transform`, `note.remove`
- `placement.add`, `placement.update`, `placement.duplicate`, `placement.remove`
- `section.add`, `section.update`, `section.move`, `section.remove`
- `instrument.set`, `instrument.setParameter`
- `device.add`, `device.update`, `device.move`, `device.duplicate`, `device.remove`
- `send.setLevel`, `return.add`, `return.update`, `return.remove`
- `automation.addLane`, `automation.setPoints`, `automation.transform`, `automation.removeLane`
- `mixer.setParameter`
- `transaction.apply`

Read-only assistant tools should include project summary, selection detail, section density, track activity, pitch/register summary, and peak/level analysis when real measurements are available.

## Appendix B - Reference alpha scenarios

1. **Drum loop to arrangement:** Starting from an 8-bar drum and bass loop, create Intro, Groove, Breakdown, Drop, and Outro sections; remove and vary elements to create contrast; export a valid stereo WAV and aligned multitrack stem package.
2. **Targeted variation:** Select the second drum clip, ask for a subtle end-of-phrase variation, inspect changed events, reduce one velocity manually, and undo/redo the whole proposal.
3. **Explain a mix issue:** Select a bass-heavy section, ask why it feels muddy, receive a qualified explanation based on known register and level data, then apply a small validated change.
4. **Failure recovery:** Disconnect the network during edits, continue changing the arrangement, observe save state, reconnect, and confirm the newest valid project persists.
5. **Malformed AI response:** Return unknown commands, invalid values, and stale IDs from a test provider; confirm the proposal cannot mutate the project and manual playback/editing continues.
6. **Experimental processing:** Stack saturation, overdrive, filtering, and delay on a plain source; automate a filter sweep and delay throw; reach an intentionally extreme but stable result; then bypass and undo the chain without changing the source clip.
7. **Genre breadth:** Open each required genre demo, inspect its editable instruments and processing, replace at least one sound with one from a different pack, and confirm playback/export uses no hidden backing track or missing asset.
8. **Keyboard workflow:** Open the mapping guide with `?`, find the duplicate shortcut, close it with `Escape`, then duplicate, quantize, draw, loop, play, undo, and redo without pointer input; confirm the same keys do not fire while typing into assistant chat.
9. **Web Audio lifecycle:** While playback runs, repeatedly edit parameters, reorder effects, add/remove tracks, switch projects, and simulate fifty HMR replacements; confirm unchanged nodes retain identity, transport does not duplicate or glitch, only one real-time context exists, and every project-scoped resource counter returns to baseline.
10. **Pack resolution:** Start a project from a genre pack and confirm the project records that pack and version; add a sound from a second pack and confirm both dependencies are recorded; make one pack unavailable and confirm the affected tracks and clips are named while unrelated playback, editing, and export continue; restore the pack and confirm the sounds return without the project itself having changed.

## Appendix C - Glossary

- **Pack:** A named, versioned, independently deliverable collection of library content with one publisher and one rights position. Every asset belongs to exactly one pack, and a pack is what a user browses, a project depends on, and the library is published in.
- **Pack version:** An immutable release of a pack's contents. Changing audio or metadata publishes a new version; an existing project keeps resolving the version it was built against.
- **Pack dependency:** A pack and pack version a project uses, recorded in the project so reopening, export, and collaboration resolve the same audio and a missing pack can be reported precisely.
- **Clip:** Reusable musical source material owned by one track. Editing a shared clip changes every placement that references it.
- **Placement:** An instance of a clip at a position on the arrangement timeline. A placement may repeat or expose only part of its source clip.
- **Independent variation:** A new clip copied from an existing clip so later edits do not affect the original.
- **Section:** A named timeline range used to describe song structure; it does not contain a separate hidden copy of the music.
- **Command:** A validated, undoable request to change project state.
- **Transaction:** An ordered group of commands that succeeds, fails, and undoes as a unit.
- **Proposal:** A not-yet-applied transaction produced by the assistant with a human-readable summary.
- **Project revision:** A monotonically increasing value used to detect whether a delayed command or proposal was created from stale state.
- **Named revision:** A durable user-created checkpoint that can be restored later.
