# Runbook: the cross-browser release pass

PRD section 10 gates the alpha on **current and previous major desktop
versions of Firefox, Chrome and Edge**, and keeps Safari best-effort. The
automated suites cover most of that; this runbook is the part a person has to
do on real machines, and the rule for what a failure means for a release.

Record every pass as a comment on the release's issue (for the first alpha,
[#75](https://github.com/afternoon/solid-groove/issues/75)), using the results
table at the end.

| Field | Value |
| --- | --- |
| Owner | Whoever cuts the release, on the physical baseline device (not an implementation agent) |
| Frequency | Before every alpha release, and again whenever a gating browser ships a new major |
| Hardware | The PRD baseline: a 2019 13-inch Intel MacBook Pro class machine, 8 GB RAM, integrated graphics, run alongside the performance pass in [#63](https://github.com/afternoon/solid-groove/issues/63). Plus one Windows 10/11 machine for Edge |
| Related | [PRD 10, Supported environment](../prd.md#10-non-functional-requirements), [`docs/testing.md`, "Which browsers run where"](../testing.md#which-browsers-run-where), [`docs/core-flows.md`](../core-flows.md) |

## What automation already covers, and what it cannot

| Browser | Version | Automated (CI on every push) | Manual (this runbook) | Gates the release |
| --- | --- | --- | --- | --- |
| Chrome | current | `chrome` channel: mock suite and every core flow | Baseline-device pass | Yes |
| Chrome | previous major | No: Playwright cannot pin an older channel | Full pass | Yes |
| Edge | current | `msedge` channel: mock suite and every core flow | Baseline-device pass on Windows | Yes |
| Edge | previous major | No | Full pass | Yes |
| Firefox | current | `firefox` (Playwright's pinned build): mock suite and every core flow | Baseline-device pass | Yes |
| Firefox | previous major | No | Full pass | Yes |
| Safari | current | `webkit` mock suite, as a signal only | Full pass, findings logged | **No** (best-effort) |

Two things only a real browser on real hardware can show, which is why the
current versions get a pass here too even though CI runs them:

- **Sound.** CI asserts playback in Chromium-family browsers only; Firefox's
  context never leaves `suspended` on a runner with no audio device
  ([`docs/testing.md`](../testing.md#playback-is-asserted-in-chromium-only--a-known-tracked-gap),
  #43). Whether it sounds right (no clicks, no drift, no dropouts) is a human
  judgement on real speakers.
- **The display.** CI renders in a headless
  window. A Retina panel, an external 1x monitor and dragging a window between
  them are only real here.

## Getting the previous major of each browser

Install it beside the current one where you can, so both run on the same day.

- **Chrome:** Chrome for Testing serves every major:
  `npx @puppeteer/browsers install chrome@<previous major>`. It runs from its
  own folder and does not touch the installed Chrome.
- **Firefox:** `https://archive.mozilla.org/pub/firefox/releases/`, the last
  release of the previous major. Start it with `-P` and a new profile so it
  leaves the current install's profile alone, and turn off updates in that
  profile.
- **Edge:** Microsoft's "Edge for Business" download page offers the previous
  stable version. Install it on the Windows machine (or a VM) and turn off
  automatic updates there.
- **Safari:** the version that ships with the baseline device's current macOS.

Write down the exact version of each before you start (`chrome://version`,
`about:support`, `edge://version`, Safari > About Safari).

## The pass

Run every step in every browser in the matrix above. A fresh profile or a
private window for each, so no earlier session hides a first-run problem
(except where a step says otherwise).

### 1. Every core flow

Walk every flow in [`docs/core-flows.md`](../core-flows.md) that is not parked
at `fixme` (`bun run verify:core-flows` lists those) as written there. The
flows are the user journeys the PRD calls "every core journey". Mark each pass,
fail, or not run with a reason.

### 2. Audio unlock

1. Open a new project and press **Play** as the very first thing you do. Sound
   starts within a second, with no notice.
2. Reload, press **Space** instead of clicking. The same.
3. In the browser's site settings, block sound (Chrome/Edge: Site settings >
   Sound > Mute; Firefox: Permissions > Autoplay > Block audio and video;
   Safari: Settings for this website > Auto-Play > Never Auto-Play). Press Play.
   The editor says **"The browser blocked sound"** and tells you to press Play
   again or allow sound for the site. Allow it again; Play works without a
   reload.
4. Leave a project playing in a background tab for five minutes, come back:
   still in time, nothing doubled.

### 3. Decoding

1. Add one sound of each kind from the library: a drum one-shot, a sampler
   sound, a tempo-labelled loop. Each auditions and plays in the song.
2. Change the tempo with a loop playing: the loop keeps its pitch.
3. With the network throttled to "Slow 3G" in the developer tools, add a sound
   you have not used. Playback of the sounds already loaded never stops while
   it loads.

### 4. Shortcuts

Run the [`docs/shortcuts.md`](../shortcuts.md) table's global and arrangement
entries, on the platform's own modifier (Cmd on macOS, Ctrl elsewhere): Space,
1–5, `?`, undo/redo, copy/paste, select all. Check that each does the app's
action and **not** the browser's (no bookmark dialog, no page find, no history
navigation), and that typing in the tempo or project-name field types.

### 5. Downloads

1. Export the song as a stereo WAV. The browser saves one file named
   `<project name> <date>.wav`, and it opens and plays in the OS's audio
   player.
2. Export stems. The ZIP saves, unzips, and every stem lines up from bar 1 when
   dropped into another DAW.
3. Firefox and Safari: check the download did not open a new tab or ask a
   second time.

### 6. Canvas and pixel density

1. On the laptop's Retina panel (DPR 2): the arrangement's clips, text and the
   playhead are sharp, not blurred; waveforms are crisp at every zoom.
2. On an external 1x monitor (DPR 1): the same, and nothing is half-size.
3. Drag the window from one display to the other with a project playing. The
   arrangement redraws sharp on the new display without a reload.
4. Browser zoom at 80% and 125%: the arrangement still lines up with the
   pointer (clicking a clip selects that clip).

### 7. Firebase and the network

1. Sign in, open a project, edit, reload: the edit is there.
2. Turn the network off (OS-level, not just the developer tools). Edit. The
   save status says the save failed and offers **Retry**; playback of loaded
   sounds continues. Turn the network on, press Retry (or wait): **Saved**.
3. Open the same project in two windows, edit in one: the other follows.

### 8. Capability fallbacks

1. Block all site data for the app's origin (Chrome/Edge: Site settings >
   Cookies and site data > block; Firefox: Settings > Privacy > Exceptions >
   Block). Open a project: the editor says **"Site data is blocked"** and what
   to do. Nothing else breaks.
2. Private browsing window: start anonymously and open a project. Note whether
   the site-data notice appears (Safari's private mode is the case to watch).
3. Any notice the editor shows that you did not provoke is a finding: record
   the browser, the notice, and the exact version.

## What a failure means for the release

**A compatibility regression in a gating browser (current or previous Chrome,
Edge or Firefox) blocks the alpha release** — unless the affected feature has
an explicit, usable fallback that the product owner has approved in writing on
the release issue. "Usable" means a producer in that browser can still finish
the journey, and the editor tells them what is limited and what to do (as the
capability notices do). A fallback nobody approved does not unblock anything.

For each gating-browser failure:

1. Open a bug with the browser, exact version, OS, the step above, and what
   happened. Label it for the release's milestone.
2. Either fix it before release, or get the product owner's written approval of
   a named fallback on the release issue and link it from the bug.

Safari findings never block. They are logged below, fixed where the cost is
reasonable (a bug each), and what remains is the residual risk the product
owner weighs before restoring Safari to gating status ahead of any public
release (PRD section 10). No change may knowingly break Safari in the meantime.

## Results

Paste this into the release issue, one table per pass.

```markdown
### Cross-browser pass, <date>, <who>

Baseline device: <model, macOS version>. Windows machine: <version>.

| Browser | Exact version | Core flows | Unlock | Decoding | Shortcuts | Downloads | Canvas/DPR | Firebase | Fallbacks | Blocking findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome current | | | | | | | | | | |
| Chrome previous | | | | | | | | | | |
| Edge current | | | | | | | | | | |
| Edge previous | | | | | | | | | | |
| Firefox current | | | | | | | | | | |
| Firefox previous | | | | | | | | | | |
| Safari (best-effort) | | | | | | | | | | n/a |

Release decision: <blocked by #… | clear | clear with approved fallback for #…>
```

## Safari residual-risk log

Filled in by whoever runs the pass; never by an implementation agent, which
cannot run Safari. One row per Safari finding, kept across releases so the
product owner sees the whole picture when deciding whether Safari can gate the
public release.

| Date | Safari / macOS | Area | What broke | Severity for a producer | Fixed? (link) | Residual risk if not fixed |
| --- | --- | --- | --- | --- | --- | --- |
| _none recorded yet_ | | | | | | |

Product-owner decision on restoring Safari to gating status: _not yet taken._
