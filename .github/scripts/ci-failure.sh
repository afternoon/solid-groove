#!/usr/bin/env bash
# Act on a red CI run, so nobody has to notice it first.
#
# Called by .github/workflows/ci-failure.yml:
#
#   queue <run-id> <queue-branch>  A merge-queue run failed. GitHub has already
#                                  taken the PR out of the queue; hand it back to
#                                  @claude to fix, and move its card (Linear) back
#                                  to In Progress. A push re-queues it (merge.yml).
#   main <run-id> <sha> <attempt>  CI failed on main after <sha> landed. Stop the
#                                  line (merge.mjs stop) and re-run the failed jobs
#                                  once: a flake goes green and the line resumes. If
#                                  they fail again, and <sha> is the squash of a PR
#                                  and main was green before it, revert it through
#                                  the queue, hold the card's other open PRs, and
#                                  file a Linear issue to land it again. Otherwise
#                                  file a bug.
#
# Needs LINEAR_API_KEY, and `linear.mjs` and `merge.mjs` beside this script.
#
# Only the gate jobs count on main: a failed deploy is infrastructure (a missing
# role or API), and reverting code would not fix it.
set -euo pipefail

mode="$1"
run="$2"
ref="$3"
repo="${GITHUB_REPOSITORY:?}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/$run"
# Keep in step with GATE_JOBS in merge.mjs.
gates='^(typecheck, check, unit \+ component tests|browser sanity \(chromium\)|firebase emulator tests|production build \+ no-secrets-in-bundle check)$'
footer=$'\n---\n_Posted by the CI-failure workflow (`.github/workflows/ci-failure.yml`)._'

log() { echo "ci-failure: $*" >&2; }
linear() { node "$(dirname "${BASH_SOURCE[0]}")/linear.mjs" "$@"; }
merge() { node "$(dirname "${BASH_SOURCE[0]}")/merge.mjs" "$@"; }
team="${LINEAR_TEAM:-GRV}"

# The Linear card a PR body closes, completes or refers to (`GRV-12`), if any.
issue_of() {
	gh api "repos/$repo/pulls/$1" --jq .body |
		grep -oiE "\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?|completes?) $team-[0-9]+" |
		grep -oiE "$team-[0-9]+" | head -1 | tr '[:lower:]' '[:upper:]' || true
}

# File a Linear issue: $1 title, $2 label, body on stdin. Prints its identifier.
file_linear() {
	linear create --title "$1" --label "$2" --body-file - | jq -r .identifier
}

failed_gates() {
	gh api --paginate "repos/$repo/actions/runs/$1/jobs" \
		--jq '.jobs[] | select(.conclusion == "failure") | .name' | grep -E "$gates" || true
}

# File a bug for a red main that is not reverted automatically. $1 says why not.
file_bug() {
	log "not reverting ($1); filing a bug"
	file_linear "Bug: CI is red on main" bug <<EOF
CI failed on \`main\` after "$subject" landed, and it was not reverted automatically: $1. $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Find the cause in that run, fix \`main\`, and say here which change broke it. The line is stopped until \`main\` is green: label the fix's PR \`fixes-main\` so it can land.
$footer
EOF
}

case "$mode" in
queue)
	# gh-readonly-queue/main/pr-123-<sha>: the last PR in the tested group.
	pr="$(sed -nE 's#^gh-readonly-queue/[^/]+/pr-([0-9]+)-.*#\1#p' <<<"$ref")"
	[ -n "$pr" ] || { log "no PR in $ref"; exit 0; }
	[ "$(gh api "repos/$repo/pulls/$pr" --jq .state)" = open ] || { log "#$pr is not open"; exit 0; }
	# With main red, the failure is main's, not this PR's: it rejoins the queue
	# on its own once main is green (merge.mjs resume).
	if [ "$(merge status)" = stopped ]; then
		log "the line is stopped; #$pr waits for main"
		exit 0
	fi
	gh pr comment "$pr" --repo "$repo" --body-file - <<EOF
@claude The merge queue tested this PR on top of \`main\` (and any PRs queued ahead of it) and CI failed, so it was taken out of the queue: $run_url

Find the cause in that run's failing job. Bring this branch up to date with \`main\` (\`git merge origin/main\`; never a rebase or force-push), reproduce the failure, fix it, run the checks it touches, and push. The push puts the PR back in the queue. If the failure comes from a PR queued ahead of this one rather than from this change, say so here instead of changing anything.
$footer
EOF
	issue="$(issue_of "$pr")"
	if [ -n "$issue" ]; then
		linear state "$issue" "In Progress" >/dev/null || log "could not move $issue to In Progress"
	fi
	log "#$pr handed back to @claude"
	;;
main)
	sha="$ref"
	attempt="${4:-1}"
	failed="$(failed_gates "$run")"
	[ -n "$failed" ] || { log "only non-gate jobs failed; nothing to revert"; exit 0; }

	# Stop the line: nothing else lands, and no new build starts, until main is green.
	merge stop "$run_url"

	# A flake is not a reason to revert. Re-run the failed jobs once; green resumes
	# the line, and a second failure comes back here as attempt 2.
	if [ "$attempt" = 1 ]; then
		gh run rerun "$run" --repo "$repo" --failed
		log "re-running the failed jobs of $run before deciding"
		exit 0
	fi

	git fetch --quiet origin main
	subject="$(git log -1 --format=%s "$sha")"
	parent="$(git rev-parse "$sha^")"
	pr="$(sed -nE 's/.*\(#([0-9]+)\)$/\1/p' <<<"$subject")"

	# Revert only when the commit is clearly the cause: main was green before it.
	parent_run="$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$parent&event=push" \
		--jq '[.workflow_runs[] | select(.head_branch == "main")][0] | "\(.id) \(.status)"')"
	parent_green=false
	if [ "${parent_run#* }" = completed ] && [ -z "$(failed_gates "${parent_run%% *}")" ]; then
		parent_green=true
	fi

	if [ -z "$pr" ] || [ "$parent_green" != true ] || [[ "$subject" == Revert* ]]; then
		file_bug "it is not a PR squash, \`main\` was not green before it, or it is itself a revert"
		exit 0
	fi

	branch="revert/pr-$pr"
	git checkout --quiet -B "$branch" origin/main
	if ! git revert --no-edit --no-commit "$sha" >/dev/null 2>&1; then
		git revert --abort
		file_bug "reverting #$pr conflicts with what landed after it"
		exit 0
	fi
	git commit --quiet -m "Revert \"$subject\"" -m "CI failed on main after it landed: $run_url"
	git push --quiet --force origin "$branch"

	title="$(gh api "repos/$repo/pulls/$pr" --jq .title)"
	issue="$(issue_of "$pr")"
	reland="$(file_linear "Re-land #$pr: $title" bug <<EOF
https://github.com/$repo/pull/$pr turned CI red on \`main\` and was reverted automatically: $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Land the change again with the failure fixed: bring back that PR's diff on a branch from \`main\`, reproduce the failure, fix it, and open one PR.${issue:+ The original card is $issue.}
$footer
EOF
)"
	revert="$(gh pr create --repo "$repo" --base main --head "$branch" \
		--title "Revert #$pr: $title" --body-file - <<EOF
Reverts #$pr automatically: CI failed on \`main\` after it landed, and \`main\` was green before it. $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Landing it again is tracked in Linear as $reland. This PR is labelled \`status:approved\`, so it merges through the queue once its checks pass.
$footer
EOF
)"
	gh pr edit "$revert" --repo "$repo" --add-label status:approved >/dev/null
	# The card's later PRs were built on this one: hold them until it lands again.
	if [ -n "$issue" ]; then
		merge hold "$pr" "$issue" || log "could not hold the other PRs for $issue"
	fi
	gh pr comment "$pr" --repo "$repo" --body "CI failed on \`main\` after this landed ($run_url), so it is being reverted in $revert. Re-landing is tracked in Linear as $reland.$footer" >/dev/null
	log "reverting #$pr in $revert; re-land in $reland"
	;;
*)
	echo "usage: ci-failure.sh queue <run-id> <queue-branch> | main <run-id> <sha> <attempt>" >&2
	exit 2
	;;
esac
