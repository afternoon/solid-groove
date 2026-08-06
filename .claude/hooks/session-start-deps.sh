#!/bin/bash
# SessionStart hook for Claude Code on the web: the slow half.
#
# `bun install` is the only startup step that costs real time — ~13s against a
# warm container and considerably more against a cold one — and it is the only
# one nothing else is ordering-sensitive about, so it runs asynchronously and
# the session starts without waiting for it. The millisecond-scale, must-happen-
# first steps (the null ALSA device, PW_CHROMIUM_PATH) are in
# `session-start.sh`, which stays synchronous.
#
# The trade: a command run in the session's first seconds can fail on modules
# this install has not written yet. `session-start.sh` prints a notice saying so
# and telling the reader to wait rather than diagnose, which is the failure mode
# worth guarding — the alternative reading is "broken tsconfig", and that has
# already cost a run.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

# Must be the first line on stdout: it is what puts this hook in the background.
# The timeout covers a cold container, where the install has no cache to reuse.
echo '{"async": true, "asyncTimeout": 300000}'

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Prefer the lockfile exactly as CI resolves it; fall back to a plain install
# rather than leaving the session with no node_modules if the lockfile drifted.
bun install --frozen-lockfile || bun install
