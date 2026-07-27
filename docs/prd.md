# Solid Groove Product Requirements Document

| Field | Value |
| --- | --- |
| Status | Draft for implementation |
| Product stage | Experimental prototype to private alpha |
| Primary platform | Desktop web browser |
| Audience | Electronic music makers moving from simple beat-making tools toward a full DAW |
| Primary outcome | Help a user turn a promising loop into a complete, exported track |

Related document: [Sample library plan](./sample-library.md)

### On the design mocks

The UI mocks in [`docs/design`](./design) are **directional**. They depict the north-star end state for Solid Groove — the fullest expression of the product's visual language, instruments, and assistant — not the private alpha or any single earlier milestone. Where a mock shows more than a milestone requires (for example, richer instrument panels, a public marketing site, or the assistant recommending tutorial videos), this PRD's priorities (**P0**/**P1**/**P2**) and delivery phases are authoritative for *what ships when*. The mocks are authoritative for *how it should look and feel* once built. When a mock and this document disagree on a concrete UI detail, the mock wins on visual language and interaction shape; the PRD wins on scope, sequencing, and acceptance criteria. New capability seen only in the mocks is placed in the priority and phase noted here rather than pulled forward into the alpha.

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

### Current prototype baseline

The repository is an experiment, not a backwards-compatibility contract. It currently provides SolidStart/SolidJS UI, Tone.js/Web Audio playback, Firebase authentication and Firestore persistence, an anonymous-user path, a project dashboard, a fixed 16-step pattern, basic sampler/synth/clip instruments, a small bundled sample library, track volume, simple transport, and a set of model/audio/component tests.

The current editor renders only the first pattern, uses track and sequence array indexes as identity, and has placeholder browser and assistant panels. Arrangement, robust history, structured AI actions, export, and most P0 workflows in this document do not yet exist. Agents should preserve verified behavior where it supports this PRD, but may replace prototype structures without a migration or backwards-compatibility path. Existing prototype projects and stored documents may be discarded when the v1 model is introduced.

## 6. Core experience

### Primary journey: loop to finished track

1. The user opens Solid Groove and starts a project from a small genre template or a blank project.
2. The project makes sound immediately. The user edits the starter clips, replaces sounds, adds a track, or reshapes the sound with an instrument or processing chain.
3. The user selects a clip, track, section, or the whole song and asks the assistant for help, or chooses a suggested next action.
4. The assistant identifies a useful technique and proposes a concrete edit, such as creating a bass variation, thinning drums in a breakdown, or laying out an intro/build/drop structure.
5. The user previews the proposed actions, applies them, compares the result, and optionally undoes or adjusts them manually.
6. The user repeats this process while arranging the track on a timeline.
7. The assistant helps identify balance or repetition problems without claiming objective correctness.
8. The user exports a WAV and can return to the saved project later.

### Experience architecture

The editor has five stable regions:

- **Transport:** project name, play/stop, playback position, tempo, metronome, loop range, undo, and redo.
- **Browser:** sounds, instruments, processing devices, presets, and templates, organized into packs and searchable across them, with audition controls where relevant.
- **Arrangement:** the main timeline containing tracks, clip placements, and section markers.
- **Detail panel:** the selected clip's note editor or the selected track's device and mixer controls.
- **Assistant:** contextual conversation, suggested actions, change previews, and concise explanations.

The user must be able to resize or collapse the browser, detail panel, and assistant. The arrangement remains the visual center of the product.

## 7. Functional requirements

Priorities use **P0** for private-alpha requirements, **P1** for the next release, and **P2** for later vision.

### 7.1 Projects and persistence

**PRJ-01 - Start immediately (P0)**  
An unauthenticated visitor is assigned a persistent anonymous account and can create a playable project without completing registration.

Acceptance criteria:

- The dashboard offers Blank and the six approved featured starter templates: House, Techno, Hip Hop/Trap, Drum & Bass/Jungle, Dubstep/Bass, and Ambient (`DEC-002`).
- A starter template opens with audible musical content and no missing assets.
- Refreshing or reopening the browser retains projects for the same anonymous session.
- The UI explains that an anonymous user should upgrade their account to keep access across devices.

**PRJ-06 - Public landing page (P0)**  
A public marketing landing page (design mock `04-landing-page`) is the product's front door and the entry point into the fast path to sound. It communicates the product promise, shows the editor, and lets a visitor start immediately.

Acceptance criteria:

- The page states the product promise ("Bring a loop. Leave with a track.") and that Solid Groove is a browser-based studio with an AI producer, requiring no install.
- A primary call to action starts a playable project in the browser with no account required, dropping the visitor into the PRJ-01 anonymous-start flow, and a secondary path leads existing users to log in.
- The page names the supported browsers and the private-alpha status honestly, and does not advertise capabilities beyond the current milestone (for example, it does not imply generated audio or features not yet shipped).
- The page follows the same visual language as the editor (see [`docs/design`](./design)) and meets the Section 10 accessibility and performance expectations for a public marketing page.
- Marketing copy, the "2-minute tour," pricing, and richer marketing content beyond the start path are directional in the mock and may be staged; the alpha requires a functional, honest front door into the app, not the full marketing site.

**PRJ-02 - Project management (P0)**  
The dashboard supports creating, opening, renaming, duplicating, and deleting a project.

Acceptance criteria:

- Destructive deletion requires confirmation.
- Projects display name, last modified time, and template/genre when available.
- A duplicate receives independent IDs for all mutable entities.

**PRJ-03 - Reliable autosave (P0)**  
Edits save automatically without blocking audio or pointer interactions.

Acceptance criteria:

- The editor shows `Saving`, `Saved`, and actionable `Save failed` states.
- Rapid parameter changes are coalesced, but the final value is never lost on navigation or page close where the browser permits a flush.
- Remote echoes never overwrite a newer local edit.
- A transient persistence failure retains local changes and can be retried.

**PRJ-04 - Versioned data (P0)**  
Every stored project declares a schema version and can be migrated forward.

Acceptance criteria:

- The first production schema is version `1`; existing prototype documents are not part of that schema and do not need to load or migrate.
- Unknown future schema versions are never silently overwritten.
- Every migration introduced after schema v1 has fixture-based tests from each supported source version.

**PRJ-05 - Named revisions (P1)**  
The user can create and restore named project checkpoints without losing the current version.

### 7.2 Transport and playback

**AUD-01 - Dependable transport (P0)**  
The user can play, pause, stop, seek, and toggle playback with the space bar.

Acceptance criteria:

- Play starts only after a valid user gesture has unlocked the AudioContext.
- The visible playhead follows audible playback and returns to the expected position on stop.
- Space does not toggle playback while focus is in an input, textarea, dialog, or editable element.
- Playback continues correctly while non-structural parameters are edited.

**AUD-02 - Tempo, loop, and metronome (P0)**  
The user can set tempo, enable a metronome, and define an arrangement loop range aligned to bars.

Acceptance criteria:

- Supported tempo is 40-240 BPM.
- Alpha projects use 4/4 time; the fixed time signature is visible but not editable.
- Tempo changes during playback do not restart the song.
- Looping has no accumulating timing drift or duplicate triggers at the boundary.

**AUD-03 - Scheduling quality (P0)**  
Note and clip playback remains stable under normal editor load.

Acceptance criteria:

- Events are scheduled ahead of their audible time rather than dispatched solely from animation frames.
- A 40-track, 10-minute reference project, with no more than 24 simultaneously sounding tracks in a section, plays without skipped events on supported hardware.
- Muting, soloing, gain changes, and effect parameter changes do not rebuild unrelated audio nodes.
- Stopping and reopening projects disposes all players, instruments, events, and subscriptions.

**AUD-04 - Safe output (P0)**  
The master path includes metering and a transparent safety limiter to prevent dangerous or severely clipped output.

**AUD-05 - Offline render (P0)**  
The user can export the full arrangement as a stereo WAV.

Acceptance criteria:

- Export uses the same musical events, tempo, instrument settings, and supported effects as live playback.
- The resulting duration matches the arrangement bounds and does not truncate release tails.
- The 40-track, 10-minute reference project renders successfully without truncation or event drift.
- Export progress and failure states are shown.
- The file name is derived safely from the project name.

**AUD-06 - Multitrack stem export (P0)**  
The user can export one WAV stem per track as a simple, vendor-neutral path into Ableton Live, Logic Pro, FL Studio, and other production tools.

Acceptance criteria:

- Every stem starts at bar 1, has the same sample rate, bit depth, channel format, and total duration, and remains sample-aligned when imported at the project tempo.
- Each track stem includes its instrument or source audio, insert processing, focused automation, fader, and pan, but excludes master-channel processing.
- Send/return buses are exported as separate stems so shared delay and reverb tails can be reconstructed without being duplicated into every track.
- The package includes all non-empty tracks regardless of current mute or solo state by default; the export dialog lets the user explicitly exclude tracks and explains this behavior.
- Release and effect tails are preserved. Shorter stems are padded with silence to match the longest exported tail and prevent truncation or alignment differences.
- A ZIP package contains safely named, deterministically ordered WAV files, a stereo reference mix with master processing, and a human-readable manifest containing project tempo, time signature, track IDs/names, processing policy, sample rate, and bit depth.
- The user can choose at least 16-bit or 24-bit PCM WAV and a supported sample rate before rendering.
- The 40-track, 10-minute processed reference project exports successfully without drift, missing tracks, clipped tails, or browser memory failure on supported hardware.
- Progress, cancellation, and recoverable errors are visible. Failure cannot modify the project or present a partial ZIP as a successful export.

**AUD-07 - Single real-time audio context (P0)**  
The application owns at most one real-time `AudioContext`/`Tone.Context` per browser document. Once lazily initialized, it remains long-lived and is reused across projects, navigation, component remounts, and development hot-module replacement (HMR).

Acceptance criteria:

- A dedicated application-scoped `AudioRuntime` is the only production-code location allowed to create, install, replace, suspend, resume, or close the real-time Tone/Web Audio context.
- No Solid component, route, project store, instrument, effect, preview control, or assistant action constructs its own real-time context.
- The context is created lazily and resumed only after an allowed user gesture. Opening another project reuses the context and replaces only the project graph.
- Development HMR preserves a compatible `AudioRuntime` across module replacements. If replacement is unavoidable, the previous runtime is fully closed and its `close()` promise resolves before another context is created.
- HMR disposal removes project graphs, schedules, listeners, timers, and subscriptions even when the shared context itself is retained.
- Normal project or route teardown disposes the project graph but does not close and recreate the shared context unnecessarily.
- Application-controlled shutdown or incompatible runtime replacement awaits `AudioContext.close()` and drops all application references so browser audio resources can be released; normal document unload may rely on browser teardown.
- Offline export contexts are scoped to one render job, never installed as the real-time Tone context, and release all references after success, cancellation, or failure.
- Development diagnostics and browser tests can assert that the document has no more than one live real-time context owned by Solid Groove.
- Fifty consecutive simulated HMR replacements and fifty project open/close cycles in Chrome create no context-limit error and leave context/resource counters at their expected baseline.

The Web Audio specification describes `AudioContext` as an expensive system resource, states that user agents may impose an implementation-defined maximum, and says one context is normally sufficient. See [Web Audio API system-resource guidance](https://webaudio.github.io/web-audio-api/#system-resources-associated-with-baseaudiocontext-subclasses) and [`AudioContext.close()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close).

**AUD-08 - Stable reusable audio graph (P0)**  
The audio engine reconciles domain changes into a stable graph keyed by persistent track, instrument, device, return, and asset IDs. It updates or reconnects existing Tone objects whenever safe instead of rebuilding the graph for routine edits.

Acceptance criteria:

- Track instruments, insert effects, return effects, channel strips, meters, and master nodes have explicit owners and stable runtime identities.
- Parameter-only changes update existing `AudioParam` or Tone parameters with appropriate ramps/smoothing; they do not construct replacement instruments or effects.
- Adding, removing, reordering, or changing one track/device creates, reconnects, or disposes only the affected subgraph. Unrelated tracks and the master graph retain object identity.
- Track reorder, rename, color, selection, arrangement scroll, autosave acknowledgement, and assistant conversation changes create or destroy no audio nodes.
- Existing nodes are reused during device reordering. Connection changes made during playback use a muted handoff, short crossfade, or other measured click-free strategy where direct reconnect could glitch.
- Reusable instruments and effects remain alive across note triggers. Short-lived source nodes that Web Audio or Tone requires per note are permitted, but their schedules and references cannot accumulate after completion.
- Decoded buffers are cached by asset identity and source revision with reference-counted or otherwise deterministic eviction. Multiple users of one sample do not decode or retain duplicate buffers without a measured reason.
- Replacing a sample or instrument cancels obsolete asynchronous loads. A late completion cannot reconnect a removed object or overwrite the newer selection.
- Every engine-owned wrapper has an idempotent `dispose()` operation. Disposal stops/cancels schedules, removes callbacks and listeners, disconnects nodes, calls the appropriate Tone disposal methods, aborts pending work, releases cache references, and clears application references.
- Scheduled Tone transport events, sequences, parts, draw callbacks, timers, workers, meters, and reactive subscriptions are tracked by owner and removed during disposal.
- Repeated `dispose()` calls and disposal of a partially initialized or failed graph are safe and do not throw.
- Continuous parameter editing, device insertion/reordering, and track add/remove during playback produce no dropped transport position, duplicate trigger, discontinuity on unrelated tracks, or audible click beyond the intentionally changed signal.

Tone exposes a system-wide default context through [`getContext()`](https://tonejs.github.io/docs/15.1.22/functions/getContext.html), and Tone objects expose disposal specifically to disconnect their Web Audio nodes for garbage collection. Solid Groove wraps those facilities in its own ownership model rather than relying on garbage collection as lifecycle management.

**AUD-09 - Audio resource observability (P0)**  
Because Web Audio does not expose complete graph introspection, development and test builds instrument Solid Groove's audio factories and ownership registries.

Acceptance criteria:

- Diagnostics report active real-time/offline contexts, project graphs, track graphs, instruments, effects, channel strips, buffers/cache bytes, scheduled transport objects, subscriptions, timers, and pending loads.
- Each tracked resource records an owner ID and type; development builds can optionally record an allocation stack without shipping that overhead to production.
- Opening and closing the same fixture repeatedly returns every project-scoped counter to its pre-open baseline after asynchronous cleanup settles.
- Repeated parameter edits leave object-creation and disposal counters unchanged for the affected stable nodes.
- A developer-facing assertion reports leaked owners and resource types on HMR disposal, project teardown, and test cleanup.
- Diagnostics do not retain disposed resources themselves or expose project content in production telemetry.

### 7.3 Tracks, instruments, and mixing

**TRK-01 - Track management (P0)**  
The user can add, rename, reorder, duplicate, and delete tracks.

Acceptance criteria:

- Deletion warns when a track contains clips.
- Reordering does not change routing, clip ownership, or playback.
- The alpha supports at least 50 tracks per project without a hard cap at 50. Correctness is required above 50, but alpha interaction-performance targets no longer apply.

**TRK-02 - Mixer controls (P0)**  
Every track provides mute, solo, volume, pan, and a level meter.

Acceptance criteria:

- Mute and solo states are unambiguous and keyboard accessible.
- Multiple soloed tracks can play together; mute wins over solo.
- Faders use a perceptually useful curve and show a human-readable value.
- No control change creates audible zipper noise under normal use.

**INS-01 - Electronic instruments (P0)**  
The user can create synthesizer, one-shot sampler, and drum-machine tracks as first-class tools rather than simplified template-only sounds.

Acceptance criteria:

- The sampler supports sample selection, audition, pitch, start/end, and amp envelope.
- The synth supports oscillator waveform, amp envelope, and resonant filter controls.
- The drum machine supports at least 16 pads, per-pad sample selection, audition, pitch, level, pan, envelope, mute/solo, and choke groups.
- Drum-machine clips sequence pads in named lanes and retain per-hit velocity.
- Replacing an instrument or sample preserves compatible clip data and is undoable.
- Parameter ranges are validated before reaching the audio graph.

The synth and sampler panels in the design mocks (`05a-synth-voice`, `05b-sampler`) are directional and show a fuller instrument than this alpha baseline. The following controls are the intended end state but are **not required for the alpha** and are deferred to P1/P2: synth sub-oscillator, pulse-width, multi-mode filter (high-pass, band-pass, notch in addition to the P0 resonant low-pass), filter envelope amount, and key tracking; sampler fine tune, gain, pan, an envelope hold stage, and a per-sampler filter. The alpha synth and sampler match INS-01 above; the visual language (vertical fill-sliders, labelled option groups with waveform/filter icons, live envelope and filter-response curves) follows the mocks from the start per the Legible controls requirements.

**INS-02 - Audio loop tracks (P0)**  
The user can place curated tempo-labelled audio loops that follow project tempo.

Acceptance criteria:

- Every loop declares source BPM and bar length.
- Loop boundaries stay aligned over repeated playback at supported tempos.
- The UI distinguishes time-stretched loops from pitched one-shot samples.

**FX-01 - Core electronic processing (P0)**  
Tracks and the master channel support editable, ordered processing chains. The alpha includes filter/EQ, overdrive, saturation, compression, tempo-syncable delay, and reverb as core devices, not optional preset-only polish.

Acceptance criteria:

- A device can be added, removed, reordered, duplicated, bypassed, and reset; each action participates in shared command history and autosave.
- Every device exposes its musically relevant controls rather than only a preset picker. Applicable devices include wet/dry mix and output trim.
- Overdrive and saturation expose drive and tone/character controls and can move from subtle coloration to obvious destruction.
- Compression exposes threshold, ratio, attack, release, and makeup gain with gain-reduction metering.
- Delay supports synced and free timing, feedback, filtering, stereo behavior, and wet/dry control.
- Reverb supports decay/size, pre-delay, filtering, and wet/dry control.
- The alpha supports at least eight serial insert devices per track, master processing, and two stereo send/return buses suitable for shared delay and reverb.
- Device parameter changes are smoothed where necessary and do not rebuild unrelated audio nodes.
- Live playback, offline WAV render, and Ableton fallback stems use equivalent Solid Groove processing.

**FX-02 - Experimental sound design (P0)**  
Processing must support deliberate misuse and unusual combinations instead of constraining users to genre-safe results.

Acceptance criteria:

- Users can stack duplicate effects and place devices in unconventional orders.
- Resonance, drive, feedback, decay, pitch, and wet/dry ranges include clearly labelled extreme settings where the underlying device can remain stable.
- Presets provide starting points but never lock parameters or prevent cross-genre combinations.
- Validation prevents non-finite values, runaway resource use, and unsafe output levels; it does not silently normalize creative settings toward a conservative sound.
- The master safety limiter protects the output stage without rewriting stored device parameters or flattening the sound by default.

Third-party plugins, arbitrary feedback graphs, detailed modulation routing, and side-chain routing remain out of scope for the alpha.

### 7.4 Clips and musical editing

**CLP-01 - Reusable clips (P0)**  
Musical content lives in reusable clips placed on the arrangement timeline.

Acceptance criteria:

- A clip has a stable ID, owning track, name, color, musical length, and typed content.
- The user can create, select, move, resize by whole bars, duplicate, loop, and delete placements.
- Duplicating a placement can either reuse the source clip or create an independent variation; the UI states which operation will occur.
- Edits never rely on array indexes as persistent identity.

**CLP-02 - Step editor (P0)**  
Sampler and drum-machine clips have a grid editor for programming rhythmic events.

Acceptance criteria:

- The grid supports 16th-note resolution, 1-8 bar clip lengths, note on/off, and per-event velocity.
- Drum-machine mode shows one named lane per pad and allows hits to be painted across multiple lanes.
- Beat and bar divisions are visually distinct.
- The current playback step is visible.
- Pointer painting and erasing work without triggering accidental text selection.

**CLP-03 - Piano roll (P0)**  
Synth clips have a piano-roll editor for pitched notes.

Acceptance criteria:

- Notes have pitch, start, duration, and velocity.
- Notes can be created, moved, resized, selected as a group, duplicated, and deleted.
- The editor supports 16th-note snap and an optional in-key pitch guide.
- At minimum, undo groups a single drag gesture into one operation.

**CLP-04 - Musical transformations (P0)**  
The command layer supports transpose, velocity scaling, quantize, duplicate, clear, and deterministic rhythmic variation operations for selected events or clips.

These operations must be available to both the UI and the assistant.

### 7.5 Arrangement

**ARR-01 - Timeline arrangement (P0)**  
The arrangement displays tracks vertically and bars horizontally and supports tracks up to at least ten minutes from the private alpha onward.

Acceptance criteria:

- No P0 editor, playback, persistence, or export feature imposes a project-duration cap below `10:00` at any supported tempo. Longer arrangements may work but are not guaranteed in the alpha.
- The user can scroll, zoom, seek, select a bar range, and loop a selection.
- Clip placements snap to bars by default; finer movement may be deferred.
- Copy, cut, paste, duplicate, and delete work for selected placements.
- Playback always reflects the visible arrangement state.

**ARR-02 - Song sections (P0)**  
The user can add, rename, resize, reorder, and color section markers such as Intro, Build, Drop, Breakdown, and Outro.

Acceptance criteria:

- Section markers do not contain hidden audio; they label ranges on the same timeline.
- Reordering a section moves its contained clip placements as one undoable operation.
- Templates and the assistant can create section markers through the shared command API.

**ARR-03 - Loop-to-song actions (P0)**  
The user can select a loop range and create an arrangement outline from it.

Acceptance criteria:

- The manual flow offers at least one editable structure template.
- It duplicates placements into named sections without destructively modifying source clips.
- The result is immediately playable and can be undone atomically.

**ARR-04 - Focused automation (P0)**  
The user and assistant can vary track volume, pan, send level, and supported device parameters over the arrangement to create movement, transitions, and effects such as filter sweeps and delay throws.

Acceptance criteria:

- A track can show one automation lane at a time and switch the lane's target without deleting data.
- The user can add, move, and delete breakpoint values with stepped or linear interpolation.
- Automation is stored in musical time, moves with reordered sections, and can be copied with an arrangement range.
- One automation gesture is one undoable command transaction; assistant-created automation is previewed and undoable with the rest of its proposal.
- Live playback, seeking, looping, offline WAV render, and supported Ableton export reproduce the same automation without discontinuities at loop boundaries.
- The UI provides parameter-specific ranges and makes automated controls visually distinct while still allowing safe manual adjustment.

Recording knob movements, freehand curves, bezier editing, audio-rate modulation, and arbitrary modulation routing remain later work.

### 7.6 Sound library

Content is organized into **packs** (LIB-04). A pack is a named, versioned, independently deliverable collection of sounds and presets — "Techno Drums", "Orchestral Sounds" — and it is the unit a user browses, a project depends on, and the library is published in. Every asset belongs to exactly one pack, so the library has a pack-qualified namespace rather than a flat one. Read the requirements below with that in mind: packs organize and deliver content, while genre, role, and character tags cut across packs and remain the discovery mechanism.

**LIB-00 - Starter library of sounds for testing (P0)**  
A starting library of real, playable sounds exists early and is delivered from Cloud Storage, so that every feature built on top of the library — the browser, sampler, drum machine, audio loops, caching, export, and genre starters — is developed and tested against real audio and real metadata rather than against two prototype WAV files.

This requirement is deliberately about *availability*, not curation. It is satisfied by a library that is legally unambiguous, broad enough to exercise every code path, and reproducible in CI. `LIB-01` and `LIB-02` remain the standard the reviewed factory library has to meet, and this requirement does not lower either of them.

Acceptance criteria:

- A single documented command generates the starter library and its manifest, and a second publishes both to the project's Cloud Storage bucket. Neither requires a developer to hold production credentials on their own machine.
- Generation is deterministic: the same source produces byte-identical audio and a byte-identical manifest, so a rebuild that changes nothing produces no diff and re-uploads nothing.
- The library covers every one-shot role in the sample plan's taxonomy, spans the required genre set, and is large enough to build a complete loop in each — a minimum of 200 assets for the alpha.
- Every asset carries the full manifest record: stable prefixed ID, immutable content-addressed storage key and checksum, role, tags, audio metadata, waveform peaks, licence, and provenance. Validation fails CI when any of those is missing, as it does for the factory library.
- Every asset has approved raw-redistribution rights with archived evidence. Content whose rights are unresolved does not ship, and an unapproved content source is not a way to satisfy this requirement faster.
- Content may be generated or acquired. Acquired content comes only from sources whose licence permits redistributing the raw files, is selected file-by-file rather than by bulk import, is pinned to a checksum recorded at review time, and carries a captured copy of the licence statement as it stood when the file was taken. A checksum that no longer matches fails the ingest rather than being re-pinned automatically.
- The library ships as one or more packs with pack records, per-pack manifests, and pack-qualified asset identity (LIB-04), so the pack model is exercised by real content from the start rather than retrofitted once projects already reference a flat namespace.
- The manifest records that this is the testing library rather than approved factory content, so hardening and the content audit can tell the two apart and neither is mistaken for the other.
- Assets are served with the cross-origin and cache headers Web Audio decoding, range requests, and offline export require, and the bucket denies client writes.
- The starter library is superseded, not extended, by the reviewed factory library. Replacing it must not require changing how the app resolves, caches, or exports an asset.

The rights position, generation recipe, and intake state for the shipped starter library are recorded in [`docs/licenses/starter-library-v1.md`](./licenses/starter-library-v1.md).

**LIB-01 - Curated assets (P0)**  
The browser contains a licensed, quality-controlled library of one-shots, loops, and instrument presets.

Acceptance criteria:

- Assets have stable IDs, an owning pack, type, name, tags, source BPM where relevant, duration, and licensing provenance.
- The user can search, filter, and audition an asset in sync where appropriate.
- Search and filtering work both within one pack and across every available pack; a user is never forced to guess which pack holds a sound.
- Audition stops cleanly and does not become part of export.
- A missing or corrupt asset is isolated and reported rather than blocking the project.

**LIB-02 - Genre breadth without genre lock-in (P0)**  
The bundled library, presets, and example material support techno, house, drum and bass, hip hop, dubstep, lofi, ambient, trance, UK garage, breakbeat, and electronic pop, while remaining useful for other electronic and electronically produced popular music.

Acceptance criteria:

- The library includes usable drums, basses, leads, chords/pads, textures, effects, and processing presets across the required genre set.
- At least one audited demo project for each required genre can be created entirely with bundled instruments, devices, and licensed assets.
- Content metadata may describe genre, mood, tempo, character, and role, but no asset or device is technically restricted to a genre.
- A pack may be themed around a genre, but pack membership never restricts where an asset can be used: any asset from any available pack can be loaded onto any track, instrument, or pad.
- Genre starter projects expose normal editable tracks, clips, instruments, and devices; they do not use inaccessible rendered backing tracks.
- Users can combine content from different genres and remove genre filters without losing access to any asset.
- Content review rejects a library that covers genres only through superficial renaming of the same narrow sound set.

**LIB-03 - User sample imports and personal library (P1)**  
The user can bring their own audio into Solid Groove and reuse it across projects. This is a committed post-alpha requirement, not optional polish. Imported audio lives in a persistent per-user library alongside the curated content, and drag-and-drop is a first-class way to add to it.

Acceptance criteria:

- The user can import WAV, MP3, and other browser-decodable audio by dragging files from the operating system onto the browser or user-library area, and by an explicit file-picker fallback. Multi-file drops are supported.
- Dropping audio onto the arrangement or a track both adds it to the user library and places it, so a drop is never lost as an untracked one-off; the UI makes clear where the sample landed.
- Drag targets show a clear drop-affordance on drag-over, accept only supported types, and reject unsupported or oversized files with an actionable message rather than failing silently.
- Imported assets become first-class library entries: stable IDs, type, user-editable name and tags, detected duration, and — where derivable — sample rate and source BPM, and they are searchable, filterable, and auditionable exactly like curated assets (LIB-01).
- Imported audio lands in the user's own pack rather than in a parallel content model, so one browser, one resolver, and one audition path serve factory and user content alike. Whether a user can create more than one personal pack, and how those packs are named and organized, is settled when this ships.
- The user library persists across sessions and projects for the same account, is scoped to that user, and is not shared with other users or exposed through another user's project.
- Uploads show per-file progress and a clear success, failure, or cancel state. A failed or cancelled upload leaves no partial or unplayable asset in the library.
- File type and size are validated on the client and enforced server-side; stored audio uses Cloud Storage with safe content headers, and per-user storage limits are explicit and surfaced before the limit blocks an import.
- A user can rename and delete their own imported assets. Deleting an asset that is in use warns and does not silently break existing placements.
- Imported user audio is clearly distinguished from licensed curated content and is never redistributed through shared projects, read-only links, or exports beyond what the user's own export explicitly includes.

Anonymous (pre-account) import limits, whether imported audio can back a sampler or drum pad versus only audio-loop tracks at first, and any per-account storage tier are settled when this ships; the drag-and-drop-to-library interaction and persistent per-user library are the fixed requirements.

**LIB-04 - Curator tooling for CC0 acquisition (P1)**  
Selecting third-party CC0 content file-by-file is the human bottleneck between the approved sources (`LIB-00`) and a shipped organic library. A local curator tool makes that review fast without weakening it: it turns a hand-written list of candidate sample *pages* into a guided, one-at-a-time audition, and records only what a person confirmed.

This requirement governs the *tooling*, not the rights policy. It does not add a source, relax the licence allowlist, or introduce a way to bulk-import; those remain governed by `LIB-00` and the sample plan's section 3.

Acceptance criteria:

- A committed config lists candidate sample pages, each naming an approved source, the page URL, a seed role/tag mapping, and a licence-confidence tier. A candidate on a non-approved host or source is rejected before any page is fetched. The list may be generated from enumerable CC0 collections rather than hand-written, provided the generator fabricates no URL and its output is committed and reproducible.
- Each candidate carries a licence-confidence tier that is surfaced to the curator as a review-order hint, never a rights decision: a candidate can claim high confidence and still be rejected on the page, and the authoritative rights position remains the evidence captured at ingest. An unverified candidate is a lead to audition, not content that ships.
- A single documented command serves a local review UI that steps through the candidates one at a time: the source page in an embedded frame for listening, and a best-effort guess of the direct file URL and metadata in an editable form. Every guessed value is a suggestion the curator confirms or corrects; nothing is auto-accepted.
- The tool never discovers new URLs, follows catalogue or search links, or downloads audio for redistribution — it reads only the pages the config already names. There is no crawl mode and no search mode.
- Confirming a candidate ("Verify") writes a *draft* selection to the acquisition lockfile: the reviewed download URL, source page, creator, filename, reviewer, and role/tag mapping — but not a checksum. A real reviewer name is required; the draft is not shippable until the existing pin step downloads the file and records the checksum of exactly what arrived, and a person commits it.
- Re-verifying the same candidate updates its draft rather than duplicating it, and reopening the tool shows selections already committed to the lockfile rather than a blank form.
- The download-and-checksum, rights re-check, licence-evidence capture, and ingest stages are unchanged: a verified draft flows through the same pin → review → ingest path as a hand-written selection, and a checksum that does not match still fails rather than being re-pinned automatically.

**LIB-05 - Sound packs (P0)**  
Library content is organized into packs rather than a single flat namespace. A pack is a named, versioned, independently deliverable collection of one-shots, loops, instruments, and presets with one rights position and one publisher. Packs are what makes the library legible as it grows — a user working on a dubstep track picks a dubstep pack and starts, instead of searching an undifferentiated catalogue — and they are the unit that curation, delivery, caching, provenance, takedown, and any later distribution all act on.

This is a P0 structural requirement because the alternative is a migration. Asset identity, the manifest, the delivery layout, project references, and the browser all change shape when content acquires an owning pack; the alpha does that once, before there are projects and saved references to migrate.

Acceptance criteria:

- Every library asset belongs to exactly one pack. Asset identity is pack-qualified, so two packs may contain a sound of the same name or role without collision and neither is renamed to avoid the other.
- A pack has a stable ID, a display name, a version, a publisher, a description, a kind (`factory`, `user`, or `third-party`), and one rights position covering every asset it contains. A pack's version is immutable content: republishing changed audio or changed metadata produces a new pack version.
- The browser presents packs as a first-class way in — a user can browse a pack's contents as a coherent set — while search, genre, role, and character filters continue to work across every available pack. Removing a pack filter never hides an asset the user could otherwise reach.
- A project records the packs and pack versions it depends on, so reopening, exporting, and collaborating resolve the same audio the project was built with. A later pack version cannot silently change an existing project.
- A pack that is unavailable, withdrawn, or not yet loaded is reported as a missing pack with the affected tracks and clips named. Unrelated playback, editing, and export continue, matching the isolation LIB-01 requires of a single missing asset.
- Genre starters, demo projects, and assistant asset choices state which packs they draw from and use only packs the user actually has.
- Pack membership is organizational, never a capability boundary: no device, instrument, or feature is restricted to content from a particular pack, and content from different packs mixes freely in one project (LIB-02).
- The starter library, the reviewed factory library, and later user content are all delivered as packs through one resolver, one cache, and one export path. Adding a pack is content work, not application work.

The alpha ships a set of factory packs and nothing else: every pack is bundled, free, and present for every user. Installation, entitlement, purchase, and per-user pack visibility are LIB-05 concerns and are not modelled in the alpha beyond the project's record of which packs it depends on.

**LIB-06 - Pack marketplace (P2)**  
Packs become a two-sided marketplace: creators build and publish their own packs, users browse and acquire packs from other creators, and premium packs can be sold. This is the commercial opportunity the pack model opens, and it is deliberately the last thing built — it depends on a proven creation workflow, a persistent per-user library (LIB-03), a rights and payout model, and moderation, none of which the alpha has.

Acceptance criteria are defined when this is scheduled. At minimum it will require: pack authoring and publishing tools, entitlement and per-user pack visibility, a rights and revenue-sharing agreement with pack creators, content moderation and takedown that does not break projects already using an acquired pack, and payment handling. The product-owner decisions in section 16 gate the work; no part of it is implied by the alpha's pack model beyond keeping that model honest — a pack is versioned, self-describing, rights-carrying, and independently deliverable precisely so a marketplace can later be built on it without a second content system.

### 7.7 AI producer

**AI-01 - Project-aware conversation (P0)**  
The assistant can reason about a compact, current representation of the project and the user's selection.

Acceptance criteria:

- Context includes tempo, structure, tracks, instruments, clips, note summaries, mixer state, current selection, and recent assistant actions.
- The UI clearly shows whether a request applies to a clip, track, section, or full song.
- The assistant says when it lacks required context rather than inventing project state.
- Conversation remains usable while the track plays.

**AI-02 - Suggested next steps (P0)**  
When appropriate, the assistant offers a small number of relevant actions such as `Create an arrangement`, `Add variation`, `Build a transition`, or `Balance this section`.

Suggestions must derive from project state and must not block free-form conversation.

**AI-03 - Structured action proposals (P0)**  
The assistant changes a project only by returning validated commands from an allowlisted command schema.

Acceptance criteria:

- A proposal describes the musical intent and summarizes affected tracks, clips, sections, and parameters before application.
- The user can apply or cancel the proposal; cancellation changes nothing.
- Invalid IDs, values, command combinations, or stale revisions are rejected before mutation.
- A proposal is applied atomically and creates one undo history entry.
- Assistant commands use the same domain operations and validation as manual UI actions.

**AI-04 - Inspectable results (P0)**  
After an action, the assistant states what changed and why in concise production language.

Acceptance criteria:

- Changed entities are selected or highlighted in the editor.
- The explanation can refer to audible goals, such as increasing contrast or leaving space, without presenting taste as fact.
- The user can undo from the assistant card or the global history control.
- The user can ask a follow-up about any changed control or note.

**AI-05 - Alpha capability set (P0)**  
The assistant can use project commands to:

- Create and rename tracks, clips, placements, and sections.
- Sketch new drum, bass, chord, melody, and texture loops from a prompt or the current musical context using editable events and bundled sound sources.
- Add, remove, move, resize, and transform note events.
- Duplicate a clip as an independent variation.
- Build a section-based arrangement from selected source material.
- Create, reorder, bypass, and edit supported processing devices as well as change tempo, instrument presets, sample choice, volume, pan, mute, and solo.
- Create and edit focused automation for mixer, send, and supported device parameters.
- Suggest both conventional and deliberately experimental processing approaches when requested, without forcing genre conventions onto the project.
- Analyze project structure and summarize likely repetition, density, register, or balance issues using deterministic project data where possible.
- Explain the technique it applied and suggest a focused manual adjustment.

The assistant does not upload or generate audio in the alpha.

**AI-06 - Safe and resilient operation (P0)**  
AI failure must never corrupt or block manual editing.

Acceptance criteria:

- Provider credentials and privileged calls remain server-side.
- Requests have timeout, cancellation, rate-limit, and retry behavior.
- A failed or malformed response makes no project change and presents a recoverable error.
- The request includes a project revision; stale proposals require regeneration or explicit rebase.
- Project context sent to a provider is minimized and excludes unnecessary account data.

**AI-07 - Preview playback (P1)**  
The user can audition an assistant proposal before committing it. If safe non-destructive preview cannot be implemented, clear diff plus apply/undo remains the P0 behavior.

**AI-08 - Tutorial video recommendations (P2)**  
When a technique is better shown than described, the assistant can surface a relevant tutorial video from a trusted, curated set of creators inline in the conversation, playable without leaving the project. This is a later-vision capability shown in the design mocks (`07-assistant-video*`); it is not part of the private alpha, whose learning experience is text explanations (LRN-01) plus optional workflow cues (LRN-02).

Acceptance criteria:

- Recommendations are drawn from an allowlisted, curated set of trusted creators, not from open web search. The curation and trust model, including how a creator or video enters the set, is defined before this ships.
- A recommendation shows title, creator, and duration, plays inline in the conversation, can expand to fullscreen, and can open on the source platform. It never autoplays and never interrupts audio playback or an active edit.
- The assistant states plainly that a video is a suggestion, not an endorsement, and video recommendations never gate or block free-form conversation or manual editing.
- Video is embedded through the provider's supported embed surface; no third-party player code is given access to project state, and the assistant continues to change the project only through the AI-03 command layer.
- Optional follow-ups such as summarizing a video or translating its technique into a concrete, previewable proposal reuse the existing assistant command and explanation layers rather than a parallel path.
- Failure to load or play a video is isolated and reported; it cannot corrupt or block the project, playback, or the rest of the conversation.
- The privacy and third-party-embed implications of loading external video are surfaced to the user, consistent with the Section 10 security and privacy requirements.

### 7.8 Learning experience

**LRN-01 - Contextual explanations (P0)**  
Explanations connect an audible goal, a named technique, and the actual controls or events changed.

Example: "I removed the kick for the first half of the breakdown to create contrast. The full pattern returns at bar 49, making the drop feel larger."

Acceptance criteria:

- Explanations default to two or three sentences and can be expanded.
- Production terms are used accurately; short definitions appear on demand rather than replacing standard terminology.
- Relevant controls can be focused or highlighted from an explanation.
- The assistant never forces a lesson before the user can continue creating.

**LRN-02 - Transferable workflow cues (P1)**  
The interface can show optional, dismissible tips for concepts the user is actively using, such as clip versus placement, gain staging, or arrangement contrast.

**LRN-03 - Video-assisted learning (P2)**  
Some techniques are learned fastest by watching. The later-vision assistant can pair its text explanation with a curated tutorial video (see AI-08). This extends, and never replaces, the contextual text explanations that carry the learning experience through the alpha.

### 7.9 Sharing and collaboration

**SHR-01 - Shareable render (P0)**  
The stereo WAV is the alpha's primary listening artifact, while multitrack WAV stems are its first DAW-neutral production handoff.

**SHR-02 - Ableton Live project export (P1)**  
The user can export a self-contained Ableton Live Set so they can continue producing with professional tools rather than starting again from rendered stereo audio.

Acceptance criteria:

- The export targets the oldest Ableton Live version that can correctly represent the supported handoff. The minimum compatible version is documented, newer-only Live features are avoided unless required for correctness, and the package includes the Live Set plus all required audio assets.
- Project tempo, track order and names, section markers, clip placement, loop boundaries, MIDI note pitch/timing/duration/velocity, supported automation, volume, and pan are preserved where Ableton has an equivalent concept.
- Audio loops and samples are copied into the export package with portable relative references; opening the package on another computer does not depend on Solid Groove URLs or local storage.
- Solid Groove instruments and effects without a faithful Ableton equivalent are rendered as bar-aligned audio stems. Editable MIDI is also included where it remains useful.
- Before export, the UI summarizes which elements remain editable, which will be rendered to audio, and which unsupported settings will be omitted.
- Exported reference projects open without missing-file errors in the minimum compatible Ableton Live version and remain aligned to the same bars for the full arrangement. Compatibility with newer supported Live versions is covered by the export test matrix.
- The package includes a human-readable compatibility report and does not redistribute source assets whose licences prohibit export.
- Native Live Set generation and the fallback stems/MIDI manifest share fixture-based tests; an exporter failure cannot modify the Solid Groove project.

Importing later Ableton changes back into Solid Groove and preserving arbitrary Ableton devices, routing, or automation are not required.

**SHR-03 - Read-only project link (P1)**  
An owner can create and revoke a link that lets another person play the current published revision without editing it.

**SHR-04 - Asynchronous collaboration (P1)**  
An owner can invite another registered user to edit a project. The product records author and timestamp for named revisions.

**SHR-05 - Real-time collaboration (P2)**  
Presence, cursors, conflict-free simultaneous edits, and live shared transport are later work and require a separate technical design.

### 7.10 Deployment, analytics, and monitoring

This section covers how Solid Groove reaches a real browser and how the team learns what happens there. Both start in Phase 0: a feature that has only ever run against a local dev server and an emulator is not known to work, and a feature that ships without its events cannot answer the section 11 success measures.

**OPS-01 - Deployed environment from Phase 0 (P0)**  
Solid Groove is deployed to Firebase Hosting from the first foundation milestone, so every later slice can be exercised in a real browser against real Firebase Authentication, Firestore, Storage, and Functions rather than only against a local dev server and the emulator suite.

The alpha has exactly one hosted environment: the **production** Firebase project. This is a deliberate decision for a private alpha whose only users are the team and an invited cohort, not an oversight. It is revisited before public launch, and before there is real user data that a bad deploy could destroy.

Acceptance criteria:

- The application builds and deploys to Firebase Hosting through one documented command and automatically from CI on merge to the default branch. Deployment does not depend on a developer's local machine state.
- Firestore security rules and indexes deploy from the same repository and the same pipeline as the application. A deploy whose rules or index step fails, fails the whole pipeline rather than leaving shipped code and deployed rules out of step.
- The deployed revision is identifiable: the build stamps the git commit SHA into the client, the app can display it, and every analytics and error event carries it (see OPS-02 and OPS-03).
- Rollback is a documented, practiced operation, not an improvisation. Because production is the only hosted environment, the team can restore the previous Hosting release and the matching rules revision without rebuilding from scratch.
- Deploying is not releasing. The deployed alpha is discoverable only to people given the URL and an account, and incomplete journeys stay behind the section 13 feature flags. Nothing in this requirement permits shipping a half-built journey to real users.
- Secrets, provider credentials, and privileged configuration never enter the client bundle. Hosting configuration, security rules, indexes, and function configuration are checked in and reviewable.
- Local development and every automated suite continue to run against the Firebase Emulator suite. Running the tests must not require access to the production project, and the test suites must not write to it.
- Traffic from the team is distinguishable from cohort traffic, so internal sessions can be excluded from the section 11 measures.
- A deployed build is smoke-tested against the hosted environment — the app loads, an anonymous session starts, a project opens, and audio starts after a user gesture — and a failed smoke test is treated as a failed deploy.

**OPS-02 - Product analytics events (P0)**  
Solid Groove logs a defined set of user actions to Google Analytics for Firebase so the team can answer two questions the alpha exists to answer: *when do people actually use the app*, and *which features do they reach for first*. Instrumentation is part of building a feature, not a later archaeology project (see the section 14 definition of done).

Events are declared once in a shared typed analytics catalog — the same single-source-of-truth pattern as the KEY-01 shortcut registry. UI, audio, persistence, and assistant code log through that catalog; no component calls the analytics SDK with an ad-hoc event name or parameter string.

Sessions, first opens, page views, and engagement time come from Google Analytics automatic collection and are not re-implemented as custom events.

*Event rules*

- Names are `snake_case`, at most 40 characters, and avoid Google Analytics reserved names and the `firebase_`, `google_`, and `ga_` prefixes.
- Parameter values are enumerated keys, stable Solid Groove IDs, booleans, or bucketed numbers — never free text, and never a value the user typed.
- **No project content, ever.** Project, track, clip, section, and asset *names*; note and automation data; assistant prompts and replies; user-entered search terms; file names; asset URLs; email addresses; and authentication tokens are never event parameters. Where an entity must be identified, the prefixed ID (section 9.4) is logged, not its name.
- Counts and durations are bucketed rather than exact, so a rare exact combination cannot re-identify a session.
- No event fires per note, per animation frame, or per parameter tick. Continuous gestures collapse into one event on gesture completion, and high-frequency signals are debounced, aggregated per session, or sampled with the sampling rate recorded.
- Analytics fails open. A blocked, failed, or unavailable analytics endpoint — including a browser extension blocking it — never breaks playback, editing, saving, or export, and never surfaces an error to the user.
- Every event carries the release SHA (OPS-01) and the surface it came from. User properties are limited to coarse, non-identifying facts: account type (anonymous or registered) and whether the session is internal.
- The user is told what is collected and can decline product analytics without losing any DAW or assistant capability. Reliability events required to keep the release gates honest (OPS-03) are described in the same disclosure.

*Event catalog*

The `Owning task` column names the backlog task that must ship the event with the feature it measures. An event has no separate "instrumentation task" later.

| Event | Fires when | Key parameters | Phase / owning task |
| --- | --- | --- | --- |
| `app_opened` | The editor or dashboard shell becomes interactive | `surface`, `account_type`, `release_sha` | 0 / `FND-001c` |
| `landing_cta_click` | A visitor activates a landing-page call to action | `cta_id` (`start_free`, `log_in`) | 1 / `LOOP-001b` |
| `anon_session_created` | An anonymous Firebase identity is created for a new visitor | — | 1 / `LOOP-001` |
| `account_upgraded` | An anonymous account becomes a registered account | `method` | 1 / `LOOP-001` |
| `project_created` | A project is created | `source` (`blank`, `template`, `duplicate`), `template_id`, `genre` | 1 / `LOOP-001`, `LOOP-015` |
| `project_opened` | A project is opened in the editor | `project_age_bucket`, `track_count_bucket`, `is_first_open` | 1 / `LOOP-001` |
| `project_deleted` | A project is deleted after confirmation | `project_age_bucket` | 1 / `LOOP-001` |
| `first_edit` | The first user-authored mutation in a project, once per project | `command_id`, `seconds_since_open_bucket` | 0 / `FND-009` |
| `feature_first_use` | An account uses a tracked feature for the first time | `feature` (see below) | 0 / `FND-001c`, then each owning feature task |
| `transport_play` | Playback starts from a user gesture | `surface`, `is_first_play_in_session` | 1 / `LOOP-003` |
| `track_added` | A track is added | `track_type` | 1 / `LOOP-007` |
| `instrument_changed` | A track's instrument or its sample selection changes | `instrument_type` | 1 / `LOOP-004`, `LOOP-005` |
| `device_added` | A processing device is added to an insert chain, return, or master | `device_type`, `chain` | 1 / `LOOP-008`, `LOOP-009` |
| `library_audition` | A library asset is auditioned | `asset_type`, `had_genre_filter` | 1 / `LOOP-013` |
| `clip_edited` | A step-editor or piano-roll editing gesture completes | `editor` (`step`, `piano_roll`), `event_count_bucket` | 1 / `LOOP-010`, `LOOP-011` |
| `shortcut_used` | A registered keyboard shortcut fires | `action_id` | 1 / `LOOP-014` |
| `undo_used` | Undo or redo is invoked | `direction`, `actor` (`user`, `assistant`) | 1 / `LOOP-002` |
| `section_created` | A song section marker is created | `origin` (`manual`, `template`, `assistant`) | 2 / `ARR-003` |
| `arrangement_outline_created` | A loop-to-song outline is applied | `template_id`, `section_count` | 2 / `ARR-003` |
| `automation_lane_created` | An automation lane gets its first breakpoint | `target_kind` | 2 / `ARR-004` |
| `arrangement_milestone` | A project first reaches ≥3 named sections and ≥2 minutes | `section_count`, `duration_bucket` | 2 / `ARR-003` |
| `export_started` | An export begins | `export_type` (`stereo`, `stems`), `duration_bucket`, `track_count_bucket` | 2 / `EXP-002`, `EXP-003` |
| `export_completed` | An export finishes and the file or package is delivered | `export_type`, `elapsed_ms_bucket` | 2 / `EXP-002`, `EXP-003` |
| `export_failed` | An export fails or is cancelled | `export_type`, `error_code`, `was_cancelled` | 2 / `EXP-002`, `EXP-003` |
| `assistant_message_sent` | The user sends a message to the assistant | `scope` (`clip`, `track`, `section`, `song`) | 3 / `AI-004` |
| `assistant_suggestion_clicked` | A suggested next step is activated | `suggestion_id` | 3 / `AI-004` |
| `assistant_proposal_shown` | A validated proposal is presented to the user | `capability`, `command_count_bucket` | 3 / `AI-003` |
| `assistant_proposal_applied` | A proposal is applied | `capability`, `seconds_to_decision_bucket` | 3 / `AI-003` |
| `assistant_proposal_cancelled` | A proposal is cancelled without applying | `capability` | 3 / `AI-003` |
| `assistant_proposal_undone` | An applied proposal is undone | `capability`, `seconds_to_undo_bucket` | 3 / `AI-003` |
| `assistant_result_edited` | The user manually edits an entity an applied proposal changed | `capability` | 3 / `AI-004` |
| `save_failed` | A persistence write fails | `error_code`, `retry_count` | 0 / `FND-001c`, `LOOP-002` |
| `save_recovered` | A previously failed save succeeds on retry | `retry_count` | 1 / `LOOP-002` |
| `audio_start_failed` | Playback cannot start after a user gesture | `error_code`, `was_browser_blocked` | 0 / `FND-001c`, `LOOP-003` |
| `audio_underrun` | The engine detects skipped or late scheduled events (sampled) | `dropped_event_bucket`, `sample_rate` | 1 / `LOOP-003` |
| `asset_load_failed` | A library or user asset fails to load or decode | `asset_type`, `error_code` | 1 / `LOOP-013` |
| `exception` | An uncaught error reaches a boundary or global handler (OPS-03) | `fatal`, `area`, `error_code` | 0 / `FND-001c` |

`feature_first_use` carries a single low-cardinality `feature` key rather than a separate event name per feature, so the catalog stays well inside the Google Analytics distinct-event-name limit and first-use across features is comparable in one report. The alpha keys are: `step_editor`, `piano_roll`, `drum_machine`, `synth`, `sampler`, `audio_loop`, `device_chain`, `send_return`, `mixer`, `library_browser`, `shortcut_guide`, `sections`, `automation`, `assistant`, `export_stereo`, `export_stems`. A feature task adds its key with the feature.

Acceptance criteria:

- A shared typed analytics catalog declares every event name, its parameters, their allowed values or buckets, and the phase that introduces it. Logging an unregistered event or parameter is a type error, and the catalog is the only place event strings appear.
- Every event in the table above is emitted by the task named in its `Owning task` column, at the moment described in `Fires when`, and is verifiable in the production project's Google Analytics debug view from a deployed build.
- Automated tests assert, for each instrumented user action, that the expected event and parameters are logged exactly once, that repeated gestures do not multiply events, and that once-per-project or once-per-account events fire once.
- A test asserts that no event parameter carries a project, track, clip, section, or asset name; assistant text; a user-entered string; a URL; or an authentication token. This test is part of the analytics catalog's own suite so it covers events added later.
- Disabling or blocking analytics leaves every product behavior unchanged, proven by a test that runs the core journey with the analytics transport failing.
- The section 11 success measures are each derivable from the catalog, and a check confirms no measure depends on an event that is not in it.

**OPS-03 - Error and crash monitoring (P0)**  
Crash-free sessions, save success, and successful audio start are release gates in section 11. They are only gates if they are observable, so the alpha reports uncaught errors and the specific failures those gates depend on.

Firebase Crashlytics does not support the Firebase Web SDK, so "crash reporting" here means browser error reporting, not Crashlytics. The alpha uses **Sentry**, through the official SolidStart SDK, as its error and crash monitoring platform. This is a committed decision recorded in [ADR 0001](./adr/0001-sentry-for-error-monitoring.md); replacing it requires a superseding ADR under the section 9.1 rules.

The application's own reporting boundary — global `error` and `unhandledrejection` handlers plus the section 10 error boundaries — remains the single place errors are captured. Sentry is the transport and backend behind that boundary, not a substitute for it, so application code never calls the Sentry SDK directly and the platform stays replaceable. Google Analytics keeps the `exception` counter event from OPS-02 so the section 11 measures compute from one catalog; Sentry is where an engineer debugs a specific error, not where the product dashboard is assembled.

Acceptance criteria:

- An uncaught error in any surface — editor, assistant, audio engine, renderer, export, or persistence — is reported once with the release SHA, browser and engine version, the area it came from, a stable error code, and a redacted message. Duplicate reports from one error are collapsed.
- Reports carry no project content, assistant text, user-entered strings, asset URLs, or tokens, consistent with OPS-02 and the section 10 logging rules. Because a third-party SDK collects more by default than a hand-built reporter does, this is enforced positively rather than assumed: `sendDefaultPii` is off, console breadcrumbs are disabled rather than filtered, network and DOM breadcrumbs are scrubbed before transmission, and the OPS-02 parameter-content test extends to the Sentry payload by exercising the scrubbing functions directly, so it also covers breadcrumbs and events added later.
- Session Replay is not enabled. It would capture the arrangement, clip names, and assistant conversation on screen; turning it on requires a superseding ADR.
- Fatal and non-fatal errors are distinguishable, and crash-free session rate is reported by the platform's release-health session tracking rather than derived by hand.
- Production stack traces are readable: source maps are produced for the deployed revision, uploaded to the monitoring platform through an authenticated channel, and never served publicly from Hosting.
- The reliability gates have dedicated events, not just generic exceptions: `save_failed` / `save_recovered`, `audio_start_failed`, `audio_underrun`, `asset_load_failed`, and `export_failed` each carry an actionable error code.
- Error reporting is best-effort and non-blocking. A failing, blocked, or ad-blocker-suppressed reporter cannot stop the transport, block editing, lose unsaved state, or recurse into another report. Reports are not tunnelled through a first-party endpoint in the alpha; the resulting undercount is documented rather than engineered around.
- Monitoring does not compromise the section 10 performance budgets: the SDK initializes lazily after first paint with a minimal integration set and is not loaded on the marketing landing page.
- Monitoring is verified end to end from a deployed build: a deliberately triggered test error arrives with its release SHA and a symbolicated stack trace, and the check runs as part of accepting `FND-001c`.
- Firebase Performance Monitoring may be enabled for page-load and network traces (P1). Neither it nor the monitoring platform's own tracing substitutes for the section 9.3 lab measurements of arrangement frame budgets.

## 8. Interaction requirements

### Progressive disclosure

- A track row always exposes name, mute, solo, volume, pan, and its clip placements.
- Selecting a clip opens its note editor; selecting a track opens its instrument and mixer controls.
- Advanced parameters are grouped under expandable device panels rather than mixed into the arrangement.
- The assistant may navigate to a control but cannot hide manual access to it.

### Legible controls

One of the steepest parts of learning electronic music production is discovering what each instrument and effect control does and how it changes the sound. The assistant helps, but the controls themselves should carry as much of that teaching as possible. These rules apply to instrument, device, and mixer controls throughout the editor.

- **No acronyms or jargon shorthand.** Every control has a clear label using either a well-known full term (for example, `Lowpass`, not `LP`; `Resonance`, not `Q`; `Attack`, not `A`) or plain lay language. Abbreviations are only acceptable when they are the term users actually learn (for example, `BPM`), and the full meaning is available on hover or in an on-demand definition.
- **Consistent control shape and layout.** Controls of the same kind share size, styling, and layout across every instrument and device. Continuous parameters use vertical sliders with the label above and the current value shown below, so a user can read any control the same way once they have learned one.
- **Labelled option groups with icons.** A choice among discrete options (for example, an oscillator waveform or a filter type) is presented as a group of clearly labelled options rather than a bare dropdown, and each option carries a recognisable icon where one exists — such as sine, square, sawtooth, and triangle waveform glyphs on the synth wave selector.
- **Show the effect on the sound.** Where a control shapes the sound in a way that can be drawn, the UI shows that shape and updates it live as the control changes — for example, an envelope's attack/decay/sustain/release curve, a filter's frequency-response curve, or a waveform preview. The visual is a supporting cue, never the only way to read or set the value.

Acceptance criteria:

- No control label in the shipped editor uses an undefined acronym or internal shorthand; a review checklist confirms each instrument and device against this rule.
- Continuous controls of the same type are visually consistent (vertical slider, label above, value below) across the synth, sampler, drum machine, and all core devices.
- Option-group controls render as labelled, icon-bearing choices; the current selection is indicated with a non-color cue in addition to color.
- Controls with a drawable effect (at minimum amplitude envelopes and resonant filters) display a live visualization that tracks parameter changes, and remain fully operable with the visualization hidden or unsupported.
- Value readouts use human-readable units (for example, `Hz`, `dB`, `ms`, or musical divisions) consistent with the keyboard and mixer requirements.

### Undo and redo

- Every project mutation, whether manual or AI-generated, is represented as a domain command.
- Continuous gestures such as dragging a fader or note create one history entry per gesture.
- Multi-command operations such as arranging a song apply and undo atomically.
- Undo history is scoped to the open editing session in P0; durable history is supplied by named revisions in P1.
- Saving and undo are independent: autosave persists the current state after undo or redo.

### Keyboard and accessibility

**KEY-01 - Ableton-familiar keyboard workflow (P0)**  
The most important creation and editing actions have keyboard shortcuts. Solid Groove follows Ableton Live conventions when the same concept exists and the browser/operating system does not reserve the combination, reducing switching costs without assigning familiar keys to misleadingly different actions.

Initial mapping:

| Action | macOS | Windows/Linux | Context |
| --- | --- | --- | --- |
| Play/stop | `Space` | `Space` | Editor, outside text entry |
| Continue from stop position | `Shift+Space` | `Shift+Space` | Editor, outside text entry |
| Undo | `Cmd+Z` | `Ctrl+Z` | Global |
| Redo | `Cmd+Shift+Z` | `Ctrl+Y` | Global |
| Cut/copy/paste/select all | Platform standard | Platform standard | Current selection scope |
| Delete selection | `Delete` / `Backspace` | `Delete` / `Backspace` | Arrangement or detail editor |
| Duplicate selection | `Cmd+D` | `Ctrl+D` | Tracks, clips, placements, notes, sections, automation points, or devices |
| Split clip at selection/playhead | `E` | `E` | Arrangement; browser-safe deviation from Live's `Cmd/Ctrl+E` |
| Quantize selected notes | `Q` | `Q` | Step editor or piano roll; browser-safe deviation from Live's `Cmd/Ctrl+U` |
| Toggle arrangement loop | `L` | `L` | Arrangement selection; browser-safe deviation from Live's `Cmd/Ctrl+L` |
| Toggle draw mode | `B` | `B` | Step editor, piano roll, or automation lane |
| Toggle automation view | `A` | `A` | Arrangement |
| Zoom to selection / zoom back | `Z` / `X` | `Z` / `X` | Arrangement or detail editor |
| Zoom in / out | `+` / `-` | `+` / `-` | Focused timeline/editor |
| Toggle metronome | `O` | `O` | Editor, outside text entry |
| Close/cancel current surface | `Escape` | `Escape` | Dialog, popover, selection, or active gesture |
| Open keyboard mapping guide | `?` | `?` | Editor, outside text entry |

The Ableton-derived mappings and documented deviations above use the [Ableton Live 12 keyboard shortcut reference](https://www.ableton.com/en/manual/live-keyboard-shortcuts/) as their baseline. Solid Groove must not intercept browser- or OS-reserved shortcuts merely for parity.

Acceptance criteria:

- A single typed shortcut registry is the source of truth for event handling, tooltips, command-menu labels, and the mapping guide; shortcut strings are not independently duplicated across components.
- Each entry declares action ID, platform keys, valid context, enabled state, and whether it intentionally follows or differs from Ableton.
- Shortcuts dispatch the same validated commands as pointer-driven UI and therefore participate identically in undo, autosave, and assistant-visible project state.
- Focused inputs, textareas, content-editable elements, dialogs, and menus receive normal typing behavior. Single-letter and `Space` shortcuts do not leak through them.
- Context resolution is deterministic. A shortcut acts on the focused editor or current selection and never silently targets hidden content.
- Shortcut-enabled actions expose the mapping in their tooltip and applicable menus.
- Platform labels use `Cmd`/`Option` on macOS and `Ctrl`/`Alt` on Windows/Linux.
- Browser conflicts and Solid Groove deviations from Ableton are documented rather than handled inconsistently.
- Character shortcuts such as `?` are matched by the character produced for the user's keyboard layout rather than assuming a physical US-layout key code.

**KEY-02 - Keyboard mapping guide (P0)**  
Pressing `?` opens an in-app keyboard mapping guide without leaving the project.

Acceptance criteria:

- The guide is generated from the shortcut registry and always reflects the current platform, enabled features, and active mapping version.
- Shortcuts are grouped by Transport, Global Editing, Arrangement, Clips/Notes, Automation, Mixer/Devices, Browser, and Navigation.
- The guide can be searched by action name or key combination and can filter to shortcuts valid in the current context.
- Each mapping can show its Ableton equivalent or explain why Solid Groove differs.
- `?` opens the guide outside text entry. `Escape` closes it from anywhere, restores focus to the prior editor element, and does not change playback or selection.
- The guide is fully keyboard navigable, traps focus while modal, has an accessible title and instructions, and remains usable at 200% browser zoom.
- P0 mappings are read-only. User-remappable shortcuts are P1, but the registry and persistence design must not preclude them.

- Interactive controls have accessible names, visible focus, and non-color state indicators.
- The editor meets WCAG 2.2 AA for non-audio UI where practical; music itself is not treated as the only signal for an application state.
- Reduced-motion preferences disable non-essential animation.

### Responsive behavior

- The production editor targets a minimum viewport of 1024 x 700 and is optimized for 1280 px or wider.
- Narrow screens receive a clear unsupported-editor message plus access to project listing and playback when feasible.
- Browser zoom at 200% must not make essential transport or save controls unreachable.

## 9. Technical architecture

### 9.1 Committed alpha stack

These are hard decisions for the alpha, not provisional preferences. An implementation agent must not replace one with an alternative without a written architecture decision record (ADR) approved by the product owner.

Approved ADRs live in [`docs/adr`](./adr), numbered and named after the decision they record. An ADR states the context, the decision, its consequences including what it costs, and the alternatives rejected. A decision that changes a row in the table below updates that row to point at its ADR; the ADR is the reasoning, and this table stays the index.

| Area | Alpha decision | Commitment |
| --- | --- | --- |
| Product surface | Desktop web application | No Electron/native wrapper or mobile-editor parity in the alpha |
| Application framework | SolidStart, SolidJS, and TypeScript | Solid owns application UI and reactivity; no second component framework |
| Audio | Web Audio API orchestrated through Tone.js | Tone/Web Audio owns live scheduling, instruments, processing, metering, and offline render behind the engine boundary |
| Authentication | Firebase Authentication | Anonymous sessions and account upgrades remain Firebase identities |
| Structured persistence | Cloud Firestore | Project metadata, versioned domain state, revisions, save acknowledgements, and permissions use Firestore |
| Binary storage | Cloud Storage for Firebase | User audio, derived waveform data where persisted, and server-retained export artifacts use Storage rather than Firestore documents |
| Privileged backend | Cloud Functions for Firebase | AI-provider calls, privileged validation, quotas, and future background work execute server-side; provider code never ships to the client |
| Hosting and deployment | Firebase Hosting, deployed from CI | One hosted environment for the alpha — the production project — with rules and indexes deployed from the same pipeline (OPS-01) |
| Product analytics | Google Analytics for Firebase | User-action events come from one typed catalog (OPS-02); no second analytics vendor and no ad-hoc event strings |
| Error monitoring | Sentry, behind the application's own reporting boundary | Crashlytics does not support the Firebase Web SDK, and Cloud Error Reporting cannot symbolicate browser traces without publicly served source maps; see [ADR 0001](./adr/0001-sentry-for-error-monitoring.md) |
| Arrangement rendering | Hybrid DOM plus Canvas 2D | DOM provides application structure and semantics; viewport-sized canvases render dense timeline graphics |
| Test foundation | Vitest plus browser end-to-end and audio fixture tests | Performance and compatibility require real-browser tests in addition to unit tests |

Firestore documents must remain below platform limits. The persistence design separates project metadata from versioned musical entities or chunks rather than allowing one indefinitely growing `latestSnapshot` document. Cloud Storage holds binary audio; asset URLs are references, not identity.

WebGL, WebGPU, C++/WebAssembly, a native shell, and a second backend are not alpha technologies. They may be reconsidered only after measured evidence shows that the committed architecture cannot meet an acceptance target.

### 9.2 System boundaries

```text
Solid UI and input
        |
        v
Selection model -> validated command/transaction layer -> normalized project state
                                                         |       |       |
                                                         v       v       v
                                                arrangement   audio   autosave
                                                 projection   engine   repository
                                                         |       |       |
                                                         v       v       v
                                                DOM/Canvas  Tone.js  Firebase
                                                         |
                                                         v
                                                assistant context
                                                         |
                                                         v
                                                Cloud Function -> AI provider
```

- Solid components render UI state, dispatch commands, and subscribe to selectors. They do not own audio nodes, mutate persistence objects, or draw one component per timeline object.
- The normalized domain state and command layer are the source of truth shared by manual UI, keyboard shortcuts, the assistant, undo/redo, audio projections, and persistence.
- The audio engine and arrangement renderer consume separate read-only projections. A visual redraw cannot rebuild the audio graph, and an audio callback cannot mutate UI state directly.
- Firebase adapters sit behind repository, asset-store, authentication, and server-API interfaces so tests do not require production services.
- Main-thread responsibilities are input, Solid UI, layout coordination, hit testing, and the final visible Canvas 2D draw. Web Workers may compute waveform peaks, build zoom-level caches, or package exports.
- `OffscreenCanvas` and `ImageBitmap` may accelerate worker-side cache generation when feature detection and profiling justify them, but correctness and supported-browser performance cannot depend on a partially supported API path.

### 9.3 Arrangement renderer decision

The alpha arrangement uses a hybrid renderer: DOM for the shell and semantic controls, Canvas 2D for dense timeline content. It does not use a DOM or SVG element for every clip, note preview, waveform segment, grid line, or automation segment.

#### Technology comparison

| Approach | Alpha use | Rationale |
| --- | --- | --- |
| DOM | Shell, transport, track headers, controls, dialogs, inline editors, focus proxies, and accessibility | Best semantics and interaction model, but thousands of independently styled timeline nodes would create unnecessary layout, paint, and reconciliation work |
| SVG | Icons and isolated small diagrams only | Retained vector nodes are convenient but provide little benefit for a regularly redrawn, clipped timeline containing dense paths and waveforms |
| Canvas 2D | Primary arrangement timeline renderer | Broad browser support, low per-object overhead, direct drawing control, and sufficient throughput when the renderer draws only the viewport |
| WebGL/WebGPU | Not used in alpha | Adds shaders, GPU resource lifecycle, text rendering, context/device-loss fallback, and browser/driver variation before the bounded timeline requires them |
| C++/WASM | Not used in alpha | The data transforms, culling, and hit testing are straightforward in TypeScript; no existing native engine justifies a second language/toolchain |

The [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) is widely supported across the required browsers. [`OffscreenCanvas`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) can move selected rendering or preprocessing work to a worker, but support varies by API surface, so it is an optimization rather than the baseline. Animation frames are coalesced through [`requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

Figma solves a materially larger problem: an effectively unbounded design document, arbitrary vector geometry and effects, and multiplayer scenes with thousands of layers. Its team explicitly accepts WebGL/WebGPU renderer complexity and compiles a shared C++ engine to WASM. That architecture validates GPU rendering for Figma's scale; it does not establish it as the minimum for a bounded 50-track timeline. See Figma's accounts of its [WebGL complexity and stress cases](https://www.figma.com/blog/keeping-figma-fast/) and [C++/WASM renderer architecture](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/).

#### Viewport and scrolling model

- A native scroll container owns horizontal and vertical scroll behavior. A lightweight spacer represents the logical arrangement size so scrollbars, trackpads, and accessibility tools retain browser-native behavior.
- The visible canvas backing stores are viewport-sized, not ten-minutes-wide. They resize only when the viewport or device-pixel ratio changes.
- Canvas resolution follows device-pixel ratio but is capped at `2` in the alpha unless profiling proves a higher ratio stays within memory and frame budgets.
- The viewport state contains `scrollLeft`, `scrollTop`, viewport dimensions, pixels per musical tick, visible tick range, visible track range, and row metrics.
- Zoom is a change to the musical-time transform anchored under the pointer, selection, or playhead. The renderer does not create a larger canvas or redraw offscreen minutes of content.
- DOM track headers use vertical windowing with a small overscan and share the same row metrics and scroll state as the timeline.

#### Layered drawing and invalidation

The timeline uses stacked canvases so frequently changing pixels do not invalidate expensive stable content:

1. **Background layer:** bar/beat grid, section ranges, row backgrounds, and ruler ticks.
2. **Content layer:** clip blocks, compact note previews, waveform peaks, fades, and automation paths.
3. **Interaction layer:** playhead, loop brace, selection, hover, drag preview, resize handles, and drop targets.

- Each layer has explicit dirty reasons. Moving the playhead redraws only the interaction layer; changing one clip invalidates its content bounds rather than rebuilding the entire Solid component tree.
- Scroll, zoom, pointer, and playhead events update the latest viewport state and schedule at most one draw per animation frame.
- Drawing code avoids object allocation inside inner loops and caches measured text, colors, and reusable paths where profiling shows value.
- The renderer is idle when no visible pixels change. It must not run a permanent 60 Hz loop while transport is stopped.

#### Culling, projection, and caches

- Domain selectors build a renderer-specific `ArrangementProjection` with stable IDs, integer musical bounds, track order, colors, labels, compact preview data, and revision counters. Canvas code never traverses Firestore-shaped data.
- Track row offsets are stored in prefix sums so the visible first/last row and pointer row can be found by binary search even with expanded tracks.
- Placements and automation points are sorted or indexed per track. The renderer queries only objects intersecting the visible tick range plus a small overscan.
- Waveforms use precomputed min/max peak pyramids at multiple resolutions. Peaks are computed once in a worker, cached by asset ID and source revision, and selected by zoom level; raw samples are never scanned during paint.
- Visual caches have an LRU memory budget. Eviction affects only drawing speed, never project or audio correctness.
- The projection exposes revision counters at song, track, clip, asset, and automation granularity so unrelated edits do not invalidate all cached geometry.

#### Interaction and accessibility

- Pointer coordinates convert through the same row and musical-time transforms used for drawing. Hit testing queries only the visible track's sorted objects and checks handles before bodies.
- Dragging, resizing, marquee selection, and automation drawing use transient interaction state. One validated domain transaction commits on gesture completion rather than mutating and persisting on every pointer event.
- Track names, mute/solo, mixer controls, context menus, dialogs, and inline renaming remain real DOM controls.
- The focused or selected timeline object has a DOM focus proxy and an accessible description. Keyboard navigation updates selection through the same model as pointer hit testing.
- A virtualized semantic list exposes visible tracks and clips to assistive technology without creating DOM nodes for the entire arrangement. Canvas pixels are never the sole representation of selection, playback position, or edit state.

#### Arrangement performance acceptance

The baseline device is a 2019 13-inch Intel MacBook Pro class machine with integrated Intel graphics and 8 GB RAM, tested without requiring a discrete GPU. The reference arrangement contains 50 tracks, ten minutes of musical time, at least 2,500 clip placements, waveforms on 20 tracks, and 100 populated automation lanes.

- On current and previous major Firefox, Chrome, and Edge, scripted continuous scroll and zoom after warm-up target a median frame time at or below `16.7 ms` and a 95th percentile at or below `33 ms` on the baseline device. Safari is measured on a best-effort basis under the supported-environment policy in section 10.
- Pointer input to visible hover, selection, drag, or resize feedback is below `50 ms` at the 95th percentile.
- No arrangement interaction creates a main-thread task longer than `100 ms` in the reference fixture.
- Opening the already-loaded reference project paints useful arrangement content within `500 ms` after its domain state is available.
- The arrangement renderer's visual cache budget is at most `128 MiB`, excluding decoded audio buffers managed by the audio engine.
- Frame cost is proportional primarily to visible objects, not total project duration or total offscreen clips.
- Performance degradation is acceptable above 50 tracks. Data integrity, scrolling correctness, save/export, and the ability to recover remain required.
- Release performance is measured on the physical baseline device in the gating browsers. Developer laptops and synthetic DOM benchmarks alone are not an acceptable substitute.

#### When these budgets are enforced

These budgets bind at `ARR-005` in Phase 2, once the production arrangement exists, and again at `HARD-001` in Phase 4. They are **not** a Phase 0 exit condition. The Phase 0 renderer spike (`FND-008`) is required to produce the deterministic fixtures, the scripted scroll/zoom/seek/selection traces, and a harness that emits frame time, long-task, redraw-count and memory numbers on whatever hardware runs it, and to check those numbers in as a baseline. It is not required to hit the targets, and no Phase 0 task may be gated on access to the physical baseline device. Measuring a spike on unrepresentative hardware and declaring the budget met is a worse outcome than an honest early number, so Phase 0 records what it measured and where it ran.

If Canvas 2D misses these targets after viewport culling, layered invalidation, waveform pyramids, allocation profiling, and worker-side preprocessing have been implemented, the team may prototype a WebGL renderer behind the same projection. A GPU rewrite requires an ADR containing profiles, cross-browser fallback behavior, accessibility impact, and measured improvement on the baseline device. WASM is a separate decision and does not follow automatically from choosing WebGL.

### 9.4 Core domain entities

This section defines the required conceptual boundaries, not the exact TypeScript shape. Phase 0 implements the canonical model in code; its TypeScript types, runtime-validation schemas, invariants, and tests become the authoritative contract rather than a separately duplicated domain-model document.

- **Project:** ID, owner, collaborators, name, timestamps, schema version, current revision, and song snapshot.
- **Song:** tempo, fixed alpha time signature, tracks, source clips, arrangement placements, section markers, automation, return buses, and master settings.
- **Track:** stable ID, name, color, order, track type, instrument state, ordered device chain, sends, and mixer state.
- **Device:** stable ID, typed processor, bypass state, order, validated parameter values, and preset provenance where relevant.
- **Drum pad:** stable ID, name, sample asset, choke group, instrument parameters, and mixer state within a drum machine.
- **Automation lane:** stable ID, target parameter reference, ordered breakpoint values in musical time, and interpolation mode.
- **Clip:** stable ID, owning track ID, name, color, length in musical ticks, and typed note or audio-loop content.
- **Placement:** stable ID, clip ID, track ID, arrangement start, duration, offset, and loop behavior.
- **Note event:** stable ID, pitch or trigger, start, duration, velocity, and optional probability reserved for later use.
- **Section:** stable ID, name, color, start, and duration.
- **Pack:** stable ID, name, version, publisher, kind (`factory`, `user`, or `third-party`), description, and one rights position covering its assets.
- **Asset:** stable ID, owning pack ID and pack version, URL/storage reference, type, metadata, and licensing provenance.
- **Revision:** stable ID, project revision number, author, timestamp, and optional name.

An asset is identified by its own ID together with the pack it came from. A project therefore knows not just which sounds it uses but which packs and pack versions it depends on, which is what makes reopening, export, collaboration, and a missing-pack state well defined (LIB-04).

#### Identifier format

Every persistent entity ID is a type-prefixed, URL-safe random string: a lowercase type prefix, an underscore, then a 21-character nanoid — for example `trk_V1StGXR8Z5jdHi6B_myT`. The prefix makes an ID self-describing in assistant proposals, diffs, logs, Firestore paths, and test failures, and makes a mismatched reference obvious at runtime as well as to the branded TypeScript type. IDs are opaque: nothing parses or orders them, and the prefix is never used to look up a type that the schema already knows.

| Entity | Prefix | Entity | Prefix |
| --- | --- | --- | --- |
| Project | `prj_` | Drum pad | `pad_` |
| Track | `trk_` | Automation lane | `aut_` |
| Clip | `clp_` | Section | `sec_` |
| Placement | `plc_` | Return bus | `ret_` |
| Note event | `evt_` | Asset | `ast_` |
| Device | `dev_` | Pack | `pak_` |
| Revision | `rev_` | | |

Tests use a deterministic ID factory that produces the same prefixed format with a seeded suffix, so fixtures and serialization round trips stay stable without a separate ID shape.

### 9.5 Domain invariants

1. Persistent relationships use stable IDs in the section 9.4 prefixed format, never array positions.
2. Musical time is stored in integer ticks at **192 PPQ**; pixels and floating-point seconds are derived views. 192 is Tone.js's own transport resolution, so live scheduling needs no conversion between stored and scheduled time. At 192 PPQ a 16th note is 48 ticks, an eighth-note triplet is 64, and a ten-minute arrangement at 240 BPM is under 500,000 ticks. Changing PPQ after schema v1 is a migration, not a configuration value.
3. Clip content is separate from arrangement placement so reuse and independent variation are explicit.
4. All user-controlled numeric values have shared validation and clamping rules.
5. A placement cannot reference a missing clip or a clip owned by a different track unless an explicit cross-track copy operation creates a compatible clip.
6. Structural commands leave the project valid or make no change.
7. Audio engine objects are runtime resources and never stored in project state.
8. Asset URLs are not treated as asset identity.
9. Insert chains are ordered and serial; send levels reference valid return buses, and deleting a device or return cannot leave dangling routing references.
10. Broad creative parameter ranges are explicit schema data shared by the UI, command validator, live audio engine, offline renderer, and assistant tools.
11. Automation targets stable parameter IDs, uses integer musical time, and cannot reference a missing track, send, device, or parameter.
12. Every asset reference names its owning pack and the pack version it resolved from. Asset identity is pack-qualified, a project's pack dependencies are derivable from its own state without consulting the library, and an unavailable pack produces a reported missing-pack state rather than a dangling reference or a silent substitution.

### 9.6 Shared command layer

The command layer is the integration boundary among the editor, assistant, history, persistence, and tests.

Each command must provide:

- A versioned type and validated payload.
- An actor (`user`, `assistant`, or `system`) and correlation ID.
- A pure or deterministically testable state transition.
- A generated inverse or before-state sufficient for undo.
- A human-readable summary suitable for an AI proposal diff.
- An explicit project base revision for remote or delayed application.

UI components must not mutate the persisted project store directly. The AI endpoint must not emit raw project snapshots as its mutation mechanism.

### 9.7 Audio engine boundary

- The engine consumes a read-only song projection and typed incremental change events. It does not subscribe to an entire mutable project object and rebuild on any reactive change.
- One application-scoped `AudioRuntime` owns the real-time Tone context, Tone transport, destination/master graph, buffer cache, resource registry, and current `ProjectAudioGraph`.
- `ProjectAudioGraph` owns return buses, track graphs, arrangement schedules, and project-scoped subscriptions. Replacing it leaves the compatible runtime/context intact.
- Each `TrackAudioGraph` owns one instrument/audio source abstraction, an ordered device graph, sends, channel gain/pan, meter, and its scheduled events. Registries key graphs and devices by stable domain IDs.
- Runtime factories are the only code allowed to construct Tone/Web Audio resources. Solid components and domain stores can request graph operations but never receive mutable audio nodes.
- Graph reconciliation classifies changes as parameter, schedule, topology, asset, or full-project changes and applies the narrowest operation. Parameter updates are the common path and preserve node identity.
- The engine owns an explicit disposal tree. Parent disposal disposes each child once, unregisters it, then releases the parent; partially constructed children register cleanup as soon as they acquire a resource.
- Tone transport schedules are registered with an owner and returned handle. Cleanup clears those handles instead of leaving anonymous global events behind.
- Scheduling, node lifecycle, decoding/cache behavior, processing graphs, metering, and offline rendering are isolated from SolidJS components.
- UI state such as selection, panel size, arrangement viewport, assistant state, and open dialogs is not part of the audio projection.
- Development HMR stores or hands off the compatible `AudioRuntime` outside the replaced module's local scope. Module disposal cannot orphan a context, transport callback, or graph.
- Offline render builds a separate graph against an offline context from the same domain projection and device factories where supported; it never swaps the live global context underneath playback.
- Audio tests use deterministic schedules, offline rendering, instrumented resource registries, and real-browser lifecycle tests; timing-critical behavior is not verified only with DOM tests.

### 9.8 Assistant boundary

- Project analysis produces a compact, serializable context rather than sending the full persistence document by default.
- The server owns model-provider integration, prompt versions, tool schemas, usage limits, and response validation.
- The client owns proposal presentation and sends approved commands through the normal command layer.
- Provider-specific objects do not enter the domain model.

### 9.9 Persistence boundary

- A repository interface supports local test data and the production backend.
- Optimistic local state is authoritative during active edits; acknowledgements update save status rather than replaying stale snapshots.
- Schema migration is separate from UI rendering.
- Security rules enforce ownership/collaborator access and must be tested against an emulator before sharing ships.

#### Firestore schema-v1 document layout

Schema v1 stores a project across three tiers. This layout is a committed alpha decision; changing it requires an ADR and a migration.

| Path | Contents | Written when |
| --- | --- | --- |
| `projects/{projectId}` | Name, owner, collaborators, created/modified timestamps, schema version, current revision, template/genre label, and the pack dependency list (pack ID and version per pack the project uses) | Metadata changes; dashboard queries read only this tier |
| `projects/{projectId}/song/current` | Tempo, time signature, sections, ordered tracks with instrument state, device chains, sends and mixer state, return buses, master settings, arrangement placements, and automation lanes | Structural and arrangement edits |
| `projects/{projectId}/clips/{clipId}` | Clip metadata and its note or audio-loop content | Note and clip-content edits |

- The dashboard lists projects without loading song state or clip content.
- Note editing — the highest-frequency write path — touches one small clip document rather than rewriting song structure.
- The song document has a documented size budget, asserted in tests against the maximum reference project. If arrangement placements and automation exceed that budget, they split into per-track chunk documents under `projects/{projectId}/arrangement/{trackId}` sharing the same revision. `FND-004` owns the exact budget and chunk boundary and must prove both against the 50-track reference fixture; no document may grow unbounded.
- The pack dependency list lives in the metadata tier so the dashboard, export, and a missing-pack warning can answer "what does this project need?" without loading song state or clip content. It is derived from project state rather than maintained by hand, and it is recomputed as part of the same transaction that adds or removes the last reference to a pack.
- Every tier carries the project revision so a stale write or remote echo is detected rather than applied.
- Prototype `latestSnapshot` documents are not part of this schema and are discarded rather than migrated.

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
- Arrangement scrolling and zooming meet the Section 9.3 acceptance budgets for the 50-track reference project on the baseline device, enforced from `ARR-005` onward as described in section 9.3.
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
- Error monitoring uses a third-party processor (Sentry, per ADR 0001). It is disclosed to the user alongside product analytics, its retention and regional storage are part of the same product decision, and no additional processor is added to the alpha without an ADR.
- The alpha's single hosted environment is the production project (OPS-01). Test suites run against the emulator suite and must not write to it, and deployment credentials live in CI rather than on developer machines.

## 11. Success measures

The private alpha should instrument events needed to establish baselines rather than optimize for vanity usage.

Every measure below is derived from the OPS-02 event catalog; the event names that produce it are listed in parentheses. A measure that no catalogued event can produce is a gap in the catalog, not a reason to add a bespoke logging path.

### Primary measure

**Track progression rate:** percentage of activated projects that reach an arrangement with at least three named sections and two minutes of content, then play through or export. Two minutes is an analytics threshold, not a project-duration limit. (`project_created`, `arrangement_milestone`, `transport_play`, `export_completed`.)

### Supporting measures

- Time from project creation to first user-authored audible edit. (`project_created`, `first_edit`.)
- Which features a new user reaches for first, and how quickly. (`feature_first_use`, against `app_opened` and `project_created`.)
- When and how often people use the app: sessions, session length, and return frequency. (Google Analytics automatic session collection, plus `app_opened` and `project_opened`.)
- Percentage of projects progressing from a loop to at least three sections. (`section_created`, `arrangement_outline_created`, `arrangement_milestone`.)
- Percentage of activated users exporting a stereo mix, multitrack stems, or both. (`export_started`, `export_completed`.)
- Assistant proposal apply, cancel, undo, and follow-up rates by capability. (`assistant_proposal_shown`, `assistant_proposal_applied`, `assistant_proposal_cancelled`, `assistant_proposal_undone`.)
- Percentage of applied assistant proposals manually edited afterward, indicating ownership rather than passive generation. (`assistant_proposal_applied`, `assistant_result_edited`.)
- Project reopen rate after 1 and 7 days. (`project_opened` with `project_age_bucket` and `is_first_open`.)
- Save failures, missing assets, audio start failures, scheduling underruns, and export failures. (`save_failed`, `save_recovered`, `asset_load_failed`, `audio_start_failed`, `audio_underrun`, `export_failed`.)
- Crash-free session rate. (Reported by the OPS-03 monitoring platform's release-health session tracking, with the GA4 `exception` counter available to cross-check it against the other measures.)

### Qualitative validation

In user sessions, at least 5 of 8 target users should be able to create a variation, make a distinctive processing change, arrange three sections, explain one technique the assistant used, and export without facilitator intervention. The small sample is a directional alpha gate, not statistical proof.

### Guardrails

- AI proposal undo rate is investigated by capability; it is not assumed to be inherently bad because experimentation is desirable.
- Increasing assistant usage must not reduce manual edits or users' reported sense of authorship.
- Crash-free sessions, save success, and successful audio start remain release gates regardless of engagement.

## 12. Delivery plan

The agent-ready task sequence, ownership protocol, dependencies, and completion evidence are maintained in [`docs/backlog.md`](./backlog.md). This PRD remains authoritative for product scope and acceptance criteria; backlog tasks must link back to and satisfy it.

### Phase 0 - Foundations

- **Deploy the application to Firebase Hosting first.** Before the domain model, the audio runtime, or the renderer spike, establish the deploy pipeline so every subsequent slice can be checked in a real browser against real Firebase services. Rules and indexes deploy with the app, the release SHA is stamped into the build, and rollback is documented. The alpha's only hosted environment is the production project (OPS-01).
- Land the analytics and error-monitoring foundation immediately after: the typed OPS-02 event catalog, the logging boundary every later feature uses, and the OPS-03 error handlers, error boundaries, and Sentry integration with its scrubbing and source-map upload. Phase 0 emits the events it can honestly emit — `app_opened`, `first_edit`, `feature_first_use`, `save_failed`, `audio_start_failed`, and `exception` — and publishes the catalog contract that every Phase 1-4 feature task extends with its own events. Instrumentation is never deferred to a cleanup task.
- Implement the canonical schema-v1 domain model in TypeScript with runtime validation, prefixed stable IDs, integer musical time at 192 PPQ, explicit invariants, and deterministic serialization. Existing prototype state and documents require no migration or backwards compatibility.
- Implement the shared parameter-definition mechanism — how a parameter declares its range, unit, default, clamping policy, and automation capability, and how UI, command validation, the audio engine, and assistant tools all read one definition. Phase 0 defines the mechanism and the few parameters the vertical slice needs. Per-device values for instruments and effects are authored with their devices in Phase 1, where they can be tuned by ear, and must not be invented into schema v1 ahead of them.
- Implement the section 9.9 v1 Firebase persistence layout in code, including the metadata/song/clip document tiers, the song-document size budget and its chunk overflow path, domain-to-storage mapping, ownership metadata, schema and revision fields, indexes, security rules, and repository adapters.
- Add domain fixtures and automated tests for schema validation, invariants, serialization round trips, invalid references, musical-time conversion, repository behavior, Firestore size/chunk boundaries, and Firebase Emulator security rules.
- Introduce the shared command, validation, transaction, undo/redo, and save-status layers.
- Build the single-context `AudioRuntime`, ID-keyed graph reconciler, disposal ownership tree, and resource-leak harness outside Solid components.
- Separate transport/audio runtime from Solid components and define incremental synchronization.
- Build the hybrid DOM/Canvas 2D arrangement renderer vertical slice and automated performance fixture before expanding timeline features.
- Add reference project fixtures and deterministic audio tests.
- Establish the LIB-04 pack model before content and projects accumulate around a flat namespace: the `Pack` entity and pack-qualified asset identity in schema v1, the project's pack dependency list, and the starter library re-delivered as packs with per-pack manifests. This is the one structural content decision that is materially cheaper now than later, because after Phase 0 there are saved projects whose asset references would need migrating.
- Build and publish the `LIB-00` starter library of sounds for testing, with its manifest, validator, and Cloud Storage delivery. This is not the curated factory library — it is the real audio every later slice is built and tested against, and it lands early for the same reason the deploy pipeline does: so the library browser, sampler, drum machine, caching, and export are exercised against real assets from their first commit rather than against two prototype WAV files.

Exit criteria: the schema-v1 code and Firebase layout pass their unit, round-trip, repository, and emulator tests; the thin vertical slice can add one note through the step grid of a sampler track, play it, undo it, save it, and reopen it through the new boundaries; no UI or assistant code directly mutates stored project data; the renderer spike ships its fixtures, scripted traces, and measurement harness with checked-in baseline numbers; that vertical slice is reachable in a deployed build on Firebase Hosting, deployed by CI and identifiable by its release SHA; and the slice's Phase 0 analytics events and a deliberately triggered test error are observable end to end from that deployed build. Renderer frame budgets are enforced at `ARR-005` and `HARD-001`, not here, and no Phase 0 exit condition depends on access to the physical baseline device. Prototype projects are not an exit dependency.

### Phase 1 - Complete the loop workflow

- Track management, sampler, drum machine, synth, audio loops, genre-spanning library browser, mixer, metering, core processing chains, transport, step editor, and piano roll.
- Pack-organized browsing: the browser presents packs as a way in, search and filters work across every available pack, and a missing pack is reported without blocking unrelated work.
- Starter templates and robust project management/autosave.
- Public landing page as an honest front door into the anonymous-start flow.
- Desktop editor layout with collapsible panels, a typed Ableton-familiar shortcut registry, shortcut tooltips, and the `?` keyboard mapping guide.
- The acquisition, activation, and creation events in the OPS-02 catalog, each shipped by the feature it measures: `landing_cta_click`, `anon_session_created`, `account_upgraded`, `project_created`, `project_opened`, `project_deleted`, `transport_play`, `track_added`, `instrument_changed`, `device_added`, `library_audition`, `clip_edited`, `shortcut_used`, `undo_used`, plus the `save_recovered`, `audio_underrun`, and `asset_load_failed` reliability events and each feature's `feature_first_use` key.

Exit criteria: a user can create, process, save, reopen, and reliably play an original 1-8 bar multi-track electronic loop without assistant help, including a drum machine and multiple chained effects, and the loop-workflow events above are observable from the deployed build.

### Phase 2 - Arrangement and export

- Timeline placements, section markers, clip reuse/variation, focused automation, selection tools, and manual structure templates.
- Arrangement scheduling, master limiter, offline stereo WAV render, and aligned multitrack stem packaging.
- The arrangement and export events in the OPS-02 catalog: `section_created`, `arrangement_outline_created`, `automation_lane_created`, `arrangement_milestone`, `export_started`, `export_completed`, and `export_failed`. `arrangement_milestone` is what makes the section 11 primary measure computable, so it ships with the sections work rather than at hardening.

Exit criteria: a user can manually build arrangements from two through ten minutes, export a stereo mix, and import the exported stem package into another DAW with every track aligned.

### Phase 3 - AI producer

- Compact project analysis, server model gateway, tool schema, proposal cards, atomic apply/undo, contextual explanations, and initial capability set.
- Evaluation fixtures for arrangement, variation, transformation, and invalid/stale responses.
- The assistant events in the OPS-02 catalog: `assistant_message_sent`, `assistant_suggestion_clicked`, `assistant_proposal_shown`, `assistant_proposal_applied`, `assistant_proposal_cancelled`, `assistant_proposal_undone`, and `assistant_result_edited`. These carry capability and scope keys only — never prompts, replies, or project content.

Exit criteria: the assistant can turn a reference loop into a valid editable outline, explain the edits, survive malformed responses, and leave the project identical after one undo.

Later-vision assistant capabilities shown in the design mocks — richer instrument depth (INS-01 note) and curated tutorial video recommendations (AI-08 / LRN-03) — are P2 and land after the alpha, in a phase to be scheduled with their curation, trust, and privacy models. They are not Phase 3 alpha work.

### Phase 4 - Private-alpha hardening

- Performance profiling, accessibility pass, error recovery, telemetry, browser compatibility, security-rule tests, and curated template/content review.
- Facilitated target-user sessions and fixes for blocked core journeys.
- Audit rather than build the analytics: confirm every OPS-02 event fires from the deployed build, that no event leaks project content, that internal traffic is excluded, and that the section 11 measures and release-gate dashboards compute from real cohort data. Hardening adds dashboards and disclosures, not the instrumentation itself — an event missing here is a defect in the phase that owned it.

Exit criteria: all P0 acceptance criteria pass, release-gate reliability metrics are observable from the deployed production build, and the qualitative validation exercise is completed.

### Phase 5 - Professional handoff and sharing

- Ableton Live Set export with portable assets, editable MIDI where possible, rendered stems for unsupported devices, and a compatibility report.
- Read-only project links, named revisions, and asynchronous collaborator access.
- User sample imports with drag-and-drop into a persistent per-user library (LIB-03), including client and server-side type/size validation, Cloud Storage-backed audio, and per-user storage limits.

Exit criteria: every Ableton reference project opens without missing assets in the declared target Live version, remains bar-aligned through the full arrangement, and accurately reports any non-editable or omitted state.

### Later - Pack marketplace

The LIB-05 marketplace — creator-authored packs, acquiring packs from other users, and premium packs — is deliberately unscheduled and sits after everything above, including user sample imports (LIB-03), which it builds on. It is a business surface with rights, payment, moderation, and support obligations, and it needs the product to have proven that people make and finish music here first. What the alpha owes it is only the LIB-04 pack model: versioned, self-describing, rights-carrying, independently deliverable packs, so that this can be built later without a second content system beside the first.

## 13. Parallel workstreams and ownership

Agents should agree on Phase 0 contracts before parallel feature implementation. Changes to shared entity or command schemas require review from every consuming workstream.

### Workstream A - Domain, history, and persistence

Owns the authoritative code-first entity and runtime schemas, invariants, serialization, future migrations, commands, transactions, undo/redo, the Firebase schema-v1 document layout, repositories, security rules, optimistic saves, auth integration, and save status.

Produces:

- Versioned TypeScript and runtime-validation domain schemas, serialization, fixtures, and contract tests.
- Command registry, validator, executor, inverse generation, and summaries.
- Firebase schema-v1 collections/documents or chunks, indexes, security rules, persistence adapter contract, emulator tests, and the migration harness for post-v1 changes.
- Stable selectors consumed by UI, audio, and assistant context generation.

### Workstream B - Audio engine and export

Owns the shared context/runtime, HMR handoff, graph reconciliation, resource ownership/diagnostics, transport, clock/scheduling, instrument and processing-device runtime, asset decoding/cache, insert/send/master graphs, meters, disposal, stereo/stem offline render, export packaging, and Ableton export serialization.

Produces:

- Framework-independent engine interface.
- Single-context runtime factory, stable ID-keyed graph registries, idempotent disposal tree, and development leak diagnostics.
- Incremental domain-to-audio synchronization contract.
- Offline schedule/render path and audio reference tests.
- Aligned stem renderer, manifest/ZIP builder, and round-trip alignment fixtures.
- Ableton Live Set package builder, conversion report, and compatibility fixtures.
- Performance and resource-lifecycle diagnostics.

### Workstream C - Editor experience

Owns editor shell, arrangement, track headers, clip editors, browser, detail panels, selection model, shortcut registry and mapping guide, accessibility, responsive behavior, and proposal highlighting.

Produces:

- UI state model distinct from persisted project state.
- Arrangement projection, layered Canvas 2D renderer, DOM virtualization, waveform cache, accessibility mirror, and performance harness.
- Components that dispatch shared commands rather than mutate state.
- End-to-end manual loop and arrangement journeys.
- Stable selection/context interface for the assistant.

### Workstream D - Assistant and learning

Owns project summarization, server model gateway, tool schema mapping, streaming conversation, proposal diff/apply/cancel UI, explanations, rate limits, and evaluation cases.

Produces:

- Provider-independent assistant contract.
- Allowlisted tool definitions that compile to domain commands.
- Adversarial validation and stale-revision behavior.
- A fixture-based evaluation set with expected invariants, not brittle exact musical output.

### Workstream E - Content, quality, and release

Owns licensed sample/preset metadata, genre coverage, starter templates, test fixtures, end-to-end tests, the deploy pipeline, the analytics catalog and error-monitoring boundary, accessibility verification, security-rule tests, compatibility matrix, and alpha operations.

Produces:

- Validated asset manifest with provenance.
- The pack definitions the library ships as: pack records, per-pack manifests, pack versioning, and the coverage each starter pack claims.
- The `LIB-00` starter library of sounds for testing, its generation and publishing pipeline, and the Cloud Storage bucket configuration that serves it.
- Audited bundled-content demo projects for every required initial genre.
- Reference projects covering empty, typical, maximum, migrated, and corrupt states.
- The Firebase Hosting deploy pipeline, rules/index deployment, release stamping, rollback procedure, and deployed-build smoke test.
- The typed OPS-02 analytics catalog and logging boundary, the OPS-03 error-reporting boundary and its Sentry integration including scrubbing and release/source-map upload, and the tests that keep project content out of both. Other workstreams add their own events through this contract; this workstream does not instrument their features for them.
- Release dashboard for the success and guardrail measures.
- Manual test script for supported browsers and audio devices.

### Dependency order

1. Workstream A implements and publishes the tested schema-v1 entity, command, Firebase repository, and selection contracts in code.
2. Workstreams B and C validate those contracts with a thin vertical slice: add one note, play it, undo it, save it, and reopen it.
3. Arrangement and export build on the validated clip/placement model.
4. Workstream D integrates only after manual commands and atomic history are stable.
5. Workstream E tests each vertical slice continuously rather than beginning after feature completion.

### Integration rules

- Maintain one canonical domain schema and one command registry.
- Use contract tests at workstream boundaries.
- After schema v1 is established, feature branches that change persisted shapes must include versioned migrations and fixtures; no migration from prototype data is required.
- No workstream bypasses commands for convenience in production code.
- Merge vertical slices that are playable and testable; avoid long-lived subsystem branches.
- Hide incomplete user journeys behind feature flags rather than partially exposing them.

## 14. Test strategy and definition of done

### Required test layers

- **Domain unit tests:** every command, inverse, invariant, migration, and musical-time conversion.
- **Audio tests:** event schedules, stable-node identity, narrow graph reconciliation, processing-graph changes, parameter extremes, automation boundaries, looping boundaries, idempotent disposal, cancelled/failed initialization, buffer-cache ownership, and offline-render properties.
- **Web Audio lifecycle tests:** one-context invariant, fifty HMR replacements, fifty project cycles, stale async-load cancellation, resource-counter baselines, and real-browser playback during parameter/topology edits.
- **Component tests:** editor interactions, every registered shortcut in valid and invalid focus contexts, mapping-guide synchronization, dialogs, accessibility names, and error states.
- **Rendering performance tests:** deterministic 50-track fixture, scripted scroll/zoom/selection traces, frame/long-task metrics, cache-memory checks, and physical baseline-device runs in the gating browsers from `ARR-005` onward.
- **Contract tests:** persistence adapters, assistant tool payloads, stale revisions, domain-to-audio projections, and pack-qualified asset resolution including the missing-pack path.
- **End-to-end tests:** anonymous start, create loop, arrange, assistant apply/undo, autosave/reopen, stereo export, and multitrack stem export.
- **Manual tests:** audible glitches, metering, long playback, AudioContext policies, browser decoding, and output-device changes.

### Feature definition of done

A feature is done only when:

- Its acceptance criteria pass in a production-like build.
- Domain changes use validated commands and participate correctly in undo/redo and autosave.
- Audio resources and reactive subscriptions are disposed.
- Audio lifecycle tests prove parameter edits reuse stable nodes and teardown returns project-scoped resource counters to baseline.
- Loading, empty, error, offline, and permission states are handled.
- Keyboard and screen-reader semantics are present for non-audio interaction.
- New or changed user actions register shortcuts and mapping-guide metadata where applicable, with no component-local duplicate binding.
- **Analytics ships with the feature.** Every new or changed user action that the OPS-02 catalog covers emits its events through the shared typed catalog, with no ad-hoc event strings, and its principal failure path emits the relevant reliability event. A feature whose events are "to be added later" is not done. If a feature introduces a user action the catalog does not cover, the catalog is extended in the same change — with a `feature_first_use` key at minimum — rather than shipping unmeasured.
- Instrumentation is tested at the same layer as the behavior: the event fires once per action, repeated or continuous gestures do not multiply it, and disabling analytics changes nothing about the feature.
- Relevant telemetry contains no project content or secrets, verified by the OPS-02 parameter-content test rather than by inspection.
- The feature has been exercised in a deployed build on the hosted environment, not only against a local dev server and the emulator suite.
- Tests cover the happy path and the principal failure path.
- Arrangement changes do not regress the committed reference performance budgets.
- User-facing terminology matches this document.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| DAW scope expands faster than the core journey | Alpha never becomes coherent | Hold P0 to loop, arrangement, assistant edits, and export; require evidence before promoting P1/P2 work |
| Browser audio timing or lifecycle defects erode trust | Users abandon projects despite good features | Isolate the engine, schedule ahead, build offline tests, and maintain a maximum-size reference project |
| HMR, navigation, or reactive updates leak contexts and Tone objects | Chrome context limits, rising memory/CPU, duplicated triggers, and eventual playback failure | Own one application-scoped context, preserve it across compatible HMR, reconcile stable graphs, require idempotent disposal, and assert instrumented resource baselines |
| Dense arrangement rendering overwhelms older integrated graphics or the main thread | Scrolling and editing become unusable on target hardware | Use viewport-sized layered Canvas 2D, culling, virtualized DOM, waveform pyramids, allocation profiling, and a physical 2019 Intel MacBook Pro release benchmark before considering WebGL |
| Safari is non-gating during the alpha | Web Audio unlock, decoding, or context-lifecycle defects surface late on the browser most Mac users default to | Keep Playwright WebKit in the automated suite as a signal, feature-detect rather than branch on user agent, fix reasonable-cost Safari defects as they are found, and require an explicit product-owner decision to restore gating status before any public release |
| Renderer budgets are not enforced until Phase 2 | A structurally slow renderer is discovered after the production arrangement is already built on it | Phase 0 still ships the fixtures, scripted traces, and measurement harness with checked-in baseline numbers; `ARR-005` profiles before the arrangement is called done, and the projection/geometry contracts stay renderer-agnostic so a replacement renderer remains possible |
| Large or extreme processing chains overload the browser or create unstable output | Glitches interrupt creation or unsafe peaks reach the output | Enforce measured device-count budgets, smooth parameters, bound unstable feedback internally, profile the processed reference project, and retain a transparent master safety limiter |
| AI changes feel arbitrary or destroy work | Loss of authorship and trust | Structured proposals, validation, selection scope, atomic apply, visible diff, and immediate undo |
| AI context becomes too large or expensive | Slow, unreliable assistant | Compact musical summaries, scoped selection, deterministic analysis, token/usage budgets, and provider-independent gateway |
| Concurrent agents create incompatible models | Rework and subtle corruption | Phase 0 contracts, one schema owner, contract tests, and thin vertical-slice integration before parallel expansion |
| Sample licensing is unclear | Product cannot ship its content | Record provenance and permitted use in the asset manifest before an asset is merged |
| The pack model adds a layer without earning it | Extra indirection in identity, delivery, and the browser for no user benefit, and packs become an empty folder level | Keep packs the unit of curation, rights, delivery, and browsing rather than a second tag system; require every starter pack to be usable on its own for its stated purpose; hold pack membership to organization only so no capability depends on it |
| The marketplace opportunity pulls scope forward | Alpha spends effort on publishing, entitlement, and payments before anyone has finished a track in the product | Keep LIB-05 P2 and unscheduled, ship the alpha with bundled factory packs only and no entitlement model, and require the alpha's creation journey to be validated before any marketplace work is scheduled |
| Ableton's project format or behavior changes | Exported sets fail or silently lose work | Target a declared Live version, isolate the serializer, test fixture exports in Live, report conversion loss, and always include portable stems/MIDI |
| Autosave conflicts with rapid edits | Lost changes or controls jumping backward | Optimistic local authority, coalesced writes, revision checks, and explicit save state |
| The interface becomes a smaller but still intimidating DAW | Target users remain stuck | Progressive disclosure, task-based user tests, opinionated templates, and arrangement-first assistant suggestions |
| Production is the alpha's only hosted environment | A bad deploy reaches the cohort, or a deploy damages real project data | Deploy rules/indexes with the app from one pipeline, stamp and smoke-test every release, keep rollback documented and practised, hold incomplete journeys behind feature flags, and revisit the single-environment decision before public launch or before data loss would be unrecoverable |
| Instrumentation is deferred to a later "telemetry" task | The alpha ends with no baseline for its own success measures and cannot tell which features were tried first | Ship the event catalog in Phase 0, make analytics part of the definition of done for every feature task, and assign each catalogued event to the task that builds the feature it measures |
| Analytics or error reports leak project content | A privacy failure in the product whose value is the user's own music | One typed catalog with enumerated parameters, prefixed IDs instead of names, a test that rejects content-bearing parameters and covers events added later, and a user-facing opt-out that costs no capability |
| A third-party monitoring SDK collects more than the product allows | Clip names, console output, or on-screen music reach an external processor by default rather than by decision | Keep the reporting boundary in application code, disable console breadcrumbs and `sendDefaultPii`, scrub before transmission, forbid Session Replay without a superseding ADR, and extend the content test to the SDK payload rather than only our own events |

## 16. Decisions and open questions

### Decisions made for implementation

- Desktop web is the alpha production surface.
- The application deploys to Firebase Hosting from CI starting in Phase 0, and the private alpha runs on one hosted environment — the production Firebase project. Rules and indexes deploy with the app; the decision is revisited before public launch.
- Product analytics use Google Analytics for Firebase through one typed event catalog (OPS-02), and shipping a feature's events is part of that feature's definition of done rather than a later instrumentation pass.
- Crash and error monitoring use Sentry behind the application's own reporting boundary ([ADR 0001](./adr/0001-sentry-for-error-monitoring.md)). Firebase Crashlytics does not support the Web SDK, and Google Cloud Error Reporting cannot symbolicate browser stack traces without publicly serving our source maps — which `OPS-03` forbids. Session Replay stays off, and replacing Sentry requires a superseding ADR.
- Approved architecture decision records live in [`docs/adr`](./adr); the section 9.1 stack table indexes them.
- Current and previous major Firefox, Chrome, and Edge are the gating P0 browsers, with a 2019 Intel MacBook Pro class machine as the performance baseline. Safari is best-effort for the alpha and expected to return to gating status before public release.
- Musical time is integer ticks at 192 PPQ, matching Tone.js transport resolution so stored and scheduled time need no conversion.
- Persistent IDs are type-prefixed 21-character nanoids, for example `trk_V1StGXR8Z5jdHi6B_myT`.
- Firestore schema v1 stores a project as a metadata document, one song document, and one document per clip, with a documented song-document size budget and a defined per-track chunk overflow path.
- Phase 0 defines the parameter-definition mechanism; per-device parameter values are authored with their devices in Phase 1.
- Arrangement frame budgets are enforced at `ARR-005` and `HARD-001`. Phase 0 owes measurement infrastructure and honest baseline numbers, not passing scores, and no Phase 0 task depends on the physical baseline device.
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
- A self-contained Ableton Live Set is the first native project-format handoff target after the private alpha.
- Ableton export targets the oldest Live version that can correctly support the implemented handoff; an exporter compatibility spike establishes and documents that minimum version.
- Real-time collaboration follows validation of the single-user creation workflow.
- SolidStart/SolidJS/TypeScript, Tone.js over Web Audio, and Firebase Auth/Firestore/Storage/Functions are committed alpha technologies.
- One long-lived real-time Tone/Web Audio context per document and stable, incrementally reconciled audio graphs are hard alpha architecture decisions.
- The alpha arrangement is a hybrid virtualized DOM plus layered Canvas 2D renderer; WebGL/WebGPU and WASM require measured failure plus an approved ADR.

### Product-owner decisions required before Phase 3 or launch

- Which factory packs does the alpha ship, and what is each one's name, scope, and stated purpose? The list follows from the assets that can actually be cleared, so it is settled with the content plan rather than ahead of it.
- For the later pack marketplace (LIB-05): who may publish a pack, what rights and revenue-sharing terms apply to a creator, what moderation and takedown process governs published content, and what happens to a project that uses a pack after that pack is withdrawn or the user's access to it ends? (Post-alpha; unscheduled.)
- Which sample/preset sources have acceptable commercial licensing and attribution terms?
- Which AI provider, model budget, usage limit, and data-retention policy are acceptable for the alpha?
- Will anonymous projects expire, and what exact upgrade path protects them across devices?
- What volume normalization or loudness target should WAV export use, if any?
- Should native Live Set generation be maintained directly or delivered through a supported partner/integration route?
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
