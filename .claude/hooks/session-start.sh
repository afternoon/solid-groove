#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# A remote container starts with no `node_modules`, no default audio output
# device, and a Playwright build that does not match this repo's pin. Each of
# those fails in a way that looks like a code defect rather than a missing
# setup step, and each has already cost a run:
#
#   - no `node_modules`   -> `bun run typecheck` reports TS2688 "Cannot find
#                            type definition file for '@testing-library/jest-dom'",
#                            which reads like a broken tsconfig
#   - no audio device     -> importing `tone` throws "cpal backend error during
#                            default_output_config: DeviceUnavailable" and every
#                            suite under `src/audio/` fails at load time
#   - Playwright mismatch -> `bun run test:browser` finds no browser binary even
#                            though the image ships one
#
# Doing them here means an agent never has to diagnose them, and never reaches
# for the workarounds CLAUDE.md forbids (mocking Tone, skipping audio suites,
# editing src/audio/testAudioContext.ts).
#
# Local machines are left alone: they have real audio hardware, their own
# Playwright install, and their own `bun install` cadence.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Prefer the lockfile exactly as CI resolves it; fall back to a plain install
# rather than failing session startup if the lockfile has drifted.
bun install --frozen-lockfile || bun install

# A null ALSA default PCM: discards every sample, needs neither audio hardware
# nor the snd-dummy kernel module. Only written when the host genuinely has no
# sound device and has no ALSA config of its own, so this never overrides a
# deliberate one. See CONTRIBUTING.md, "A null ALSA device".
if [ ! -d /dev/snd ] && [ ! -f "$HOME/.asoundrc" ] && [ ! -f /etc/asound.conf ]; then
	cat >"$HOME/.asoundrc" <<'ASOUNDRC'
pcm.!default {
    type null
}
ctl.!default {
    type null
}
ASOUNDRC
fi

# The image preinstalls a Chromium build under PLAYWRIGHT_BROWSERS_PATH, but at
# whatever revision its own Playwright wanted — not the revision this repo's
# pinned @playwright/test asks for, so Playwright's own lookup misses it. The
# binary drives the suite fine; point the chromium projects at it explicitly.
# Firefox and WebKit are deliberately not installed here: their download host is
# blocked in this environment, and CI owns those two browsers. See
# docs/testing.md, "Which browsers run where".
chromium_path="${PLAYWRIGHT_BROWSERS_PATH:-}/chromium"
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x "$chromium_path" ]; then
	echo "export PW_CHROMIUM_PATH=\"$chromium_path\"" >>"$CLAUDE_ENV_FILE"
fi
