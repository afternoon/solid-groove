#!/bin/bash
# SessionStart hook for Claude Code on the web: the fast half.
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
# The dependency install is the slow one, so it lives in `session-start-deps.sh`
# and runs asynchronously. Everything here takes milliseconds and runs
# synchronously *on purpose* — both steps below are ordering-sensitive in a way
# `bun install` is not:
#
#   - $CLAUDE_ENV_FILE is read when the session starts. A variable written to it
#     from a background job is racing that read, and losing the race means
#     PW_CHROMIUM_PATH silently never applies and the browser suites break in
#     exactly the way this hook exists to prevent.
#   - ~/.asoundrc has to exist before the first `bun run test`, which an agent
#     may well start within a second or two of the session opening.
#
# Local machines are left alone: they have real audio hardware, their own
# Playwright install, and their own `bun install` cadence.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

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

# Stdout from a SessionStart hook becomes session context, so say the one thing
# that is actually worth knowing: a command failing on missing modules in the
# first few seconds is the async install still running, not a broken checkout.
cat <<'NOTICE'
Environment: dependencies are installing in the background (see
.claude/hooks/session-start-deps.sh). If a bun/tsc command fails with missing
modules or TS2688 in the first minute of the session, that install has not
finished — wait and retry rather than diagnosing it as a tsconfig or lockfile
problem. A null ALSA device and PW_CHROMIUM_PATH are already configured.
NOTICE
