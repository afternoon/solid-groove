#!/usr/bin/env bash
# Act on a red CI run, so nobody has to notice it first.
#
# Called by .github/workflows/ci-failure.yml:
#
#   queue <run-id> <queue-branch>  A merge-queue run failed. GitHub has already
#                                  taken the PR out of the queue; hand it back to
#                                  @claude to fix, and move its issue back to In
#                                  progress. A push re-queues it (merge.yml).
#   main <run-id> <sha>            CI failed on main after <sha> landed. If <sha>
#                                  is the squash of a PR and main was green before
#                                  it, revert it through the queue and file an
#                                  issue to land it again. Otherwise file a bug.
#
# Only the gate jobs count on main: a failed deploy is infrastructure (a missing
# role or API), and reverting code would not fix it.
set -euo pipefail

mode="$1"
run="$2"
ref="$3"
repo="${GITHUB_REPOSITORY:?}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/$repo/actions/runs/$run"
gates='^(typecheck, check, unit \+ component tests|browser sanity \(chromium\)|firebase emulator tests|production build \+ no-secrets-in-bundle check)$'
footer=$'\n---\n_Posted by the CI-failure workflow (`.github/workflows/ci-failure.yml`)._'

log() { echo "ci-failure: $*" >&2; }

# The issue a PR body closes or refers to, if any.
issue_of() {
	gh api "repos/$repo/pulls/$1" --jq .body |
		grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?) #[0-9]+' | grep -oE '[0-9]+' | head -1 || true
}

failed_gates() {
	gh api --paginate "repos/$repo/actions/runs/$1/jobs" \
		--jq '.jobs[] | select(.conclusion == "failure") | .name' | grep -E "$gates" || true
}

# File a bug for a red main that is not reverted automatically. $1 says why not.
file_bug() {
	log "not reverting ($1); filing a bug"
	gh issue create --repo "$repo" --label bug --title "Bug: CI is red on main" --body-file - <<EOF
CI failed on \`main\` after "$subject" landed, and it was not reverted automatically: $1. $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Find the cause in that run, fix \`main\`, and say here which change broke it.
$footer
EOF
}

case "$mode" in
queue)
	# gh-readonly-queue/main/pr-123-<sha>: the last PR in the tested group.
	pr="$(sed -nE 's#^gh-readonly-queue/[^/]+/pr-([0-9]+)-.*#\1#p' <<<"$ref")"
	[ -n "$pr" ] || { log "no PR in $ref"; exit 0; }
	[ "$(gh api "repos/$repo/pulls/$pr" --jq .state)" = open ] || { log "#$pr is not open"; exit 0; }
	gh pr comment "$pr" --repo "$repo" --body-file - <<EOF
@claude The merge queue tested this PR on top of \`main\` (and any PRs queued ahead of it) and CI failed, so it was taken out of the queue: $run_url

Find the cause in that run's failing job. Bring this branch up to date with its base (\`git pull --rebase\`), reproduce the failure, fix it, run the checks it touches, and push. The push puts the PR back in the queue. If the failure comes from a PR queued ahead of this one rather than from this change, say so here instead of changing anything.
$footer
EOF
	issue="$(issue_of "$pr")"
	if [ -n "$issue" ]; then
		gh issue edit "$issue" --repo "$repo" --add-label "status:in-progress" >/dev/null
	fi
	log "#$pr handed back to @claude"
	;;
main)
	sha="$ref"
	failed="$(failed_gates "$run")"
	[ -n "$failed" ] || { log "only non-gate jobs failed; nothing to revert"; exit 0; }

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
	reland="$(gh issue create --repo "$repo" --label bug --title "Re-land #$pr: $title" --body-file - <<EOF
#$pr turned CI red on \`main\` and was reverted automatically: $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Land the change again with the failure fixed: bring back #$pr's diff on a branch from \`main\`, reproduce the failure, fix it, and open one PR.${issue:+ The original issue is #$issue.}
$footer
EOF
)"
	revert="$(gh pr create --repo "$repo" --base main --head "$branch" \
		--title "Revert #$pr: $title" --body-file - <<EOF
Reverts #$pr automatically: CI failed on \`main\` after it landed, and \`main\` was green before it. $run_url

Failing jobs:
$(sed 's/^/- /' <<<"$failed")

Landing it again is tracked in $reland. This PR is labelled \`status:approved\`, so it merges through the queue once its checks pass.
$footer
EOF
)"
	gh pr edit "$revert" --repo "$repo" --add-label status:approved >/dev/null
	gh pr comment "$pr" --repo "$repo" --body "CI failed on \`main\` after this landed ($run_url), so it is being reverted in $revert. Re-landing is tracked in $reland.$footer" >/dev/null
	log "reverting #$pr in $revert; re-land in $reland"
	;;
*)
	echo "usage: ci-failure.sh queue <run-id> <queue-branch> | main <run-id> <sha>" >&2
	exit 2
	;;
esac
