#!/usr/bin/env bash
# Keep stacked PRs current without anyone babysitting them.
#
# Called by .github/workflows/restack.yml with the PR that changed:
#
#   merged <pr>     A PR merged. Every open PR stacked on its branch is
#                   retargeted onto the merged PR's base, then brought up to date.
#   pushed <pr>     A PR's branch moved. Every PR stacked on it merges it in.
#   rebased <pr>    A PR's base was changed. It merges its new base in.
#
# "Brought up to date" means `git merge origin/<base>` into the PR branch, then a
# plain push. Never a rebase or force-push: an agent may have that branch
# checked out, and a merge commit keeps its checkout valid. The PR's diff is
# still clean, because GitHub diffs against the merge base, which the merge
# just moved to the tip of the base.
#
# Each update recurses into the PRs stacked on top of it, so one merge at the
# bottom of a three-PR stack updates the whole stack in one run.
#
# A merge that conflicts is aborted, labelled `restack-conflict`, and handed to
# @claude with a comment (claude.yml picks it up). The label stops a second
# comment while the first is being worked; the next clean update removes it.
set -euo pipefail

mode="$1"
pr="$2"
repo="${GITHUB_REPOSITORY:?}"
conflict_label="restack-conflict"

log() { echo "restack: $*" >&2; }

pr_field() { gh pr view "$1" --repo "$repo" --json "$2" --jq ".$2"; }

# Open PRs whose base is the given branch, one number per line.
children_of() {
	gh pr list --repo "$repo" --state open --base "$1" --limit 100 \
		--json number,isCrossRepository \
		--jq '.[] | select(.isCrossRepository | not) | .number'
}

ensure_label() {
	gh label create "$conflict_label" --repo "$repo" --color B60205 \
		--description "Auto-restack hit a merge conflict; @claude has been asked to resolve it" \
		2>/dev/null || true
}

report_conflict() {
	local number="$1" head="$2" base="$3"
	if gh pr view "$number" --repo "$repo" --json labels --jq '.labels[].name' |
		grep -qx "$conflict_label"; then
		log "#$number already flagged; not commenting again"
		return
	fi
	ensure_label
	gh pr edit "$number" --repo "$repo" --add-label "$conflict_label" >/dev/null
	gh pr comment "$number" --repo "$repo" --body-file - <<EOF
@claude Auto-restack could not merge \`$base\` into \`$head\`: it conflicts.

Check out \`$head\`, run \`git merge origin/$base\`, and resolve the conflicts so both sides' behaviour survives. Do not rebase or force-push. Run \`bun run typecheck\`, \`bun run check\` and the tests the conflicted files touch, then push. If two sides changed the same logic and keeping both is not possible, stop and say which behaviour you need decided instead of picking one.

---
_Posted by the restack workflow (\`.github/workflows/restack.yml\`)._
EOF
}

# Merge the PR's current base into its head and push. Returns 1 on conflict.
update_pr() {
	local number="$1" head base
	head="$(pr_field "$number" headRefName)"
	base="$(pr_field "$number" baseRefName)"

	git fetch --quiet origin "$base" "$head"
	git checkout --quiet -B "$head" "origin/$head"

	if git merge-base --is-ancestor "origin/$base" HEAD; then
		log "#$number ($head) already contains $base"
	elif git merge --no-edit "origin/$base" >/dev/null 2>&1; then
		# One retry covers a racing push (another run or an agent) to the same branch.
		if ! git push --quiet origin "HEAD:$head"; then
			log "#$number push rejected; refetching and retrying once"
			git fetch --quiet origin "$head"
			git reset --quiet --hard "origin/$head"
			git merge --no-edit "origin/$base" >/dev/null
			git push --quiet origin "HEAD:$head"
		fi
		log "#$number ($head) merged $base and pushed"
	else
		git merge --abort
		log "#$number ($head) conflicts with $base"
		report_conflict "$number" "$head" "$base"
		return 1
	fi

	gh pr edit "$number" --repo "$repo" --remove-label "$conflict_label" >/dev/null 2>&1 || true
}

# Update a PR, then everything stacked on it. A conflicted PR stops its own
# subtree: its children would only inherit the conflict.
restack_tree() {
	local number="$1" head child
	update_pr "$number" || return 0
	head="$(pr_field "$number" headRefName)"
	for child in $(children_of "$head"); do
		restack_tree "$child"
	done
}

case "$mode" in
merged)
	merged_head="$(pr_field "$pr" headRefName)"
	merged_base="$(pr_field "$pr" baseRefName)"
	merged_sha="$(pr_field "$pr" headRefOid)"

	# Still stacked on the merged branch: retarget them.
	for child in $(children_of "$merged_head"); do
		log "#$child: retargeting $merged_head -> $merged_base"
		gh pr edit "$child" --repo "$repo" --base "$merged_base" >/dev/null
		restack_tree "$child"
	done

	# Already retargeted by GitHub (it does that when the merged branch is
	# deleted), so they are no longer findable by base. They are the open PRs
	# on the same base whose history contains the merged PR's head.
	git fetch --quiet origin
	for candidate in $(children_of "$merged_base"); do
		head="$(pr_field "$candidate" headRefName)"
		if git merge-base --is-ancestor "$merged_sha" "origin/$head" 2>/dev/null; then
			restack_tree "$candidate"
		fi
	done
	;;
pushed)
	head="$(pr_field "$pr" headRefName)"
	for child in $(children_of "$head"); do
		restack_tree "$child"
	done
	;;
rebased)
	restack_tree "$pr"
	;;
*)
	echo "usage: restack.sh merged|pushed|rebased <pr-number>" >&2
	exit 2
	;;
esac
